import { FastifyInstance } from 'fastify';
import type { WebSocket as WsWebSocket } from 'ws';
import { prisma } from '../db.js';
import { resolveProvider } from '../providers/registry.js';

// In-memory map of channelId -> Set<WebSocket> for live broadcasting.
const channelSubscribers = new Map<string, Set<WsWebSocket>>();

function broadcast(channelId: string, event: string, data: unknown): void {
  const subs = channelSubscribers.get(channelId);
  if (!subs) return;
  const msg = JSON.stringify({ event, data });
  for (const ws of subs) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

export async function channelsRoutes(fastify: FastifyInstance) {
  // REST routes require auth; WebSocket upgrade requests skip JWT (handled in ws handler).
  fastify.addHook('preHandler', (req, reply, done) => {
    if (req.headers.upgrade === 'websocket') { done(); return; }
    fastify.auth.require(req, reply).then(() => done()).catch(() => done());
  });

  // ─── WebSocket: /api/channels/ws ──────────────────────────────────────
  fastify.get('/channels/ws', { websocket: true }, (socket: WsWebSocket, req) => {
    // authenticate via query token
    const token = (req.query as { token?: string })?.token;
    let userId = 'anon';
    let username = 'anon';
    if (token) {
      try {
        const payload = fastify.jwt.verify(token) as { id: string; username: string };
        userId = payload.id;
        username = payload.username;
      } catch {
        socket.send(JSON.stringify({ event: 'error', data: { message: 'Invalid token' } }));
        socket.close();
        return;
      }
    }
    const subscribedChannels = new Set<string>();

    socket.on('message', async (raw: Buffer) => {
      let msg: { type: string; channelId?: string; content?: string; taggedModels?: string[]; threadId?: string };
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      if (msg.type === 'subscribe' && msg.channelId) {
        // verify membership
        const member = await prisma.channelMember.findFirst({
          where: { channelId: msg.channelId, userId },
        });
        if (!member) {
          socket.send(JSON.stringify({ event: 'error', data: { message: 'Not a member' } }));
          return;
        }
        if (!channelSubscribers.has(msg.channelId)) channelSubscribers.set(msg.channelId, new Set());
        channelSubscribers.get(msg.channelId)!.add(socket);
        subscribedChannels.add(msg.channelId);
        socket.send(JSON.stringify({ event: 'subscribed', data: { channelId: msg.channelId } }));
      }

      if (msg.type === 'message' && msg.channelId && msg.content) {
        const member = await prisma.channelMember.findFirst({
          where: { channelId: msg.channelId, userId },
        });
        if (!member) return;

        const channelMsg = await prisma.channelMessage.create({
          data: {
            channelId: msg.channelId,
            authorId: userId,
            content: msg.content,
            taggedModels: msg.taggedModels ?? [],
            threadId: msg.threadId ?? null,
          },
        });

        broadcast(msg.channelId, 'message', {
          ...channelMsg,
          authorName: username,
        });

        // If models are tagged, generate AI responses
        if (msg.taggedModels && msg.taggedModels.length > 0) {
          for (const modelId of msg.taggedModels) {
            try {
              const { provider, model } = resolveProvider(modelId);
              const res = await provider.impl.chat({
                model,
                messages: [{ role: 'user', content: msg.content }],
              });
              const aiMsg = await prisma.channelMessage.create({
                data: {
                  channelId: msg.channelId,
                  authorId: userId,
                  content: res.content,
                  taggedModels: [],
                  threadId: channelMsg.id,
                  // metadata would mark it as AI-generated
                },
              });
              broadcast(msg.channelId, 'message', { ...aiMsg, authorName: modelId, isAI: true, model: modelId });
            } catch (err) {
              fastify.log.error(err);
            }
          }
        }
      }

      if (msg.type === 'unsubscribe' && msg.channelId) {
        channelSubscribers.get(msg.channelId)?.delete(socket);
        subscribedChannels.delete(msg.channelId);
      }
    });

    socket.on('close', () => {
      for (const chId of subscribedChannels) {
        channelSubscribers.get(chId)?.delete(socket);
      }
      subscribedChannels.clear();
    });
  });

  // ─── REST endpoints (spec §2.9.5) ─────────────────────────────────────

  // GET /api/channels — list channels the user is a member of
  fastify.get('/channels', async (req) => {
    const uid = req.user.id;
    const memberships = await prisma.channelMember.findMany({
      where: { userId: uid },
      include: { channel: { include: { _count: { select: { members: true } } } } },
    });
    return { channels: memberships.map((m) => m.channel) };
  });

  // POST /api/channels — create channel
  fastify.post('/channels', async (req, reply) => {
    const { name, description, type, memberIds } = (req.body as {
      name?: string; description?: string; type?: string; memberIds?: string[];
    }) ?? {};
    if (!name?.trim()) return reply.status(400).send({ error: 'name is required' });
    const uid = req.user.id;
    const channel = await prisma.channel.create({
      data: {
        name: name.trim(),
        description,
        type: type || 'public',
        members: {
          create: [
            { userId: uid },
            ...(memberIds ?? []).map((mid) => ({ userId: mid })),
          ],
        },
      },
      include: { members: true },
    });
    return reply.status(201).send({ channel });
  });

  // GET /api/channels/:id
  fastify.get('/channels/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const member = await prisma.channelMember.findFirst({ where: { channelId: id, userId: uid } });
    if (!member) return reply.status(403).send({ error: 'Not a member' });
    const channel = await prisma.channel.findUnique({
      where: { id },
      include: { members: { include: { user: { select: { id: true, username: true, avatar: true } } } } },
    });
    return { channel };
  });

  // POST /api/channels/:id/messages — send message (REST)
  fastify.post('/channels/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const { content, taggedModels, threadId } = (req.body as {
      content?: string; taggedModels?: string[]; threadId?: string;
    }) ?? {};
    if (!content?.trim()) return reply.status(400).send({ error: 'content is required' });

    const member = await prisma.channelMember.findFirst({ where: { channelId: id, userId: uid } });
    if (!member) return reply.status(403).send({ error: 'Not a member' });

    const msg = await prisma.channelMessage.create({
      data: { channelId: id, authorId: uid, content, taggedModels: taggedModels ?? [], threadId },
    });
    broadcast(id, 'message', { ...msg, authorName: req.user.username });
    return reply.status(201).send({ message: msg });
  });

  // GET /api/channels/:id/messages — get messages
  fastify.get('/channels/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const member = await prisma.channelMember.findFirst({ where: { channelId: id, userId: uid } });
    if (!member) return reply.status(403).send({ error: 'Not a member' });
    const messages = await prisma.channelMessage.findMany({
      where: { channelId: id },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return { messages };
  });

  // POST /api/channels/:id/messages/:msgId/react — add reaction
  fastify.post('/channels/:id/messages/:msgId/react', async (req, reply) => {
    const { id, msgId } = req.params as { id: string; msgId: string };
    const uid = req.user.id;
    const { emoji } = (req.body as { emoji?: string }) ?? {};
    if (!emoji) return reply.status(400).send({ error: 'emoji is required' });

    const member = await prisma.channelMember.findFirst({ where: { channelId: id, userId: uid } });
    if (!member) return reply.status(403).send({ error: 'Not a member' });

    const msg = await prisma.channelMessage.findFirst({ where: { id: msgId, channelId: id } });
    if (!msg) return reply.status(404).send({ error: 'Message not found' });

    // reactions stored as metadata JSON
    const meta = (msg.metadata as Record<string, unknown> | null) ?? {};
    const reactions = (meta.reactions as Record<string, string[]> | null) ?? {};
    const users = reactions[emoji] ?? [];
    if (!users.includes(uid)) users.push(uid);
    reactions[emoji] = users;

    const updated = await prisma.channelMessage.update({
      where: { id: msgId },
      data: { metadata: { ...meta, reactions } as Record<string, unknown> as import('@prisma/client').Prisma.InputJsonValue },
    });
    broadcast(id, 'reaction', { messageId: msgId, emoji, userId: uid });
    return { message: updated };
  });

  // POST /api/channels/:id/messages/:msgId/pin — pin message
  fastify.post('/channels/:id/messages/:msgId/pin', async (req, reply) => {
    const { id, msgId } = req.params as { id: string; msgId: string };
    const uid = req.user.id;
    const member = await prisma.channelMember.findFirst({ where: { channelId: id, userId: uid } });
    if (!member) return reply.status(403).send({ error: 'Not a member' });
    const msg = await prisma.channelMessage.findFirst({ where: { id: msgId, channelId: id } });
    if (!msg) return reply.status(404).send({ error: 'Message not found' });
    const updated = await prisma.channelMessage.update({ where: { id: msgId }, data: { pinned: !msg.pinned } });
    broadcast(id, 'pin', { messageId: msgId, pinned: updated.pinned });
    return { message: updated };
  });

  // POST /api/channels/:id/join — join a public channel
  fastify.post('/channels/:id/join', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const channel = await prisma.channel.findUnique({ where: { id } });
    if (!channel) return reply.status(404).send({ error: 'Channel not found' });
    if (channel.type === 'private') return reply.status(403).send({ error: 'Cannot join private channel' });
    const existing = await prisma.channelMember.findFirst({ where: { channelId: id, userId: uid } });
    if (existing) return reply.status(409).send({ error: 'Already a member' });
    await prisma.channelMember.create({ data: { channelId: id, userId: uid } });
    return { ok: true };
  });
}
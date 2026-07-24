import { FastifyInstance, FastifyRequest } from 'fastify';
import { prisma } from '../db.js';
import { resolveProvider } from '../providers/registry.js';
import { config } from '@ai-chat/config';
import { hookBus } from '../plugins/loader.js';
import type { ChatMessage } from '@ai-chat/shared';

// Until auth is wired (Phase A3), resolve an owner id from header or default to a
// single demo user. When JWT is present, AuthPlugin sets req.user.id and we use it.
function ownerId(req: FastifyRequest): string {
  return req.user.id;
}

function asChatMessages(msgs: { role: string; content: string }[]): ChatMessage[] {
  return msgs.map((m) => ({ role: m.role as ChatMessage['role'], content: m.content }));
}

const titleFromContent = (s: string) => {
  const t = s.trim().replace(/\s+/g, ' ');
  return t ? t.slice(0, 60) + (t.length > 60 ? '…' : '') : 'New conversation';
};

const estimateTokens = (s: string) => Math.max(1, Math.round(s.length / 4));

export async function conversationsRoutes(fastify: FastifyInstance) {
  // All conversation routes require authentication.
  fastify.addHook('preHandler', fastify.auth.require);

  // GET /api/conversations — list for owner
  fastify.get('/conversations', async (req) => {
    const uid = ownerId(req);
    const conversations = await prisma.conversation.findMany({
      where: { userId: uid },
      orderBy: [{ pinned: 'desc' }, { archived: 'asc' }, { updatedAt: 'desc' }],
    });
    return { conversations };
  });

  // POST /api/conversations — create
  fastify.post('/conversations', async (req, reply) => {
    const uid = ownerId(req);
    const body = req.body as {
      title?: string;
      model?: string;
      systemPrompt?: string;
    } | null;
    const convo = await prisma.conversation.create({
      data: {
        userId: uid,
        title: body?.title?.trim() || 'New conversation',
        model: body?.model || config.ollamaChatModel,
        systemPrompt: body?.systemPrompt,
      },
    });
    return reply.status(201).send({ conversation: convo });
  });

  // GET /api/conversations/:id
  fastify.get('/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = ownerId(req);
    const convo = await prisma.conversation.findFirst({
      where: { id, userId: uid },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!convo) return reply.status(404).send({ error: 'Conversation not found' });
    return { conversation: convo };
  });

  // PUT /api/conversations/:id
  fastify.put('/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = ownerId(req);
    const body = req.body as {
      title?: string;
      model?: string;
      archived?: boolean;
      pinned?: boolean;
      tags?: string[];
      systemPrompt?: string;
    } | null;
    const existing = await prisma.conversation.findFirst({ where: { id, userId: uid } });
    if (!existing) return reply.status(404).send({ error: 'Conversation not found' });
    const convo = await prisma.conversation.update({
      where: { id },
      data: {
        ...(body?.title !== undefined && { title: body.title }),
        ...(body?.model !== undefined && { model: body.model }),
        ...(body?.archived !== undefined && { archived: body.archived }),
        ...(body?.pinned !== undefined && { pinned: body.pinned }),
        ...(body?.tags !== undefined && { tags: body.tags }),
        ...(body?.systemPrompt !== undefined && { systemPrompt: body.systemPrompt }),
      },
    });
    return { conversation: convo };
  });

  // DELETE /api/conversations/:id
  fastify.delete('/conversations/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = ownerId(req);
    const existing = await prisma.conversation.findFirst({ where: { id, userId: uid } });
    if (!existing) return reply.status(404).send({ error: 'Conversation not found' });
    await prisma.conversation.delete({ where: { id } });
    return reply.status(204).send();
  });

  // GET /api/conversations/:id/messages
  fastify.get('/conversations/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = ownerId(req);
    const convo = await prisma.conversation.findFirst({ where: { id, userId: uid } });
    if (!convo) return reply.status(404).send({ error: 'Conversation not found' });
    const messages = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
    });
    return { messages };
  });

  // POST /api/conversations/:id/messages — persist user msg + stream assistant reply
  fastify.post('/conversations/:id/messages', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = ownerId(req);
    const body = req.body as {
      content: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
    } | null;
    if (!body?.content?.trim()) {
      return reply.status(400).send({ error: 'content is required' });
    }

    const convo = await prisma.conversation.findFirst({ where: { id, userId: uid } });
    if (!convo) return reply.status(404).send({ error: 'Conversation not found' });

    const userMsg = await prisma.message.create({
      data: { conversationId: id, role: 'user', content: body.content.trim() },
    });

    // auto-title first message
    if (convo.title === 'New conversation') {
      await prisma.conversation.update({
        where: { id },
        data: { title: titleFromContent(body.content) },
      });
    }

    // build history
    const history = await prisma.message.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
    });
    const sysMessages: { role: 'system'; content: string }[] = [];
    if (convo.systemPrompt?.trim()) {
      sysMessages.push({ role: 'system', content: convo.systemPrompt.trim() });
    }
    const chatMessages = [
      ...sysMessages,
      ...history
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    // Run pre_chat plugin hooks (filters may modify messages)
    const hookResult = await hookBus.runHook('pre_chat', {
      conversationId: id,
      userId: ownerId(req),
      model: body.model || convo.model || config.ollamaChatModel,
      messages: chatMessages,
    });
    const finalMessages = hookResult.messages ?? chatMessages;

    const useModel = body.model || convo.model || config.ollamaChatModel;
    const { provider, model: resolvedModel } = resolveProvider(useModel);
    const assistantMsg = await prisma.message.create({
      data: { conversationId: id, role: 'assistant', content: '', model: useModel },
    });

    if (body.stream) {
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.flushHeaders?.();

      let acc = '';
      try {
        for await (const chunk of provider.impl.chatStream({
          model: resolvedModel,
          messages: asChatMessages(finalMessages),
          temperature: body.temperature,
          maxTokens: body.maxTokens,
          stream: true,
        })) {
          acc += chunk;
          reply.raw.write(`data: ${JSON.stringify({ content: chunk, messageId: assistantMsg.id })}\n\n`);
        }
        await prisma.message.update({
          where: { id: assistantMsg.id },
          data: { content: acc, tokens: estimateTokens(acc) },
        });
        await prisma.conversation.update({ where: { id }, data: { updatedAt: new Date() } });
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
      } catch (err) {
        fastify.log.error(err);
        await prisma.message.update({
          where: { id: assistantMsg.id },
          data: { content: acc, metadata: { error: 'Stream failed' } },
        });
        reply.raw.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`);
        reply.raw.end();
      }
      return reply;
    }

    try {
      const res = await provider.impl.chat({
        model: resolvedModel,
        messages: asChatMessages(finalMessages),
        temperature: body.temperature,
        maxTokens: body.maxTokens,
      });
      const updated = await prisma.message.update({
        where: { id: assistantMsg.id },
        data: { content: res.content, tokens: res.tokens ?? estimateTokens(res.content) },
      });
      await prisma.conversation.update({ where: { id }, data: { updatedAt: new Date() } });
      return { userMessage: userMsg, assistantMessage: updated };
    } catch (err) {
      fastify.log.error(err);
      await prisma.message.update({
        where: { id: assistantMsg.id },
        data: { metadata: { error: 'Ollama chat failed' } },
      });
      return reply.status(502).send({ error: 'Ollama chat failed' });
    }
  });

  // POST /api/conversations/:id/messages/:messageId/regenerate
  fastify.post('/conversations/:id/messages/:messageId/regenerate', async (req, reply) => {
    const { id, messageId } = req.params as { id: string; messageId: string };
    const uid = ownerId(req);
    const body = req.body as { model?: string; temperature?: number; maxTokens?: number; stream?: boolean } | null;

    const convo = await prisma.conversation.findFirst({ where: { id, userId: uid } });
    if (!convo) return reply.status(404).send({ error: 'Conversation not found' });

    const target = await prisma.message.findFirst({
      where: { id: messageId, conversationId: id, role: 'assistant' },
    });
    if (!target) return reply.status(404).send({ error: 'Message not found' });

    // history before this assistant message
    const prior = await prisma.message.findMany({
      where: { conversationId: id, createdAt: { lt: target.createdAt } },
      orderBy: { createdAt: 'asc' },
    });
    const sysMessages: { role: 'system'; content: string }[] = [];
    if (convo.systemPrompt?.trim()) {
      sysMessages.push({ role: 'system', content: convo.systemPrompt.trim() });
    }
    const chatMessages = [
      ...sysMessages,
      ...prior
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    // Run pre_chat plugin hooks
    const hookResult = await hookBus.runHook('pre_chat', {
      conversationId: id,
      userId: ownerId(req),
      model: body?.model || target.model || convo.model || config.ollamaChatModel,
      messages: chatMessages,
    });
    const finalMessages = hookResult.messages ?? chatMessages;

    const useModel = body?.model || target.model || convo.model || config.ollamaChatModel;
    const { provider, model: resolvedModel } = resolveProvider(useModel);

    if (body?.stream) {
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.flushHeaders?.();

      let acc = '';
      try {
        for await (const chunk of provider.impl.chatStream({
          model: resolvedModel,
          messages: asChatMessages(finalMessages),
          temperature: body.temperature,
          maxTokens: body.maxTokens,
          stream: true,
        })) {
          acc += chunk;
          reply.raw.write(`data: ${JSON.stringify({ content: chunk, messageId })}\n\n`);
        }
        await prisma.message.update({
          where: { id: messageId },
          data: { content: acc, tokens: estimateTokens(acc) },
        });
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
      } catch (err) {
        fastify.log.error(err);
        reply.raw.write(`data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`);
        reply.raw.end();
      }
      return reply;
    }

    try {
      const res = await provider.impl.chat({ model: resolvedModel, messages: asChatMessages(finalMessages) });
      const updated = await prisma.message.update({
        where: { id: messageId },
        data: { content: res.content, tokens: res.tokens ?? estimateTokens(res.content) },
      });
      return { assistantMessage: updated };
    } catch (err) {
      fastify.log.error(err);
      return reply.status(502).send({ error: 'Ollama chat failed' });
    }
  });
}
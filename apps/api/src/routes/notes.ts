import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

const noteSchema = z.object({
  title: z.string().min(1),
  content: z.string(),
  folderId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  sharedWith: z.array(z.string()).optional(),
});

export async function notesRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.auth.require);

  // GET /api/notes — list (own + shared with me), with optional full-text search
  fastify.get('/notes', async (req) => {
    const uid = req.user.id;
    const { search } = req.query as { search?: string };
    const baseWhere = { OR: [{ authorId: uid }, { sharedWith: { has: uid } }] };
    const where = search
      ? { AND: [baseWhere, { OR: [
          { title: { contains: search, mode: 'insensitive' as const } },
          { content: { contains: search, mode: 'insensitive' as const } },
        ] }] }
      : baseWhere;
    const notes = await prisma.note.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { history: true } } },
    });
    return { notes };
  });

  // POST /api/notes — create
  fastify.post('/notes', async (req, reply) => {
    const parsed = noteSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    const uid = req.user.id;
    const { title, content, folderId, tags, sharedWith } = parsed.data;
    const note = await prisma.note.create({
      data: { title, content, folderId, tags: tags ?? [], sharedWith: sharedWith ?? [], authorId: uid, version: 1 },
    });
    // initial version history entry
    await prisma.noteVersion.create({ data: { noteId: note.id, content, version: 1 } });
    return reply.status(201).send({ note });
  });

  // GET /api/notes/:id
  fastify.get('/notes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const note = await prisma.note.findFirst({ where: { id, OR: [{ authorId: uid }, { sharedWith: { has: uid } }] } });
    if (!note) return reply.status(404).send({ error: 'Note not found' });
    return { note };
  });

  // PUT /api/notes/:id — update (creates a new version)
  fastify.put('/notes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const parsed = noteSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    const existing = await prisma.note.findFirst({ where: { id, authorId: uid } });
    if (!existing) return reply.status(404).send({ error: 'Note not found' });

    const data = parsed.data;
    const newVersion = existing.version + 1;
    const note = await prisma.note.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.content !== undefined && { content: data.content }),
        ...(data.folderId !== undefined && { folderId: data.folderId }),
        ...(data.tags !== undefined && { tags: data.tags }),
        ...(data.sharedWith !== undefined && { sharedWith: data.sharedWith }),
        version: newVersion,
      },
    });
    // save version history if content changed
    if (data.content !== undefined && data.content !== existing.content) {
      await prisma.noteVersion.create({ data: { noteId: id, content: data.content, version: newVersion } });
    }
    return { note };
  });

  // DELETE /api/notes/:id
  fastify.delete('/notes/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const existing = await prisma.note.findFirst({ where: { id, authorId: uid } });
    if (!existing) return reply.status(404).send({ error: 'Note not found' });
    await prisma.note.delete({ where: { id } });
    return reply.status(204).send();
  });

  // GET /api/notes/:id/history — version history
  fastify.get('/notes/:id/history', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const note = await prisma.note.findFirst({ where: { id, OR: [{ authorId: uid }, { sharedWith: { has: uid } }] } });
    if (!note) return reply.status(404).send({ error: 'Note not found' });
    const history = await prisma.noteVersion.findMany({ where: { noteId: id }, orderBy: { version: 'desc' } });
    return { history };
  });

  // POST /api/notes/:id/rewrite — AI rewrite (delegates to chat provider)
  fastify.post('/notes/:id/rewrite', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const { instruction } = (req.body as { instruction?: string }) ?? {};
    if (!instruction) return reply.status(400).send({ error: 'instruction is required' });
    const note = await prisma.note.findFirst({ where: { id, OR: [{ authorId: uid }, { sharedWith: { has: uid } }] } });
    if (!note) return reply.status(404).send({ error: 'Note not found' });

    // dynamic import to avoid circular dep
    const { resolveProvider } = await import('../providers/registry.js');
    const { config } = await import('@ai-chat/config');
    const { provider, model } = resolveProvider(config.ollamaChatModel);
    try {
      const res = await provider.impl.chat({
        model,
        messages: [
          { role: 'system', content: `You are a writing assistant. Rewrite the following text according to the instruction. Return only the rewritten text.\n\nInstruction: ${instruction}` },
          { role: 'user', content: note.content },
        ],
      });
      return { rewritten: res.content };
    } catch (err) {
      return reply.status(502).send({ error: 'AI rewrite failed' });
    }
  });

  // ─── Folders ───────────────────────────────────────────────────────────

  // GET /api/folders
  fastify.get('/folders', async (_req) => {
    const folders = await prisma.folder.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { notes: true } } } });
    return { folders };
  });

  // POST /api/folders
  fastify.post('/folders', async (req, reply) => {
    const { name, parentId } = (req.body as { name?: string; parentId?: string }) ?? {};
    if (!name?.trim()) return reply.status(400).send({ error: 'name is required' });
    const folder = await prisma.folder.create({ data: { name: name.trim(), parentId } });
    return reply.status(201).send({ folder });
  });
}
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { resolveProvider } from '../providers/registry.js';
import { config } from '@ai-chat/config';

const memorySchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
  importance: z.number().optional(),
});

export async function memoriesRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', fastify.auth.require);

  // GET /api/memories
  fastify.get('/memories', async (req) => {
    const uid = req.user.id;
    const memories = await prisma.memory.findMany({
      where: { userId: uid },
      orderBy: { createdAt: 'desc' },
    });
    return { memories };
  });

  // POST /api/memories
  fastify.post('/memories', async (req, reply) => {
    const parsed = memorySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const { key, value, importance } = parsed.data;
    const uid = req.user.id;

    // embed the memory for semantic retrieval
    let embedding: number[] = [];
    try {
      const { provider, model } = resolveProvider(config.ollamaEmbeddingModel);
      const res = await provider.impl.embed({ model, input: `${key}: ${value}` });
      embedding = res.embeddings[0] ?? [];
    } catch {
      // embeddings optional
    }

    const memory = await prisma.memory.create({
      data: { userId: uid, key, value, embedding, importance: importance ?? 0 },
    });
    return reply.status(201).send({ memory });
  });

  // PUT /api/memories/:id
  fastify.put('/memories/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = memorySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid input', details: parsed.error.flatten() });
    }
    const { key, value, importance } = parsed.data;
    const uid = req.user.id;

    const existing = await prisma.memory.findFirst({ where: { id, userId: uid } });
    if (!existing) return reply.status(404).send({ error: 'Memory not found' });

    let embedding: number[] = existing.embedding;
    try {
      const { provider, model } = resolveProvider(config.ollamaEmbeddingModel);
      const res = await provider.impl.embed({ model, input: `${key}: ${value}` });
      embedding = res.embeddings[0] ?? [];
    } catch {
      // keep existing embedding
    }

    const memory = await prisma.memory.update({
      where: { id },
      data: { key, value, embedding, importance: importance ?? existing.importance, lastAccessed: new Date() },
    });
    return { memory };
  });

  // DELETE /api/memories/:id
  fastify.delete('/memories/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const uid = req.user.id;
    const existing = await prisma.memory.findFirst({ where: { id, userId: uid } });
    if (!existing) return reply.status(404).send({ error: 'Memory not found' });
    await prisma.memory.delete({ where: { id } });
    return reply.status(204).send();
  });

  // GET /api/memories/search — semantic search via cosine similarity over embeddings
  fastify.get('/memories/search', async (req, reply) => {
    const { q, topK } = req.query as { q?: string; topK?: string };
    if (!q) return reply.status(400).send({ error: 'q is required' });
    const uid = req.user.id;
    const k = Math.min(Number(topK) || 5, 50);

    const memories = await prisma.memory.findMany({ where: { userId: uid } });
    if (memories.length === 0) return { results: [] };

    let qvec: number[] = [];
    try {
      const { provider, model } = resolveProvider(config.ollamaEmbeddingModel);
      const res = await provider.impl.embed({ model, input: q });
      qvec = res.embeddings[0] ?? [];
    } catch {
      // fall back to keyword match
      const lower = q.toLowerCase();
      const filtered = memories.filter((m) => m.key.toLowerCase().includes(lower) || m.value.toLowerCase().includes(lower)).slice(0, k);
      return { results: filtered };
    }

    const scored = memories
      .filter((m) => m.embedding.length > 0)
      .map((m) => ({ memory: m, score: cosine(qvec, m.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    // bump lastAccessed for retrieved memories
    await prisma.memory.updateMany({
      where: { id: { in: scored.map((s) => s.memory.id) } },
      data: { lastAccessed: new Date() },
    });

    return { results: scored.map((s) => ({ ...s.memory, score: s.score })) };
  });
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
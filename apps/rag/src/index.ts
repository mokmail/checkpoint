import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { config } from '@ai-chat/config';
import { prisma } from './db.js';
import { ollama } from './providers/ollama.js';
import { addChunks, search, deleteChunk, deleteCollection, pingChroma } from './vector.js';
import { parseFile, chunkText } from './parse.js';
import { getSearchProvider, configuredProviderId } from './search.js';

const fastify = Fastify({ logger: true });

// ─── health ────────────────────────────────────────────────────────────────
fastify.get('/', async () => {
  const chroma = await pingChroma();
  return {
    message: 'AI Chat RAG Service',
    provider: 'ollama',
    chroma: chroma ? 'ok' : 'unavailable',
    vectorDbUrl: config.vectorDbUrl,
  };
});

fastify.get('/health', async () => {
  const chroma = await pingChroma();
  return { status: chroma ? 'ok' : 'degraded', chroma: chroma ? 'ok' : 'unavailable' };
});

// ─── Knowledge Bases (spec §2.5) ───────────────────────────────────────────

// POST /knowledge-bases — create KB
fastify.post('/knowledge-bases', async (req, reply) => {
  const { name, description, embeddingModel } = (req.body as {
    name?: string;
    description?: string;
    embeddingModel?: string;
  }) ?? {};
  if (!name?.trim()) return reply.status(400).send({ error: 'name is required' });
  const kb = await prisma.knowledgeBase.create({
    data: {
      name: name.trim(),
      description,
      embeddingModel: embeddingModel || config.ollamaEmbeddingModel,
    },
  });
  return reply.status(201).send({ knowledgeBase: kb });
});

// GET /knowledge-bases — list
fastify.get('/knowledge-bases', async () => {
  const kbs = await prisma.knowledgeBase.findMany({
    include: { _count: { select: { documents: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return { knowledgeBases: kbs };
});

// GET /knowledge-bases/:id
fastify.get('/knowledge-bases/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const kb = await prisma.knowledgeBase.findUnique({
    where: { id },
    include: { documents: true },
  });
  if (!kb) return reply.status(404).send({ error: 'Knowledge base not found' });
  return { knowledgeBase: kb };
});

// DELETE /knowledge-bases/:id
fastify.delete('/knowledge-bases/:id', async (req, reply) => {
  const { id } = req.params as { id: string };
  const kb = await prisma.knowledgeBase.findUnique({ where: { id } });
  if (!kb) return reply.status(404).send({ error: 'Knowledge base not found' });
  // delete vector collection + DB rows
  await deleteCollection(id);
  await prisma.knowledgeBase.delete({ where: { id } });
  return reply.status(204).send();
});

// POST /knowledge-bases/:id/documents — upload document (multipart file or JSON text)
fastify.post('/knowledge-bases/:id/documents', async (req, reply) => {
  const { id } = req.params as { id: string };
  const kb = await prisma.knowledgeBase.findUnique({ where: { id } });
  if (!kb) return reply.status(404).send({ error: 'Knowledge base not found' });

  // detect multipart vs json
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    const files: { name: string; data: Buffer }[] = [];
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        files.push({ name: part.filename, data: buf });
      }
    }
    if (files.length === 0) return reply.status(400).send({ error: 'No files uploaded' });

    const added: string[] = [];
    for (const file of files) {
      const parsed = await parseFile(file.name, file.data);
      const doc = await prisma.document.create({
        data: { knowledgeBaseId: id, title: parsed.title, content: parsed.text },
      });
      const chunks = chunkText(parsed.text);
      const chunkRows = await Promise.all(
        chunks.map(async (content, i) => {
          const ch = await prisma.documentChunk.create({
            data: { documentId: doc.id, content, chunkIndex: i },
          });
          return { id: ch.id, content, metadata: { documentId: doc.id, chunkIndex: i } };
        }),
      );
      await addChunks(id, chunkRows);
      await prisma.document.update({ where: { id: doc.id }, data: { chunkCount: chunks.length } });
      added.push(doc.id);
    }
    return { added, count: added.length };
  }

  // JSON body: { title, content }
  const { title, content } = (req.body as { title?: string; content?: string }) ?? {};
  if (!content?.trim()) return reply.status(400).send({ error: 'content is required' });
  const doc = await prisma.document.create({
    data: { knowledgeBaseId: id, title: title || 'Untitled', content },
  });
  const chunks = chunkText(content);
  const chunkRows = await Promise.all(
    chunks.map(async (c, i) => {
      const ch = await prisma.documentChunk.create({
        data: { documentId: doc.id, content: c, chunkIndex: i },
      });
      return { id: ch.id, content: c, metadata: { documentId: doc.id, chunkIndex: i } };
    }),
  );
  await addChunks(id, chunkRows);
  await prisma.document.update({ where: { id: doc.id }, data: { chunkCount: chunks.length } });
  return reply.status(201).send({ document: doc, chunkCount: chunks.length });
});

// GET /knowledge-bases/:id/documents — list documents
fastify.get('/knowledge-bases/:id/documents', async (req, reply) => {
  const { id } = req.params as { id: string };
  const kb = await prisma.knowledgeBase.findUnique({ where: { id } });
  if (!kb) return reply.status(404).send({ error: 'Knowledge base not found' });
  const documents = await prisma.document.findMany({
    where: { knowledgeBaseId: id },
    orderBy: { uploadedAt: 'desc' },
  });
  return { documents };
});

// DELETE /knowledge-bases/:id/documents/:docId
fastify.delete('/knowledge-bases/:id/documents/:docId', async (req, reply) => {
  const { id, docId } = req.params as { id: string; docId: string };
  const doc = await prisma.document.findFirst({ where: { id: docId, knowledgeBaseId: id } });
  if (!doc) return reply.status(404).send({ error: 'Document not found' });
  const chunks = await prisma.documentChunk.findMany({ where: { documentId: docId }, select: { id: true } });
  await deleteChunk(id, chunks.map((c) => c.id));
  await prisma.document.delete({ where: { id: docId } });
  return reply.status(204).send();
});

// POST /knowledge-bases/:id/search — search documents in a KB
fastify.post('/knowledge-bases/:id/search', async (req, reply) => {
  const { id } = req.params as { id: string };
  const { query, topK } = (req.body as { query?: string; topK?: number }) ?? {};
  if (!query) return reply.status(400).send({ error: 'query is required' });
  const kb = await prisma.knowledgeBase.findUnique({ where: { id } });
  if (!kb) return reply.status(404).send({ error: 'Knowledge base not found' });
  const results = await search(id, query, topK ?? 4);
  return { results };
});

// POST /web/search — web search via configured provider (DuckDuckGo/SearXNG/Tavily)
fastify.post('/web/search', async (req, reply) => {
  const { query, topK } = (req.body as { query?: string; topK?: number }) ?? {};
  if (!query) return reply.status(400).send({ error: 'query is required' });
  try {
    const provider = getSearchProvider();
    const results = await provider.search(query, topK ?? 5);
    return { provider: provider.id, results };
  } catch (err) {
    fastify.log.error(err);
    return reply.status(502).send({ error: `Web search failed: ${err instanceof Error ? err.message : err}` });
  }
});

// GET /web/search/provider — which provider is active
fastify.get('/web/search/provider', async () => ({ provider: configuredProviderId() }));

// POST /web/fetch — fetch a web page and extract readable text
fastify.post('/web/fetch', async (req, reply) => {
  const { url } = (req.body as { url?: string }) ?? {};
  if (!url) return reply.status(400).send({ error: 'url is required' });
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AIChatRAG/1.0 (+https://github.com/ai-chat)', 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
    });
    const contentType = res.headers.get('content-type') || '';
    const html = await res.text();
    const extracted = extractReadableText(html);
    return {
      url,
      finalUrl: res.url || url,
      title: extracted.title,
      text: extracted.text.slice(0, 50000),
      length: extracted.text.length,
      contentType,
    };
  } catch (err) {
    return reply.status(502).send({ error: `Fetch failed: ${err instanceof Error ? err.message : err}` });
  }
});

// POST /web/ingest — fetch a URL, extract text, and ingest into a KB
fastify.post('/web/ingest', async (req, reply) => {
  const { url, knowledgeBaseId, title } = (req.body as { url?: string; knowledgeBaseId?: string; title?: string }) ?? {};
  if (!url) return reply.status(400).send({ error: 'url is required' });
  if (!knowledgeBaseId) return reply.status(400).send({ error: 'knowledgeBaseId is required' });
  const kb = await prisma.knowledgeBase.findUnique({ where: { id: knowledgeBaseId } });
  if (!kb) return reply.status(404).send({ error: 'Knowledge base not found' });
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'AIChatRAG/1.0 (+https://github.com/ai-chat)', 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
    });
    const html = await res.text();
    const extracted = extractReadableText(html);
    const doc = await prisma.document.create({
      data: { knowledgeBaseId, title: title || extracted.title || url, content: extracted.text },
    });
    const chunks = chunkText(extracted.text);
    const chunkRows = await Promise.all(
      chunks.map(async (c, i) => {
        const ch = await prisma.documentChunk.create({ data: { documentId: doc.id, content: c, chunkIndex: i } });
        return { id: ch.id, content: c, metadata: { documentId: doc.id, chunkIndex: i, source: url } };
      }),
    );
    await addChunks(knowledgeBaseId, chunkRows);
    await prisma.document.update({ where: { id: doc.id }, data: { chunkCount: chunks.length } });
    return { document: doc, chunkCount: chunks.length, title: extracted.title };
  } catch (err) {
    return reply.status(502).send({ error: `Web ingest failed: ${err instanceof Error ? err.message : err}` });
  }
});

function extractReadableText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = (titleMatch?.[1] ?? '').trim();
  // remove scripts/styles/nav/footer/aside/header
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  // prefer <main> or <article> content if present
  const mainMatch = cleaned.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
  if (mainMatch) cleaned = mainMatch[1];
  // strip remaining tags
  const text = cleaned
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { title, text };
}

// ─── Legacy endpoints (backward compat with frontend KnowledgePanel) ───────

// POST /ingest — ingest raw text into a default/anonymous collection
fastify.post('/ingest', async (req, reply) => {
  const { documents } = (req.body as { documents?: { id: string; content: string }[] }) ?? {};
  if (!documents?.length) return reply.status(400).send({ error: 'documents required' });
  const defaultKb = await getOrCreateDefaultKb();
  const added: string[] = [];
  for (const doc of documents) {
    const chunks = chunkText(doc.content);
    const dbDoc = await prisma.document.create({
      data: { knowledgeBaseId: defaultKb.id, title: doc.id, content: doc.content },
    });
    const chunkRows = await Promise.all(
      chunks.map(async (c, i) => {
        const ch = await prisma.documentChunk.create({ data: { documentId: dbDoc.id, content: c, chunkIndex: i } });
        return { id: ch.id, content: c, metadata: { documentId: dbDoc.id, chunkIndex: i, source: doc.id } };
      }),
    );
    await addChunks(defaultKb.id, chunkRows);
    await prisma.document.update({ where: { id: dbDoc.id }, data: { chunkCount: chunks.length } });
    added.push(dbDoc.id);
  }
  return { added, count: added.length };
});

// POST /query — search across the default KB
fastify.post('/query', async (req, reply) => {
  const { query, topK = 4 } = (req.body as { query?: string; topK?: number }) ?? {};
  if (!query) return reply.status(400).send({ error: 'query required' });
  const defaultKb = await getOrCreateDefaultKb();
  const results = await search(defaultKb.id, query, topK);
  return { results };
});

// POST /ask — retrieve + answer
fastify.post('/ask', async (req, reply) => {
  const { query, topK = 4 } = (req.body as { query?: string; topK?: number }) ?? {};
  if (!query) return reply.status(400).send({ error: 'query required' });
  const defaultKb = await getOrCreateDefaultKb();
  const results = await search(defaultKb.id, query, topK);
  const context = results.map((r) => r.content).join('\n\n');
  const res = await ollama.chat({
    model: config.ollamaChatModel,
    messages: [
      { role: 'system', content: 'Answer the question using only the provided context. If the context is insufficient, say so.' },
      { role: 'user', content: `Context:\n${context}\n\nQuestion: ${query}` },
    ],
  });
  return { answer: res.content, context: context.slice(0, 200), results };
});

async function getOrCreateDefaultKb() {
  const existing = await prisma.knowledgeBase.findUnique({ where: { name: 'Default' } });
  if (existing) return existing;
  return prisma.knowledgeBase.create({ data: { name: 'Default', description: 'Default knowledge base', embeddingModel: config.ollamaEmbeddingModel } });
}

// ─── start ─────────────────────────────────────────────────────────────────
const start = async () => {
  try {
    await fastify.register(multipart, { limits: { fileSize: 25 * 1024 * 1024 } });
    await fastify.listen({ port: Number(process.env.PORT || 3002), host: '0.0.0.0' });
    fastify.log.info({ ollama: config.ollamaBaseUrl, chroma: config.vectorDbUrl }, 'RAG server started');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
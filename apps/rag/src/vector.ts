import { ChromaClient } from 'chromadb';
import { config } from '@ai-chat/config';
import { ollama } from './providers/ollama.js';

const chromaUrl = process.env.VECTOR_DB_URL || config.vectorDbUrl || 'http://localhost:8000';

let client: ChromaClient | null = null;
function getClient(): ChromaClient {
  if (!client) client = new ChromaClient({ path: chromaUrl });
  return client;
}

function collectionName(kbId: string): string {
  // Chroma collection names: [a-zA-Z0-9_-], len 3-63
  return `kb_${kbId.replace(/[^a-zA-Z0-9_-]/g, '')}`.slice(0, 63);
}

async function getOrCreateCollection(kbId: string) {
  const c = getClient();
  try {
    return await c.getOrCreateCollection({ name: collectionName(kbId) });
  } catch (err) {
    throw new Error(`ChromaDB unavailable at ${chromaUrl}: ${err instanceof Error ? err.message : err}`);
  }
}

export interface VectorSearchResult {
  id: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

export async function addChunks(
  kbId: string,
  chunks: { id: string; content: string; metadata?: Record<string, unknown> }[],
): Promise<void> {
  if (chunks.length === 0) return;
  const collection = await getOrCreateCollection(kbId);
  // embed all chunks
  const embeddings = await ollama.embed({
    model: config.ollamaEmbeddingModel,
    input: chunks.map((c) => c.content),
  });
  await collection.add({
    ids: chunks.map((c) => c.id),
    embeddings: embeddings.embeddings,
    documents: chunks.map((c) => c.content),
    metadatas: chunks.map((c) => (c.metadata ?? {}) as Record<string, string | number | boolean>),
  });
}

export async function search(
  kbId: string,
  query: string,
  topK = 4,
): Promise<VectorSearchResult[]> {
  const collection = await getOrCreateCollection(kbId);
  const q = await ollama.embed({ model: config.ollamaEmbeddingModel, input: query });
  const res = await collection.query({
    queryEmbeddings: [q.embeddings[0]],
    nResults: topK,
  });
  const ids = res.ids?.[0] ?? [];
  const docs = res.documents?.[0] ?? [];
  const metas = res.metadatas?.[0] ?? [];
  const dists = res.distances?.[0] ?? [];
  return ids.map((id, i) => ({
    id,
    content: docs[i] ?? '',
    score: dists[i] != null ? 1 - dists[i] : 0, // convert distance to similarity
    metadata: metas[i] ?? {},
  }));
}

export async function deleteChunk(kbId: string, chunkIds: string[]): Promise<void> {
  if (chunkIds.length === 0) return;
  const collection = await getOrCreateCollection(kbId);
  await collection.delete({ ids: chunkIds });
}

export async function deleteCollection(kbId: string): Promise<void> {
  const c = getClient();
  try {
    await c.deleteCollection({ name: collectionName(kbId) });
  } catch {
    // collection may not exist
  }
}

export async function pingChroma(): Promise<boolean> {
  try {
    const c = getClient();
    await c.heartbeat();
    return true;
  } catch {
    return false;
  }
}
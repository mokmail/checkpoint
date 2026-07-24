export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow?: number;
  capabilities: string[];
  size?: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  tokens?: number;
  createdAt: number;
  streaming?: boolean;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  messages: StoredMessage[];
  createdAt: number;
  updatedAt: number;
  pinned?: boolean;
  archived?: boolean;
  systemPrompt?: string;
}

export interface ChatSettings {
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  agentId?: string | null;
  ragMode?: boolean;
  sendOnEnter: boolean;
}

export interface Memory {
  id: string;
  key: string;
  value: string;
  createdAt: number;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model?: string;
  createdAt: number;
}

const API = '/api';
const RAG = '/rag';

/* ---------- Models ---------- */
export async function listModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${API}/models`);
  if (!res.ok) throw new Error(`Failed to load models (${res.status})`);
  const data = await res.json();
  return data.models ?? [];
}

export async function testModel(model: string): Promise<boolean> {
  try {
    const res = await fetch(`${API}/models/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ---------- Chat ---------- */
export interface StreamOpts {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  ragMode?: boolean;
}

export async function* streamChat(
  model: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  opts?: StreamOpts,
): AsyncGenerator<{ content?: string; done: boolean }> {
  const sysMessages: ChatMessage[] = [];
  if (opts?.systemPrompt?.trim()) {
    sysMessages.push({ role: 'system', content: opts.systemPrompt.trim() });
  }

  let finalMessages = [...sysMessages, ...messages];

  if (opts?.ragMode) {
    const userText = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    if (userText) {
      try {
        const ctx = await ragQuery(userText, 4);
        const ctxText = ctx.map((r) => r.content).join('\n\n---\n\n');
        if (ctxText) {
          finalMessages = [
            ...sysMessages,
            { role: 'system', content: `Relevant knowledge base context:\n\n${ctxText}` },
            ...messages,
          ];
        }
      } catch {
        // RAG service unavailable — proceed without context
      }
    }
  }

  const res = await fetch(`${API}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: finalMessages,
      stream: true,
      temperature: opts?.temperature,
      maxTokens: opts?.maxTokens,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Chat failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') {
        yield { done: true };
        return;
      }
      try {
        const chunk = JSON.parse(payload);
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.content) yield { content: chunk.content, done: false };
      } catch (err) {
        if (err instanceof SyntaxError) continue;
        throw err;
      }
    }
  }
  yield { done: true };
}

/* ---------- RAG / Knowledge ---------- */
export interface RagResult {
  id: string;
  content: string;
  score: number;
}

export async function ragIngest(documents: { id: string; content: string }[]): Promise<{ added: string[]; count: number }> {
  const res = await fetch(`${RAG}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documents }),
  });
  if (!res.ok) throw new Error(`RAG ingest failed (${res.status})`);
  return res.json();
}

export async function ragQuery(query: string, topK = 4): Promise<RagResult[]> {
  const res = await fetch(`${RAG}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, topK }),
  });
  if (!res.ok) throw new Error(`RAG query failed (${res.status})`);
  const data = await res.json();
  return data.results ?? [];
}

export async function ragAsk(query: string, topK = 4): Promise<{ answer: string; context: string }> {
  const res = await fetch(`${RAG}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, topK }),
  });
  if (!res.ok) throw new Error(`RAG ask failed (${res.status})`);
  return res.json();
}

export async function ragHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${RAG}/`);
    return res.ok;
  } catch {
    return false;
  }
}

/* ---------- Auth ---------- */
export interface AuthUser {
  id: string;
  email: string;
  username: string;
  avatar: string | null;
  roles: string[];
  createdAt: number;
  lastLogin: number | null;
}

export interface AuthResponse {
  user: AuthUser;
  token: string;
  refreshToken: string;
}

const TOKEN_KEY = 'checkpoint.token.v1';
const REFRESH_KEY = 'checkpoint.refresh.v1';
const USER_KEY = 'checkpoint.user.v1';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}
export function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}
export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
}
function storeAuth(auth: AuthResponse): void {
  localStorage.setItem(TOKEN_KEY, auth.token);
  localStorage.setItem(REFRESH_KEY, auth.refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(auth.user));
}

function authHeaders(): Record<string, string> {
  const t = getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function register(email: string, username: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username, password }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Registration failed (${res.status})`);
  }
  const data = (await res.json()) as AuthResponse;
  storeAuth(data);
  return data;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Login failed (${res.status})`);
  }
  const data = (await res.json()) as AuthResponse;
  storeAuth(data);
  return data;
}

export async function logout(): Promise<void> {
  const refreshToken = getStoredRefreshToken();
  try {
    await fetch(`${API}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    // ignore network errors on logout
  }
  clearAuth();
}

export async function fetchMe(): Promise<AuthUser> {
  const res = await fetch(`${API}/users/me`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`Not authenticated (${res.status})`);
  const data = await res.json();
  return data.user as AuthUser;
}

/* ---------- Conversations (server-backed) ---------- */
export interface ServerConversation {
  id: string;
  title: string;
  model: string;
  userId: string;
  archived: boolean;
  pinned: boolean;
  tags: string[];
  systemPrompt: string | null;
  createdAt: string;
  updatedAt: string;
  messages?: ServerMessage[];
}

export interface ServerMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string | null;
  tokens: number | null;
  metadata: Record<string, unknown> | null;
  parentMessageId: string | null;
  createdAt: string;
}

export async function listConversations(): Promise<ServerConversation[]> {
  const res = await fetch(`${API}/conversations`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`Failed to load conversations (${res.status})`);
  const data = await res.json();
  return data.conversations as ServerConversation[];
}

export async function createConversation(opts?: { title?: string; model?: string; systemPrompt?: string }): Promise<ServerConversation> {
  const res = await fetch(`${API}/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(opts ?? {}),
  });
  if (!res.ok) throw new Error(`Failed to create conversation (${res.status})`);
  const data = await res.json();
  return data.conversation as ServerConversation;
}

export async function getConversation(id: string): Promise<ServerConversation> {
  const res = await fetch(`${API}/conversations/${id}`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`Failed to load conversation (${res.status})`);
  const data = await res.json();
  return data.conversation as ServerConversation;
}

export async function updateConversation(id: string, body: Partial<{ title: string; model: string; archived: boolean; pinned: boolean; tags: string[]; systemPrompt: string }>): Promise<ServerConversation> {
  const res = await fetch(`${API}/conversations/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to update conversation (${res.status})`);
  const data = await res.json();
  return data.conversation as ServerConversation;
}

export async function deleteConversation(id: string): Promise<void> {
  const res = await fetch(`${API}/conversations/${id}`, { method: 'DELETE', headers: { ...authHeaders() } });
  if (!res.ok && res.status !== 204) throw new Error(`Failed to delete conversation (${res.status})`);
}

export async function* sendMessageStream(
  conversationId: string,
  content: string,
  opts?: { model?: string; temperature?: number; maxTokens?: number },
): AsyncGenerator<{ content?: string; messageId?: string; done: boolean }> {
  const res = await fetch(`${API}/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ content, stream: true, ...opts }),
  });
  if (!res.ok || !res.body) throw new Error(`Send failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') { yield { done: true }; return; }
      try {
        const chunk = JSON.parse(payload);
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.content) yield { content: chunk.content, messageId: chunk.messageId, done: false };
      } catch (err) {
        if (err instanceof SyntaxError) continue;
        throw err;
      }
    }
  }
  yield { done: true };
}

export async function* regenerateStream(
  conversationId: string,
  messageId: string,
  opts?: { model?: string; temperature?: number; maxTokens?: number },
): AsyncGenerator<{ content?: string; done: boolean }> {
  const res = await fetch(`${API}/conversations/${conversationId}/messages/${messageId}/regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ stream: true, ...opts }),
  });
  if (!res.ok || !res.body) throw new Error(`Regenerate failed (${res.status})`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') { yield { done: true }; return; }
      try {
        const chunk = JSON.parse(payload);
        if (chunk.error) throw new Error(chunk.error);
        if (chunk.content) yield { content: chunk.content, done: false };
      } catch (err) {
        if (err instanceof SyntaxError) continue;
        throw err;
      }
    }
  }
  yield { done: true };
}

/* ---------- Providers (multi-model) ---------- */
export interface ProviderInfo {
  id: string;
  name: string;
  type: 'openai' | 'ollama' | 'custom';
  baseUrl: string;
}

export async function listProviders(): Promise<ProviderInfo[]> {
  const res = await fetch(`${API}/providers`);
  if (!res.ok) throw new Error(`Failed to load providers (${res.status})`);
  const data = await res.json();
  return data.providers as ProviderInfo[];
}

/* ---------- Memories (server-backed) ---------- */
export interface ServerMemory {
  id: string;
  userId: string;
  key: string;
  value: string;
  importance: number;
  lastAccessed: string;
  expiresAt: string | null;
  createdAt: string;
  score?: number;
}

export async function listMemories(): Promise<ServerMemory[]> {
  const res = await fetch(`${API}/memories`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`Failed to load memories (${res.status})`);
  const data = await res.json();
  return data.memories as ServerMemory[];
}

export async function createMemory(key: string, value: string): Promise<ServerMemory> {
  const res = await fetch(`${API}/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) throw new Error(`Failed to create memory (${res.status})`);
  const data = await res.json();
  return data.memory as ServerMemory;
}

export async function updateMemory(id: string, key: string, value: string): Promise<ServerMemory> {
  const res = await fetch(`${API}/memories/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ key, value }),
  });
  if (!res.ok) throw new Error(`Failed to update memory (${res.status})`);
  const data = await res.json();
  return data.memory as ServerMemory;
}

export async function deleteMemory(id: string): Promise<void> {
  const res = await fetch(`${API}/memories/${id}`, { method: 'DELETE', headers: { ...authHeaders() } });
  if (!res.ok && res.status !== 204) throw new Error(`Failed to delete memory (${res.status})`);
}

/* ---------- Agents (server-backed) ---------- */
export interface ServerAgent {
  id: string;
  name: string;
  description: string | null;
  systemPrompt: string;
  model: string | null;
  tools: string[];
  knowledgeBases: string[];
  variables: unknown;
  accessType: 'public' | 'private' | 'group';
  accessGroups: string[];
  accessUsers: string[];
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export async function listAgents(): Promise<ServerAgent[]> {
  const res = await fetch(`${API}/agents`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`Failed to load agents (${res.status})`);
  const data = await res.json();
  return data.agents as ServerAgent[];
}

export async function createAgent(a: { name: string; description?: string; systemPrompt: string; model?: string }): Promise<ServerAgent> {
  const res = await fetch(`${API}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(a),
  });
  if (!res.ok) throw new Error(`Failed to create agent (${res.status})`);
  const data = await res.json();
  return data.agent as ServerAgent;
}

export async function updateAgent(id: string, a: Partial<{ name: string; description: string; systemPrompt: string; model: string }>): Promise<ServerAgent> {
  const res = await fetch(`${API}/agents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(a),
  });
  if (!res.ok) throw new Error(`Failed to update agent (${res.status})`);
  const data = await res.json();
  return data.agent as ServerAgent;
}

export async function deleteAgent(id: string): Promise<void> {
  const res = await fetch(`${API}/agents/${id}`, { method: 'DELETE', headers: { ...authHeaders() } });
  if (!res.ok && res.status !== 204) throw new Error(`Failed to delete agent (${res.status})`);
}

/* ---------- Agent presets ---------- */
export interface AgentPreset {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model?: string;
  tools: string[];
  variables: { name: string; type: string; defaultValue?: unknown; required?: boolean; options?: string[] }[];
  category: string;
  author: string;
}

export async function listAgentPresets(category?: string): Promise<AgentPreset[]> {
  const url = category ? `${API}/agents/presets?category=${encodeURIComponent(category)}` : `${API}/agents/presets`;
  const res = await fetch(url, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`Failed to load presets (${res.status})`);
  const data = await res.json();
  return data.presets as AgentPreset[];
}

export async function installAgentPreset(presetId: string): Promise<ServerAgent> {
  const res = await fetch(`${API}/agents/presets/${presetId}/install`, { method: 'POST', headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`Failed to install preset (${res.status})`);
  const data = await res.json();
  return data.agent as ServerAgent;
}

export async function exportAgent(id: string): Promise<void> {
  const res = await fetch(`${API}/agents/${id}/export`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`Failed to export agent (${res.status})`);
  const agent = await res.json();
  const blob = new Blob([JSON.stringify(agent, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${agent.name.replace(/[^a-z0-9]+/gi, '-')}.agent.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------- Plugins ---------- */
export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string | null;
  author: string | null;
  type: string;
  enabled: boolean;
  active: boolean;
  hooks: string[];
  permissions: string[];
  source: string;
  config: Record<string, unknown> | null;
}

export async function listPlugins(): Promise<Plugin[]> {
  const res = await fetch(`${API}/plugins`, { headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`Failed to load plugins (${res.status})`);
  const data = await res.json();
  return data.plugins as Plugin[];
}

export async function enablePlugin(name: string): Promise<void> {
  const res = await fetch(`${API}/plugins/${name}/enable`, { method: 'POST', headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`Failed to enable plugin (${res.status})`);
}

export async function disablePlugin(name: string): Promise<void> {
  const res = await fetch(`${API}/plugins/${name}/disable`, { method: 'POST', headers: { ...authHeaders() } });
  if (!res.ok) throw new Error(`Failed to disable plugin (${res.status})`);
}

export async function updatePluginConfig(name: string, config: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API}/plugins/${name}/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ config }),
  });
  if (!res.ok) throw new Error(`Failed to update plugin config (${res.status})`);
}

/* ---------- Knowledge Bases (server-backed via RAG service) ---------- */
export interface KnowledgeBase {
  id: string;
  name: string;
  description: string | null;
  embeddingModel: string;
  createdAt: string;
  _count?: { documents: number };
}

export interface KbDocument {
  id: string;
  knowledgeBaseId: string;
  title: string;
  content: string;
  chunkCount: number;
  uploadedAt: string;
}

export async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  const res = await fetch(`${RAG}/knowledge-bases`);
  if (!res.ok) throw new Error(`Failed to load knowledge bases (${res.status})`);
  const data = await res.json();
  return data.knowledgeBases as KnowledgeBase[];
}

export async function createKnowledgeBase(name: string, description?: string): Promise<KnowledgeBase> {
  const res = await fetch(`${RAG}/knowledge-bases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description }),
  });
  if (!res.ok) throw new Error(`Failed to create knowledge base (${res.status})`);
  const data = await res.json();
  return data.knowledgeBase as KnowledgeBase;
}

export async function deleteKnowledgeBase(id: string): Promise<void> {
  const res = await fetch(`${RAG}/knowledge-bases/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`Failed to delete knowledge base (${res.status})`);
}

export async function listKbDocuments(kbId: string): Promise<KbDocument[]> {
  const res = await fetch(`${RAG}/knowledge-bases/${kbId}/documents`);
  if (!res.ok) throw new Error(`Failed to load documents (${res.status})`);
  const data = await res.json();
  return data.documents as KbDocument[];
}

export async function uploadKbDocumentText(kbId: string, title: string, content: string): Promise<{ document: KbDocument; chunkCount: number }> {
  const res = await fetch(`${RAG}/knowledge-bases/${kbId}/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content }),
  });
  if (!res.ok) throw new Error(`Failed to upload document (${res.status})`);
  return res.json();
}

export async function uploadKbDocumentFile(kbId: string, file: File): Promise<{ added: string[]; count: number }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${RAG}/knowledge-bases/${kbId}/documents`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Failed to upload file (${res.status})`);
  return res.json();
}

export async function deleteKbDocument(kbId: string, docId: string): Promise<void> {
  const res = await fetch(`${RAG}/knowledge-bases/${kbId}/documents/${docId}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 204) throw new Error(`Failed to delete document (${res.status})`);
}

export async function searchKnowledgeBase(kbId: string, query: string, topK = 4): Promise<RagResult[]> {
  const res = await fetch(`${RAG}/knowledge-bases/${kbId}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, topK }),
  });
  if (!res.ok) throw new Error(`KB search failed (${res.status})`);
  const data = await res.json();
  return data.results as RagResult[];
}

/* ---------- Notes ---------- */
export interface Note {
  id: string;
  title: string;
  content: string;
  folderId?: string | null;
  tags: string[];
  sharedWith: string[];
  authorId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  history?: { count: number };
}

export interface Folder {
  id: string;
  name: string;
  parentId?: string | null;
}

function authToken(): HeadersInit {
  return { ...authHeaders() };
}

export async function listNotes(search?: string): Promise<Note[]> {
  const url = search ? `${API}/notes?search=${encodeURIComponent(search)}` : `${API}/notes`;
  const res = await fetch(url, { headers: authToken() });
  if (!res.ok) throw new Error(`Failed to load notes (${res.status})`);
  return (await res.json()).notes as Note[];
}
export async function createNote(n: { title: string; content: string; folderId?: string; tags?: string[] }): Promise<Note> {
  const res = await fetch(`${API}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authToken() }, body: JSON.stringify(n) });
  if (!res.ok) throw new Error(`Failed to create note (${res.status})`);
  return (await res.json()).note as Note;
}
export async function updateNote(id: string, patch: Partial<{ title: string; content: string; folderId: string; tags: string[]; sharedWith: string[] }>): Promise<Note> {
  const res = await fetch(`${API}/notes/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authToken() }, body: JSON.stringify(patch) });
  if (!res.ok) throw new Error(`Failed to update note (${res.status})`);
  return (await res.json()).note as Note;
}
export async function deleteNote(id: string): Promise<void> {
  const res = await fetch(`${API}/notes/${id}`, { method: 'DELETE', headers: authToken() });
  if (!res.ok && res.status !== 204) throw new Error(`Failed to delete (${res.status})`);
}
export async function listFolders(): Promise<Folder[]> {
  const res = await fetch(`${API}/folders`, { headers: authToken() });
  if (!res.ok) throw new Error(`Failed to load folders (${res.status})`);
  return (await res.json()).folders as Folder[];
}
export async function createFolder(name: string): Promise<Folder> {
  const res = await fetch(`${API}/folders`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authToken() }, body: JSON.stringify({ name }) });
  if (!res.ok) throw new Error(`Failed to create folder (${res.status})`);
  return (await res.json()).folder as Folder;
}

/* ---------- Workflows ---------- */
export interface Workflow {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  trigger: Record<string, unknown>;
  steps: Array<Record<string, unknown>>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}
export async function listWorkflows(): Promise<Workflow[]> {
  const res = await fetch(`${API}/workflows`, { headers: authToken() });
  if (!res.ok) throw new Error(`Failed to load workflows (${res.status})`);
  return (await res.json()).workflows as Workflow[];
}
export async function createWorkflow(w: { name: string; description?: string; steps?: Array<Record<string, unknown>>; trigger?: Record<string, unknown>; enabled?: boolean }): Promise<Workflow> {
  const res = await fetch(`${API}/workflows`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authToken() }, body: JSON.stringify(w) });
  if (!res.ok) throw new Error(`Failed to create workflow (${res.status})`);
  return (await res.json()).workflow as Workflow;
}
export async function updateWorkflow(id: string, patch: Partial<Workflow>): Promise<Workflow> {
  const res = await fetch(`${API}/workflows/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authToken() }, body: JSON.stringify(patch) });
  if (!res.ok) throw new Error(`Failed to update workflow (${res.status})`);
  return (await res.json()).workflow as Workflow;
}
export async function deleteWorkflow(id: string): Promise<void> {
  const res = await fetch(`${API}/workflows/${id}`, { method: 'DELETE', headers: authToken() });
  if (!res.ok && res.status !== 204) throw new Error(`Failed to delete (${res.status})`);
}
export async function executeWorkflow(id: string): Promise<{ executed: boolean; results: Array<Record<string, unknown>> }> {
  const res = await fetch(`${API}/workflows/${id}/execute`, { method: 'POST', headers: authToken() });
  if (!res.ok) throw new Error(`Failed to execute (${res.status})`);
  return res.json();
}

/* ---------- Calendar ---------- */
export interface CalendarEvent {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  start: string;
  end: string;
  allDay: boolean;
  recurring?: Record<string, unknown> | null;
  attendees: string[];
  color: string;
  reminders?: Record<string, unknown> | null;
}
export async function listEvents(from?: string, to?: string): Promise<CalendarEvent[]> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const qs = params.toString();
  const res = await fetch(`${API}/calendar/events${qs ? '?' + qs : ''}`, { headers: authToken() });
  if (!res.ok) throw new Error(`Failed to load events (${res.status})`);
  return (await res.json()).events as CalendarEvent[];
}
export async function createEvent(e: { title: string; start: string; end: string; description?: string; allDay?: boolean; attendees?: string[]; color?: string }): Promise<CalendarEvent> {
  const res = await fetch(`${API}/calendar/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authToken() }, body: JSON.stringify(e) });
  if (!res.ok) throw new Error(`Failed to create event (${res.status})`);
  return (await res.json()).event as CalendarEvent;
}
export async function updateEvent(id: string, patch: Partial<{ title: string; description: string; start: string; end: string; allDay: boolean; color: string }>): Promise<CalendarEvent> {
  const res = await fetch(`${API}/calendar/events/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authToken() }, body: JSON.stringify(patch) });
  if (!res.ok) throw new Error(`Failed to update event (${res.status})`);
  return (await res.json()).event as CalendarEvent;
}
export async function deleteEvent(id: string): Promise<void> {
  const res = await fetch(`${API}/calendar/events/${id}`, { method: 'DELETE', headers: authToken() });
  if (!res.ok && res.status !== 204) throw new Error(`Failed to delete (${res.status})`);
}
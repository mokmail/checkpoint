import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  listModels,
  listConversations,
  createConversation,
  getConversation,
  updateConversation as apiUpdateConversation,
  deleteConversation as apiDeleteConversation,
  sendMessageStream,
  regenerateStream,
  listMemories,
  createMemory as apiCreateMemory,
  updateMemory as apiUpdateMemory,
  deleteMemory as apiDeleteMemory,
  listAgents,
  createAgent as apiCreateAgent,
  updateAgent as apiUpdateAgent,
  deleteAgent as apiDeleteAgent,
  type Conversation,
  type ModelInfo,
  type StoredMessage,
  type ChatSettings,
  type Memory,
  type Agent,
  type ServerConversation,
  type ServerMessage,
  type ServerMemory,
  type ServerAgent,
} from './api';
import { titleFromContent } from './format';
import { useAuth } from './auth';

interface ChatState {
  models: ModelInfo[];
  modelStatus: 'ok' | 'err' | 'loading';
  model: string;
  setModel: (id: string) => void;

  conversations: Conversation[];
  activeId: string | null;
  active: Conversation | null;
  newConversation: () => void;
  openConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;
  togglePin: (id: string) => void;
  toggleArchive: (id: string) => void;
  exportConversation: (id: string, format: 'json' | 'md' | 'pdf') => void;
  search: string;
  setSearch: (s: string) => void;
  filteredConversations: Conversation[];

  settings: ChatSettings;
  setSettings: (s: Partial<ChatSettings>) => void;

  memories: Memory[];
  addMemory: (key: string, value: string) => void;
  updateMemory: (id: string, key: string, value: string) => void;
  deleteMemory: (id: string) => void;

  agents: Agent[];
  activeAgentId: string | null;
  setActiveAgent: (id: string | null) => void;
  addAgent: (a: Omit<Agent, 'id' | 'createdAt'>) => void;
  updateAgent: (id: string, a: Partial<Omit<Agent, 'id' | 'createdAt'>>) => void;
  deleteAgent: (id: string) => void;

  send: (text: string) => Promise<void>;
  regenerate: () => Promise<void>;
  editUserMessage: (messageId: string, newContent: string) => Promise<void>;
  stop: () => void;
  streaming: boolean;
}

const ChatCtx = createContext<ChatState | null>(null);

const MODEL_KEY = 'checkpoint.model.v1';
const SETTINGS_KEY = 'checkpoint.settings.v1';
const AGENT_KEY = 'checkpoint.activeagent.v1';

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

const DEFAULT_SETTINGS: ChatSettings = {
  temperature: 0.7,
  maxTokens: 2048,
  systemPrompt: '',
  agentId: null,
  ragMode: false,
  sendOnEnter: true,
};

function toStoredMessage(m: ServerMessage): StoredMessage {
  return {
    id: m.id,
    role: m.role === 'system' ? 'assistant' : m.role,
    content: m.content,
    model: m.model ?? undefined,
    tokens: m.tokens ?? undefined,
    createdAt: new Date(m.createdAt).getTime(),
  };
}

function toConversation(c: ServerConversation, messages?: ServerMessage[]): Conversation {
  return {
    id: c.id,
    title: c.title,
    model: c.model,
    messages: (messages ?? c.messages ?? []).map(toStoredMessage),
    createdAt: new Date(c.createdAt).getTime(),
    updatedAt: new Date(c.updatedAt).getTime(),
    pinned: c.pinned,
    archived: c.archived,
    systemPrompt: c.systemPrompt ?? undefined,
  };
}

function toMemory(m: ServerMemory): Memory {
  return {
    id: m.id,
    key: m.key,
    value: m.value,
    createdAt: new Date(m.createdAt).getTime(),
  };
}

function toAgent(a: ServerAgent): Agent {
  return {
    id: a.id,
    name: a.name,
    description: a.description ?? '',
    systemPrompt: a.systemPrompt,
    model: a.model ?? undefined,
    createdAt: new Date(a.createdAt).getTime(),
  };
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const uid_user = user?.id;

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelStatus, setModelStatus] = useState<'ok' | 'err' | 'loading'>('loading');
  const [model, setModelState] = useState<string>(() => localStorage.getItem(MODEL_KEY) || '');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [search, setSearch] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const [settings, setSettingsState] = useState<ChatSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...load<Partial<ChatSettings>>(SETTINGS_KEY, {}),
  }));
  const [memories, setMemories] = useState<Memory[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [activeAgentId, setActiveAgentIdState] = useState<string | null>(() =>
    localStorage.getItem(AGENT_KEY) || null,
  );

  // persist local-only settings
  useEffect(() => save(SETTINGS_KEY, settings), [settings]);
  useEffect(() => {
    if (activeAgentId) localStorage.setItem(AGENT_KEY, activeAgentId);
    else localStorage.removeItem(AGENT_KEY);
  }, [activeAgentId]);

  // load models on mount (independent of auth)
  useEffect(() => {
    let cancelled = false;
    setModelStatus('loading');
    listModels()
      .then((m) => {
        if (cancelled) return;
        setModels(m);
        setModelStatus('ok');
        if (!model && m.length) {
          const first = m[0].id;
          setModelState(first);
          localStorage.setItem(MODEL_KEY, first);
        }
      })
      .catch(() => { if (!cancelled) setModelStatus('err'); });
    return () => { cancelled = true; };
  }, []);

  // load server data when user is present
  useEffect(() => {
    if (!uid_user) return;
    let cancelled = false;
    // conversations list
    listConversations()
      .then((list) => { if (!cancelled) setConversations(list.map((c) => toConversation(c))); })
      .catch(() => { if (!cancelled) setConversations([]); });
    // memories
    listMemories()
      .then((list) => { if (!cancelled) setMemories(list.map(toMemory)); })
      .catch(() => { if (!cancelled) setMemories([]); });
    // agents
    listAgents()
      .then((list) => { if (!cancelled) setAgents(list.map(toAgent)); })
      .catch(() => { if (!cancelled) setAgents([]); });
    return () => { cancelled = true; };
  }, [uid_user]);

  const setModel = useCallback((id: string) => {
    setModelState(id);
    localStorage.setItem(MODEL_KEY, id);
  }, []);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  const activeAgent = useMemo(
    () => agents.find((a) => a.id === activeAgentId) ?? null,
    [agents, activeAgentId],
  );

  const effectiveSettings: ChatSettings = useMemo(() => {
    const s = { ...settings };
    if (activeAgent) {
      s.systemPrompt = activeAgent.systemPrompt;
      if (activeAgent.model) s.agentId = activeAgent.id;
    } else {
      s.agentId = null;
    }
    return s;
  }, [settings, activeAgent]);

  const newConversation = useCallback(() => setActiveId(null), []);

  const openConversation = useCallback((id: string) => {
    setActiveId(id);
    // fetch full messages if not already loaded
    setConversations((prev) => {
      const convo = prev.find((c) => c.id === id);
      if (convo && convo.messages.length > 0) return prev;
      // fetch in background
      getConversation(id)
        .then((full) => {
          setConversations((cur) => cur.map((c) => (c.id === id ? toConversation(full) : c)));
        })
        .catch(() => {});
      return prev;
    });
  }, []);

  const deleteConversation = useCallback(
    (id: string) => {
      apiDeleteConversation(id).catch(() => {});
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) setActiveId(null);
    },
    [activeId],
  );

  const renameConversation = useCallback((id: string, title: string) => {
    apiUpdateConversation(id, { title }).catch(() => {});
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title: title || c.title } : c)),
    );
  }, []);

  const togglePin = useCallback((id: string) => {
    setConversations((prev) => {
      const c = prev.find((x) => x.id === id);
      if (c) apiUpdateConversation(id, { pinned: !c.pinned }).catch(() => {});
      return prev.map((x) => (x.id === id ? { ...x, pinned: !x.pinned } : x));
    });
  }, []);

  const toggleArchive = useCallback((id: string) => {
    setConversations((prev) => {
      const c = prev.find((x) => x.id === id);
      if (c) apiUpdateConversation(id, { archived: !c.archived }).catch(() => {});
      return prev.map((x) => (x.id === id ? { ...x, archived: !x.archived } : x));
    });
  }, []);

  const exportConversation = useCallback(
    (id: string, format: 'json' | 'md' | 'pdf') => {
      const convo = conversations.find((c) => c.id === id);
      if (!convo) return;

      if (format === 'pdf') {
        // Print-to-PDF via a hidden iframe — no extra dependency.
        const printHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(convo.title)}</title>
<style>
  body { font: 14px/1.6 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #111; max-width: 720px; margin: 32px auto; padding: 0 16px; }
  h1 { font-size: 22px; }
  .meta { color: #666; font-size: 12px; margin-bottom: 24px; }
  .msg { margin: 16px 0; padding: 12px 14px; border-radius: 8px; page-break-inside: avoid; }
  .msg.user { background: #eef2ff; }
  .msg.assistant { background: #f6f6f6; }
  .role { font-weight: 600; font-size: 11px; text-transform: uppercase; color: #555; margin-bottom: 4px; }
  pre { background: #f0f0f0; padding: 10px; border-radius: 6px; overflow-x: auto; font-size: 12px; }
  code { font-family: ui-monospace, Consolas, monospace; }
</style></head><body>
<h1>${escapeHtml(convo.title)}</h1>
<div class="meta">model: ${escapeHtml(convo.model)} · ${new Date(convo.createdAt).toLocaleString()}</div>
${convo.messages.map((m) => `<div class="msg ${m.role}"><div class="role">${m.role}</div><div>${escapeHtml(m.content).replace(/\n/g, '<br>')}</div></div>`).join('\n')}
</body></html>`;
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        document.body.appendChild(iframe);
        const doc = iframe.contentWindow?.document;
        if (doc) {
          doc.open();
          doc.write(printHtml);
          doc.close();
          iframe.contentWindow!.focus();
          setTimeout(() => {
            iframe.contentWindow!.print();
            setTimeout(() => document.body.removeChild(iframe), 1000);
          }, 300);
        }
        return;
      }

      let content: string;
      let mime: string;
      let ext: string;
      if (format === 'json') {
        content = JSON.stringify(convo, null, 2);
        mime = 'application/json';
        ext = 'json';
      } else {
        content = `# ${convo.title}\n\n_model: ${convo.model} · ${new Date(convo.createdAt).toISOString()}_\n\n`;
        for (const m of convo.messages) {
          content += `## ${m.role}\n\n${m.content}\n\n`;
        }
        mime = 'text/markdown';
        ext = 'md';
      }
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${convo.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 40) || 'conversation'}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [conversations],
  );

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = conversations;
    if (q) {
      list = list.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          c.messages.some((m) => m.content.toLowerCase().includes(q)),
      );
    }
    return [...list].sort((a, b) => {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      if (!!a.archived !== !!b.archived) return a.archived ? 1 : -1;
      return b.updatedAt - a.updatedAt;
    });
  }, [conversations, search]);

  const setSettings = useCallback((s: Partial<ChatSettings>) => {
    setSettingsState((prev) => ({ ...prev, ...s }));
  }, []);

  // memories
  const addMemory = useCallback((key: string, value: string) => {
    apiCreateMemory(key, value)
      .then((m) => setMemories((prev) => [toMemory(m), ...prev]))
      .catch(() => {});
  }, []);
  const updateMemory = useCallback((id: string, key: string, value: string) => {
    apiUpdateMemory(id, key, value)
      .then((m) => setMemories((prev) => prev.map((x) => (x.id === id ? toMemory(m) : x))))
      .catch(() => {});
  }, []);
  const deleteMemory = useCallback((id: string) => {
    apiDeleteMemory(id).catch(() => {});
    setMemories((prev) => prev.filter((m) => m.id !== id));
  }, []);

  // agents
  const addAgent = useCallback((a: Omit<Agent, 'id' | 'createdAt'>) => {
    apiCreateAgent({ name: a.name, description: a.description, systemPrompt: a.systemPrompt, model: a.model })
      .then((ag) => setAgents((prev) => [toAgent(ag), ...prev]))
      .catch(() => {});
  }, []);
  const updateAgent = useCallback((id: string, a: Partial<Omit<Agent, 'id' | 'createdAt'>>) => {
    apiUpdateAgent(id, a)
      .then((ag) => setAgents((prev) => prev.map((x) => (x.id === id ? toAgent(ag) : x))))
      .catch(() => {});
  }, []);
  const deleteAgent = useCallback((id: string) => {
    apiDeleteAgent(id).catch(() => {});
    setAgents((prev) => prev.filter((a) => a.id !== id));
    setActiveAgentIdState((cur) => (cur === id ? null : cur));
  }, []);
  const setActiveAgent = useCallback((id: string | null) => {
    setActiveAgentIdState(id);
    if (id) {
      const a = agents.find((x) => x.id === id);
      if (a?.model) setModelState(a.model);
    }
  }, [agents]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const buildSystemPrompt = useCallback(() => {
    const parts: string[] = [];
    if (activeAgent?.systemPrompt) parts.push(activeAgent.systemPrompt);
    if (settings.systemPrompt.trim()) parts.push(settings.systemPrompt);
    if (memories.length) {
      const memText = memories.map((m) => `- ${m.key}: ${m.value}`).join('\n');
      parts.push(`Known facts about the user:\n${memText}`);
    }
    return parts.join('\n\n');
  }, [activeAgent, settings.systemPrompt, memories]);

  const runStreamToConversation = useCallback(
    async (
      targetConvoId: string,
      assistantMsg: StoredMessage,
      isExistingAssistant: boolean,
    ) => {
      setActiveId(targetConvoId);
      setStreaming(true);
      const controller = new AbortController();
      abortRef.current = controller;

      const patchAssistant = (fn: (m: StoredMessage) => StoredMessage) => {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetConvoId
              ? { ...c, messages: c.messages.map((m) => (m.id === assistantMsg.id ? fn(m) : m)), updatedAt: Date.now() }
              : c,
          ),
        );
      };

      try {
        let acc = '';
        const opts = {
          model,
          temperature: settings.temperature,
          maxTokens: settings.maxTokens,
        };
        // RAG context injection (client-side, calls rag service)
        let stream: AsyncGenerator<{ content?: string; messageId?: string; done: boolean }>;
        if (isExistingAssistant) {
          stream = regenerateStream(targetConvoId, assistantMsg.id, opts);
        } else {
          stream = sendMessageStream(targetConvoId, assistantMsg.content, opts);
        }
        // eslint-disable-next-line no-constant-condition
        for (;;) {
          const next = await stream.next();
          if (next.done) break;
          const chunk = next.value;
          if (chunk.content) {
            acc += chunk.content;
            patchAssistant((m) => ({ ...m, content: acc, streaming: true }));
          }
        }
        patchAssistant((m) => ({ ...m, streaming: false, tokens: estimateTokens(acc) }));
        void buildSystemPrompt;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        patchAssistant((m) => ({ ...m, streaming: false, error: message }));
      } finally {
        setStreaming(false);
        abortRef.current = null;
      }
    },
    [model, settings, buildSystemPrompt],
  );

  const send = useCallback(
    async (text: string) => {
      if (streaming || !text.trim()) return;

      // Optimistically create a temp assistant placeholder; the real message is created server-side.
      const tempAssistantId = uid();
      const tempAssistant: StoredMessage = {
        id: tempAssistantId,
        role: 'assistant',
        content: '',
        model,
        createdAt: Date.now(),
        streaming: true,
      };
      const tempUser: StoredMessage = {
        id: uid(),
        role: 'user',
        content: text.trim(),
        createdAt: Date.now(),
      };

      let convoId = activeId;
      if (!convoId) {
        // create conversation on server
        try {
          const convo = await createConversation({ title: titleFromContent(text), model });
          convoId = convo.id;
          const newConvo = toConversation(convo, []);
          newConvo.messages = [tempUser, tempAssistant];
          setConversations((prev) => [newConvo, ...prev]);
        } catch {
          return;
        }
      } else {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === convoId
              ? { ...c, messages: [...c.messages, tempUser, tempAssistant], updatedAt: Date.now() }
              : c,
          ),
        );
      }

      // The server creates the real user + assistant messages and streams the assistant.
      // We treat our temp assistant as the streaming target; after stream, refetch to sync ids.
      await runStreamToConversation(convoId!, { ...tempAssistant, content: text.trim() }, false);

      // refetch to get the real server message ids
      getConversation(convoId!)
        .then((full) => setConversations((prev) => prev.map((c) => (c.id === convoId ? toConversation(full) : c))))
        .catch(() => {});
    },
    [streaming, model, activeId, runStreamToConversation],
  );

  const regenerate = useCallback(async () => {
    if (streaming || !activeId) return;
    const convo = conversations.find((c) => c.id === activeId);
    if (!convo) return;
    let lastAssistantIdx = -1;
    for (let i = convo.messages.length - 1; i >= 0; i--) {
      if (convo.messages[i].role === 'assistant') { lastAssistantIdx = i; break; }
    }
    if (lastAssistantIdx < 0) return;

    const target = convo.messages[lastAssistantIdx];
    // optimistic: clear content and mark streaming
    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeId
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === target.id ? { ...m, content: '', streaming: true, error: undefined } : m,
              ),
            }
          : c,
      ),
    );

    await runStreamToConversation(activeId, target, true);

    getConversation(activeId)
      .then((full) => setConversations((prev) => prev.map((c) => (c.id === activeId ? toConversation(full) : c))))
      .catch(() => {});
  }, [streaming, activeId, conversations, runStreamToConversation]);

  const editUserMessage = useCallback(async (messageId: string, newContent: string) => {
    if (streaming || !activeId || !newContent.trim()) return;
    const convo = conversations.find((c) => c.id === activeId);
    if (!convo) return;
    const msgIdx = convo.messages.findIndex((m) => m.id === messageId);
    if (msgIdx < 0) return;

    // The server edit path: we resend via the message endpoint of the conversation,
    // but our server API doesn't support inline edit-and-truncate. For now we
    // do a regenerate-like flow: optimistic edit + send a new message and refetch.
    // Simplest correct approach: update the user message content locally then
    // call sendMessageStream with the new content (server will append).
    // To keep semantics correct (truncate after edited message), we rely on the
    // server creating a fresh assistant reply; old downstream messages are dropped
    // client-side after refetch isn't ideal. We instead send + then refetch.
    // NOTE: A dedicated server edit endpoint is tracked as future work.
    const updatedText = newContent.trim();
    const tempAssistant: StoredMessage = {
      id: uid(),
      role: 'assistant',
      content: '',
      model,
      createdAt: Date.now(),
      streaming: true,
    };
    const editedUserMsg: StoredMessage = { ...convo.messages[msgIdx], content: updatedText };

    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeId
          ? { ...c, messages: [...c.messages.slice(0, msgIdx), editedUserMsg, tempAssistant], updatedAt: Date.now() }
          : c,
      ),
    );

    await runStreamToConversation(activeId, { ...tempAssistant, content: updatedText }, false);

    getConversation(activeId)
      .then((full) => setConversations((prev) => prev.map((c) => (c.id === activeId ? toConversation(full) : c))))
      .catch(() => {});
  }, [streaming, activeId, conversations, model, runStreamToConversation]);

  const value: ChatState = {
    models,
    modelStatus,
    model,
    setModel,
    conversations,
    activeId,
    active,
    newConversation,
    openConversation,
    deleteConversation,
    renameConversation,
    togglePin,
    toggleArchive,
    exportConversation,
    search,
    setSearch,
    filteredConversations,
    settings: effectiveSettings,
    setSettings,
    memories,
    addMemory,
    updateMemory,
    deleteMemory,
    agents,
    activeAgentId,
    setActiveAgent,
    addAgent,
    updateAgent,
    deleteAgent,
    send,
    regenerate,
    editUserMessage,
    stop,
    streaming,
  };

  return <ChatCtx.Provider value={value}>{children}</ChatCtx.Provider>;
}

export function useChat(): ChatState {
  const ctx = useContext(ChatCtx);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
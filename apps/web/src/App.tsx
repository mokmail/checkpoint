import { useEffect, useRef, useState } from 'react';
import { useChat } from './chat';
import { useAuth } from './auth';
import { LoginScreen } from './LoginScreen';
import { ModelPanel } from './ModelPanel';
import { ConversationList } from './ConversationList';
import { Composer } from './Composer';
import { VirtualizedMessages } from './VirtualizedMessages';
import { Panels as AppPanels } from './Panels';
import { Panels } from './Panels';

type Tab = 'chat' | 'knowledge' | 'memory' | 'agents' | 'plugins' | 'notes' | 'workflows' | 'calendar' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'chat', label: 'Chat' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'memory', label: 'Memory' },
  { id: 'agents', label: 'Agents' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'notes', label: 'Notes' },
  { id: 'workflows', label: 'Workflows' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'settings', label: 'Settings' },
];

const SEEDS = [
  'Explain what a vector embedding is, simply.',
  'Draft a polite follow-up email for a delayed ticket.',
  'What are the trade-offs of quantizing a model to Q4_K_M?',
  'Summarize the plot of a noir film set in a datacenter.',
];

const DRAFT_KEY = 'checkpoint.draft.v1';

export function App() {
  const { user, loading: authLoading } = useAuth();

  if (authLoading) {
    return <div className="login-screen"><div className="login-card">Loading…</div></div>;
  }
  if (!user) {
    return <LoginScreen />;
  }
  return <ChatApp />;
}

function ChatApp() {
  const { logout } = useAuth();
  const chat = useChat();
  const [tab, setTab] = useState<Tab>('chat');
  const [input, setInput] = useState<string>(() => localStorage.getItem(DRAFT_KEY) || '');
  const [renamingHeader, setRenamingHeader] = useState(false);
  const [headerTitle, setHeaderTitle] = useState('');
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // persist draft
  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, input);
  }, [input]);

  // autoscroll on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chat.active?.messages]);

  // autosize textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [input]);

  // focus textarea when opening a new/empty conversation
  useEffect(() => {
    if (tab === 'chat' && chat.modelStatus === 'ok') {
      const id = chat.activeId ?? 'new';
      // only focus if there are no messages yet (avoid stealing focus mid-conversation)
      if (!chat.active || chat.active.messages.length === 0) {
        taRef.current?.focus();
      }
      void id;
    }
  }, [tab, chat.activeId, chat.active?.messages.length, chat.modelStatus]);

  // track scroll position for scroll-to-bottom button
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      setShowScrollBtn(!atBottom && el.scrollHeight > el.clientHeight + 100);
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [tab, chat.activeId, chat.active?.messages.length]);

  // global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setTab('chat');
        chat.newConversation();
        setTimeout(() => taRef.current?.focus(), 50);
        return;
      }
      if (e.key === '/' && !typing) {
        e.preventDefault();
        setTab('chat');
        setTimeout(() => searchRef.current?.focus(), 50);
        return;
      }
      if (e.key === 'Escape') {
        if (renamingHeader) { setRenamingHeader(false); return; }
        (document.activeElement as HTMLElement)?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chat, renamingHeader]);

  const submit = () => {
    if (!input.trim() || chat.streaming) return;
    const text = input;
    setInput('');
    requestAnimationFrame(() => {
      if (taRef.current) taRef.current.style.height = 'auto';
    });
    chat.send(text);
  };

  const onSeed = (s: string) => {
    if (chat.streaming) return;
    chat.send(s);
  };

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  const startHeaderRename = () => {
    if (!chat.active) return;
    setHeaderTitle(chat.active.title);
    setRenamingHeader(true);
  };

  const commitHeaderRename = () => {
    if (chat.active && headerTitle.trim()) chat.renameConversation(chat.active.id, headerTitle);
    setRenamingHeader(false);
  };

  const activeAgent = chat.agents.find((a) => a.id === chat.activeAgentId);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-head">
          <div className="brand">
            Checkpoint<sup>v0.1</sup>
          </div>
        </div>

        <nav className="tab-strip">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'chat' && (
          <>
            <ModelPanel
              models={chat.models}
              selected={chat.model}
              onSelect={chat.setModel}
              status={chat.modelStatus}
            />

            <div className="sidebar-section" style={{ paddingBottom: 6 }}>
              <div className="sidebar-label">Conversations</div>
            </div>
            <ConversationList searchRef={searchRef} />

            <button className="new-btn" onClick={chat.newConversation} style={{ margin: '0 20px 16px' }}>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                <path d="M6.5 1v11M1 6.5h11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
              New conversation
              <span className="shortcut-hint">⌘K</span>
            </button>

            <div className="sidebar-foot">
              {chat.modelStatus === 'ok' && (
                <>
                  <span className="ok">●</span> ollama connected<br />
                  {chat.models.length} models available
                </>
              )}
              {chat.modelStatus === 'err' && (
                <>
                  <span className="ko">●</span> ollama unreachable<br />
                  is it running on :11434?
                </>
              )}
              {chat.modelStatus === 'loading' && (
                <>
                  <span>○</span> contacting ollama…
                </>
              )}
              <button className="link-btn logout-btn" onClick={() => void logout()} title="Sign out">
                sign out
              </button>
            </div>
          </>
        )}

      </aside>

      <main className="main">
        <header className="main-head">
          <div className="crumb">
            {tab === 'chat' ? (
              <>
                {renamingHeader && chat.active ? (
                  <input
                    className="header-rename"
                    autoFocus
                    value={headerTitle}
                    onChange={(e) => setHeaderTitle(e.target.value)}
                    onBlur={commitHeaderRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitHeaderRename();
                      if (e.key === 'Escape') setRenamingHeader(false);
                    }}
                  />
                ) : (
                  <b
                    className={chat.active ? 'header-title' : ''}
                    onClick={chat.active ? startHeaderRename : undefined}
                    title={chat.active ? 'Click to rename' : undefined}
                  >
                    {chat.active ? chat.active.title : 'New conversation'}
                  </b>
                )}
                {chat.active && !renamingHeader && <span> · {chat.active.model}</span>}
                {activeAgent && <span> · agent: {activeAgent.name}</span>}
                {chat.settings.ragMode && <span className="rag-badge">RAG</span>}
              </>
            ) : (
              <b>{TABS.find((t) => t.id === tab)?.label}</b>
            )}
          </div>
          {tab === 'chat' && chat.active && (
            <div className="main-head-actions">
              <button
                className="icon-btn"
                title="Rename conversation"
                onClick={startHeaderRename}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M9.5 2.5l2 2L4 12H2v-2l7.5-7.5z" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                className="icon-btn"
                title="Delete conversation"
                onClick={() => chat.deleteConversation(chat.active!.id)}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path
                    d="M2 4h10M5 4V2.5h4V4M3.5 4l.5 8h6l.5-8M6 6.5v4M8 6.5v4"
                    stroke="currentColor"
                    strokeWidth="1.1"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          )}
        </header>

        {tab === 'chat' ? (
          <>
            <div className="messages" ref={scrollRef}>
              {!chat.active || chat.active.messages.length === 0 ? (
                <div className="empty">
                  <h1>
                    Talk to your <em>local</em> models.
                  </h1>
                  <p>
                    Nothing leaves this machine. Pick a model on the left and ask something — replies stream
                    straight from Ollama.
                  </p>
                  <div className="seed-list">
                    {SEEDS.map((s, i) => (
                      <button key={i} className="seed" onClick={() => onSeed(s)} disabled={chat.streaming}>
                        <span className="num">{String(i + 1).padStart(2, '0')}</span>
                        <span>{s}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <VirtualizedMessages
                  messages={chat.active.messages}
                  onRegenerate={chat.regenerate}
                  onEdit={chat.editUserMessage}
                />
              )}
            </div>

            {showScrollBtn && (
              <button className="scroll-bottom-btn" onClick={scrollToBottom} title="Scroll to bottom">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 3v8M3 7l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}

            <Composer
              input={input}
              setInput={setInput}
              taRef={taRef}
              onSubmit={submit}
            />
          </>
        ) : (
          <AppPanels active={tab} />
        )}
      </main>
    </div>
  );
}
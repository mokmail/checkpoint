import { useEffect, useRef, useState } from 'react';
import { useChat } from './chat';
import { FilterPopover } from './Popover';

interface Props {
  input: string;
  setInput: (s: string) => void;
  taRef: React.RefObject<HTMLTextAreaElement>;
  onSubmit: () => void;
}

export function Composer({ input, setInput, taRef, onSubmit }: Props) {
  const chat = useChat();
  const [showBar, setShowBar] = useState(false);
  const railRef = useRef<HTMLDivElement>(null);

  const sendOnEnter = chat.settings.sendOnEnter;
  const activeAgent = chat.agents.find((a) => a.id === chat.activeAgentId);
  const charCount = input.length;
  const lineCount = input ? input.split('\n').length : 0;
  const canSend = !chat.streaming && input.trim().length > 0 && chat.modelStatus === 'ok';

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && sendOnEnter) {
      e.preventDefault();
      onSubmit();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onSubmit();
    }
  };

  const clear = () => {
    setInput('');
    requestAnimationFrame(() => {
      if (taRef.current) taRef.current.style.height = 'auto';
    });
    taRef.current?.focus();
  };

  return (
    <div className="composer">
      <div className="composer-rail" ref={railRef}>
        {(showBar || chat.settings.ragMode || activeAgent) && (
          <div className="composer-toolbar">
            <div className="toolbar-chips">
              <div className="chip-wrap">
                <FilterPopover
                  title="Select agent"
                  emptyLabel="No agents yet"
                  searchPlaceholder="search agents…"
                  allowClear
                  clearLabel="— no agent —"
                  items={chat.agents.map((a) => ({
                    value: a.id,
                    label: a.name,
                    hint: a.model || a.description || undefined,
                  }))}
                  selectedValue={chat.activeAgentId ?? null}
                  onSelect={(id) => { chat.setActiveAgent(id); taRef.current?.focus(); }}
                  trigger={(onOpen, ref) => (
                    <button
                      ref={ref}
                      className={`chip${activeAgent ? ' active' : ''}`}
                      onClick={onOpen}
                      title="Select agent"
                    >
                      {activeAgent ? activeAgent.name : 'no agent'}
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 2.5l3 3 3-3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" /></svg>
                    </button>
                  )}
                />
              </div>

              <div className="chip-wrap">
                <FilterPopover
                  title="Switch model"
                  emptyLabel="No models available"
                  searchPlaceholder="search models…"
                  items={chat.models.map((m) => ({
                    value: m.id,
                    label: m.id,
                    hint: m.contextWindow ? `${Math.round(m.contextWindow / 1024)}K ctx${m.size ? ' · ' + Math.round(m.size / (1024 * 1024 * 1024) * 10) / 10 + 'GB' : ''}` : undefined,
                  }))}
                  selectedValue={chat.model ?? null}
                  onSelect={(id) => { if (id) { chat.setModel(id); taRef.current?.focus(); } }}
                  trigger={(onOpen, ref) => (
                    <button
                      ref={ref}
                      className="chip"
                      onClick={onOpen}
                      title="Switch model"
                    >
                      {chat.model || 'no model'}
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 2.5l3 3 3-3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" /></svg>
                    </button>
                  )}
                />
              </div>

              <button
                className={`chip${chat.settings.ragMode ? ' active' : ''}`}
                onClick={() => chat.setSettings({ ragMode: !chat.settings.ragMode })}
                title="Toggle knowledge base context"
              >
                RAG {chat.settings.ragMode ? 'on' : 'off'}
              </button>
            </div>
            <button className="toolbar-collapse" onClick={() => setShowBar(false)} title="Hide toolbar">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /></svg>
            </button>
          </div>
        )}

        <div className="composer-box">
          <button
            className="composer-toggle"
            onClick={() => setShowBar((v) => !v)}
            title={showBar ? 'Hide options' : 'Show options'}
            tabIndex={-1}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="3" cy="7" r="1.1" fill="currentColor" />
              <circle cx="7" cy="7" r="1.1" fill="currentColor" />
              <circle cx="11" cy="7" r="1.1" fill="currentColor" />
            </svg>
          </button>
          <textarea
            ref={taRef}
            className="composer-input"
            placeholder={chat.streaming ? 'generating…' : chat.modelStatus === 'ok' ? 'Ask your model anything' : 'connecting to ollama…'}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            disabled={chat.modelStatus !== 'ok'}
          />
          {input.trim() && (
            <button className="composer-clear" onClick={clear} title="Clear input" tabIndex={-1}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
          )}
          <button
            className={`send-btn${chat.streaming ? ' stop' : ''}`}
            onClick={chat.streaming ? chat.stop : onSubmit}
            disabled={canSend ? false : !chat.streaming}
            title={chat.streaming ? 'Stop' : 'Send'}
          >
            {chat.streaming ? (
              <svg width="11" height="11" viewBox="0 0 11 11">
                <rect width="11" height="11" rx="1.5" fill="currentColor" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 11V3M3 7l4-4 4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
        <div className="composer-hint">
          <span className="composer-status">
            {chat.modelStatus === 'ok'
              ? `model · ${chat.model}`
              : chat.modelStatus === 'err'
                ? 'ollama offline'
                : 'connecting…'}
            {chat.settings.ragMode && ' · rag on'}
            {activeAgent && ` · ${activeAgent.name}`}
          </span>
          <span className="composer-meta">
            {charCount > 0 && <span className="char-count">{charCount} char{charCount === 1 ? '' : 's'} · {lineCount} line{lineCount === 1 ? '' : 's'}</span>}
            <button
              className="send-mode-btn"
              onClick={() => chat.setSettings({ sendOnEnter: !sendOnEnter })}
              title="Toggle send-on-Enter"
            >
              {sendOnEnter ? <><kbd>Enter</kbd> send</> : <><kbd>Cmd</kbd>+<kbd>Enter</kbd> send</>}
            </button>
            {!sendOnEnter && <><kbd>Enter</kbd> newline</>}
            {sendOnEnter && <><kbd>Shift</kbd>+<kbd>Enter</kbd> newline</>}
          </span>
        </div>
      </div>
    </div>
  );
}
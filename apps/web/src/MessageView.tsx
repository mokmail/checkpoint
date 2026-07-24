import { useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import 'highlight.js/styles/github-dark.css';
import type { StoredMessage } from './api';
import { formatTime } from './format';

interface Props {
  msg: StoredMessage;
  onRegenerate?: () => void;
  onEdit?: (messageId: string, newContent: string) => void;
}

function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const code = typeof children === 'string' ? children : Array.isArray(children) ? children.join('') : '';
  const lang = /language-(\w+)/.exec(className || '')?.[1];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="code-block">
      <div className="code-block-head">
        <span className="code-lang">{lang || 'code'}</span>
        <button className="code-copy" onClick={copy} title="Copy code">
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

const markdownComponents: Components = {
  a: (p) => <a {...p} target="_blank" rel="noreferrer" />,
  pre: ({ children }) => {
    // react-markdown wraps <code> in <pre>; we render our CodeBlock via the code renderer instead
    return <>{children}</>;
  },
  code: (p) => {
    // inline code (no className with language-) vs block code
    const isBlock = /language-/.test(p.className || '') || (typeof p.children === 'string' && p.children.includes('\n'));
    if (isBlock) return <CodeBlock className={p.className}>{p.children}</CodeBlock>;
    return <code className="inline-code">{p.children}</code>;
  },
};

export function MessageView({ msg, onRegenerate, onEdit }: Props) {
  const isAssistant = msg.role === 'assistant';
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(msg.content);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const startEdit = () => {
    setEditText(msg.content);
    setEditing(true);
  };

  const commitEdit = () => {
    if (editText.trim() && onEdit) onEdit(msg.id, editText);
    setEditing(false);
  };

  const cancelEdit = () => setEditing(false);

  const onEditKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commitEdit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  };

  return (
    <div className={`msg ${msg.role}${msg.streaming ? ' streaming' : ''}`}>
      <div className="msg-role">{msg.role}</div>
      <div className="msg-body">
        {msg.error ? (
          <p style={{ color: 'var(--accent)' }}>
            {msg.role === 'assistant' ? 'Couldn\u2019t generate a reply. ' : ''}
            {msg.error} Check that Ollama is running and the model is pulled.
          </p>
        ) : editing ? (
          <div className="msg-edit">
            <textarea
              className="msg-edit-input"
              autoFocus
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={onEditKey}
              rows={Math.min(12, Math.max(3, editText.split('\n').length))}
            />
            <div className="msg-edit-actions">
              <button className="panel-btn" onClick={commitEdit} disabled={!editText.trim()}>
                Save &amp; resend
              </button>
              <button className="panel-btn ghost" onClick={cancelEdit}>Cancel</button>
              <span className="msg-edit-hint"><kbd>Cmd</kbd>+<kbd>Enter</kbd> save · <kbd>Esc</kbd> cancel</span>
            </div>
          </div>
        ) : (
          <>
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex, rehypeHighlight]}
              components={markdownComponents}
            >
              {msg.content}
            </ReactMarkdown>
            {msg.streaming && <span className="cursor" />}
          </>
        )}
      </div>
      <div className="msg-foot">
        {!msg.streaming && msg.model && <span>{msg.model}</span>}
        {!msg.streaming && msg.tokens != null && <span className="token-count">{msg.tokens} tok</span>}
        {!msg.streaming && <span className="token-count">{formatTime(msg.createdAt)}</span>}
        {!msg.streaming && !msg.error && msg.content && !editing && (
          <div className="msg-actions">
            <button className="link-btn" onClick={copy} title="Copy">
              {copied ? 'copied' : 'copy'}
            </button>
            {isAssistant && onRegenerate && (
              <button className="link-btn" onClick={onRegenerate} title="Regenerate response">
                regenerate
              </button>
            )}
            {!isAssistant && onEdit && (
              <button className="link-btn" onClick={startEdit} title="Edit and resend">
                edit
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
import { useState } from 'react';
import { useChat } from './chat';

interface Props {
  searchRef?: React.RefObject<HTMLInputElement>;
}

export function ConversationList({ searchRef }: Props) {
  const chat = useChat();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);

  const startRename = (id: string, title: string) => {
    setRenamingId(id);
    setRenameText(title);
    setMenuId(null);
  };

  const commitRename = () => {
    if (renamingId) chat.renameConversation(renamingId, renameText);
    setRenamingId(null);
  };

  return (
    <>
      <div className="convo-search">
        <input
          ref={searchRef}
          className="convo-search-input"
          placeholder="Search conversations…  (press /)"
          value={chat.search}
          onChange={(e) => chat.setSearch(e.target.value)}
        />
      </div>
      <div className="convo-list">
        {chat.filteredConversations.length === 0 && (
          <div style={{ padding: '4px 8px', fontSize: '0.8rem', color: 'var(--ink-faint)' }}>
            {chat.search ? 'No matches.' : 'No conversations yet.'}
          </div>
        )}
        {chat.filteredConversations.map((c) => (
          <div key={c.id} className={`convo-row${c.id === chat.activeId ? ' active' : ''}`}>
            {renamingId === c.id ? (
              <input
                className="convo-rename"
                autoFocus
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setRenamingId(null);
                }}
              />
            ) : (
              <button className="convo-item" onClick={() => chat.openConversation(c.id)}>
                <span className={`dot${c.pinned ? ' pinned' : ''}${c.archived ? ' archived' : ''}`} />
                <span className="convo-title">{c.title}</span>
                {c.archived && <span className="convo-tag">arch</span>}
              </button>
            )}
            <button
              className="convo-menu-btn"
              onClick={(e) => {
                e.stopPropagation();
                setMenuId(menuId === c.id ? null : c.id);
              }}
              title="More"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <circle cx="2.5" cy="6" r="1.2" /><circle cx="6" cy="6" r="1.2" /><circle cx="9.5" cy="6" r="1.2" />
              </svg>
            </button>
            {menuId === c.id && (
              <div className="convo-menu" onMouseLeave={() => setMenuId(null)}>
                <button onClick={() => startRename(c.id, c.title)}>Rename</button>
                <button onClick={() => { chat.togglePin(c.id); setMenuId(null); }}>
                  {c.pinned ? 'Unpin' : 'Pin'}
                </button>
                <button onClick={() => { chat.toggleArchive(c.id); setMenuId(null); }}>
                  {c.archived ? 'Unarchive' : 'Archive'}
                </button>
                <button onClick={() => { chat.exportConversation(c.id, 'md'); setMenuId(null); }}>
                  Export .md
                </button>
                <button onClick={() => { chat.exportConversation(c.id, 'pdf'); setMenuId(null); }}>
                  Export .pdf
                </button>
                <button onClick={() => { chat.exportConversation(c.id, 'json'); setMenuId(null); }}>
                  Export .json
                </button>
                <button className="danger" onClick={() => { chat.deleteConversation(c.id); setMenuId(null); }}>
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
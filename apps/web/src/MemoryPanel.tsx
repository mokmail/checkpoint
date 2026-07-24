import { useState } from 'react';
import { useChat } from './chat';

export function MemoryPanel() {
  const chat = useChat();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editKey, setEditKey] = useState('');
  const [editValue, setEditValue] = useState('');

  const add = () => {
    if (!key.trim() || !value.trim()) return;
    chat.addMemory(key.trim(), value.trim());
    setKey('');
    setValue('');
  };

  const startEdit = (id: string, k: string, v: string) => {
    setEditingId(id);
    setEditKey(k);
    setEditValue(v);
  };

  const saveEdit = () => {
    if (!editingId) return;
    chat.updateMemory(editingId, editKey.trim(), editValue.trim());
    setEditingId(null);
  };

  return (
    <div className="panel memory-panel">
      <div className="panel-head">
        <div className="panel-title">Memory</div>
        <div className="panel-status">{chat.memories.length} facts</div>
      </div>

      <section className="panel-section">
        <div className="panel-label">Add a fact</div>
        <input
          className="panel-input"
          placeholder="Key (e.g. name, role, timezone)"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <input
          className="panel-input"
          placeholder="Value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="panel-btn" onClick={add} disabled={!key.trim() || !value.trim()}>
          Add memory
        </button>
        <p className="panel-help">
          Stored facts are injected into every chat as background context so the model remembers you.
        </p>
      </section>

      <section className="panel-section">
        <div className="panel-label">Stored facts</div>
        {chat.memories.length === 0 ? (
          <p className="panel-empty">No memories yet.</p>
        ) : (
          <ul className="memory-list">
            {chat.memories.map((m) => (
              <li key={m.id} className="memory-item">
                {editingId === m.id ? (
                  <div className="memory-edit">
                    <input className="panel-input" value={editKey} onChange={(e) => setEditKey(e.target.value)} />
                    <input className="panel-input" value={editValue} onChange={(e) => setEditValue(e.target.value)} />
                    <div className="panel-row">
                      <button className="panel-btn" onClick={saveEdit}>Save</button>
                      <button className="panel-btn ghost" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="memory-key">{m.key}</div>
                    <div className="memory-value">{m.value}</div>
                    <div className="memory-actions">
                      <button className="link-btn" onClick={() => startEdit(m.id, m.key, m.value)}>edit</button>
                      <button className="link-btn danger" onClick={() => chat.deleteMemory(m.id)}>delete</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
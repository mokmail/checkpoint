import { useState, useEffect } from 'react';
import {
  listNotes, createNote, updateNote, deleteNote, listFolders, createFolder, Note, Folder,
  listWorkflows, createWorkflow, updateWorkflow, deleteWorkflow, executeWorkflow, Workflow,
  listEvents, createEvent, updateEvent, deleteEvent, CalendarEvent,
} from './api';
import { KnowledgePanel } from './KnowledgePanel';
import { MemoryPanel } from './MemoryPanel';
import { AgentsPanel } from './AgentsPanel';
import { PluginsPanel } from './PluginsPanel';
import { SettingsPanel } from './SettingsPanel';

type SubTab = 'notes' | 'workflows' | 'calendar' | 'knowledge' | 'memory' | 'agents' | 'plugins' | 'settings';

interface Props {
  active: SubTab;
}

export function Panels({ active }: Props) {
  // Legacy panels (knowledge/memory/agents/plugins/settings) own their layout as a
  // immediate child of `.panel-host > .panel-scroll` (from the original App.tsx),
  // so wrap them to preserve the original scrolling behaviour.
  if (
    active === 'knowledge' ||
    active === 'memory' ||
    active === 'agents' ||
    active === 'plugins' ||
    active === 'settings'
  ) {
    return (
      <div className="panel-host">
        <div className="panel-scroll" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          {active === 'knowledge' && <KnowledgePanel />}
          {active === 'memory' && <MemoryPanel />}
          {active === 'agents' && <AgentsPanel />}
          {active === 'plugins' && <PluginsPanel />}
          {active === 'settings' && <SettingsPanel />}
        </div>
      </div>
    );
  }
  if (active === 'notes') return <NotesPanel />;
  if (active === 'workflows') return <WorkflowsPanel />;
  if (active === 'calendar') return <CalendarPanel />;
  return null;
}

function NotesPanel() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [folderId, setFolderId] = useState('');
  const [tags, setTags] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ id: string; version: number; content: string; createdAt: string }[]>([]);

  const fetchNotes = () => listNotes(search || undefined).then((n) => setNotes(n));
  const fetchFolders = () => listFolders().then((f) => setFolders(f));

  useEffect(() => { fetchNotes(); fetchFolders(); }, []);

  const handleSave = async () => {
    if (!title.trim().trim()) return;
    const payload = { title: title.trim(), content, folderId: folderId || undefined, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) };
    if (editing) {
      await updateNote(editing, payload);
      setEditing(null);
    } else {
      await createNote(payload);
    }
    setTitle(''); setContent(''); setFolderId(''); setTags('');
    fetchNotes();
  };

  const handleEdit = (n: Note) => {
    setEditing(n.id);
    setTitle(n.title); setContent(n.content); setFolderId(n.folderId ?? ''); setTags(n.tags.join(', '));
  };

  const showHistory = async (id: string) => {
    const res = await fetch(`/api/notes/${id}/history`, { headers: { Authorization: `Bearer ${localStorage.getItem('checkpoint.token.v1')}` } });
    const data = await res.json();
    setHistory(data.history ?? []);
    setHistoryId(id);
  };

  const rewrite = async (id: string) => {
    const instruction = prompt('Rewrite instruction (e.g. "make it more concise"):');
    if (!instruction) return;
    const res = await fetch(`/api/notes/${id}/rewrite`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('checkpoint.token.v1')}` }, body: JSON.stringify({ instruction }) });
    const data = await res.json();
    await updateNote(id, { content: data.rewritten });
    fetchNotes();
  };

  return (
    <div className="panel-scroll">
      <div className="panel-header">
        <b>Notes</b>
      </div>
      <div className="panel-search">
        <input placeholder="Search notes…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') fetchNotes(); }} />
        <button onClick={fetchNotes}>Search</button>
      </div>
      <div className="notes-split">
        <div className="notes-list">
          {notes.map((n) => (
            <div key={n.id} className="note-row" onClick={() => handleEdit(n)}>
              <div className="note-title">{n.title}</div>
              <div className="note-meta">v{n.version} · {n.tags.slice(0, 2).join(' ')}{n.folderId ? ' · 📁' : ''}</div>
            </div>
          ))}
          {notes.length === 0 && <div className="empty-sm">No notes yet.</div>}
        </div>
        <div className="notes-editor" style={{ padding: 16 }}>
          <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: '100%', marginBottom: 6, padding: '5px 8px', borderRadius: 4, border: '1px solid #444', background: '#1a1a1a', color: '#d0d0d0' }} />
          <textarea placeholder="Write something…" value={content} onChange={(e) => setContent(e.target.value)} rows={10} style={{ width: '100%', marginBottom: 6, padding: '6px 8px', borderRadius: 4, border: '1px solid #444', background: '#1a1a1a', color: '#d0d0d0', fontFamily: 'inherit' }} />
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <input placeholder="Tags (comma-separated)" value={tags} onChange={(e) => setTags(e.target.value)} style={{ flex: 1, padding: '4px 8px', borderRadius: 4, border: '1px solid #444', background: '#1a1a1a', color: '#d0d0d0' }} />
            <select value={folderId} onChange={(e) => setFolderId(e.target.value)} style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #444', background: '#1a1a1a', color: '#d0d0d0' }}>
              <option value="">No folder</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={handleSave}>{editing ? 'Save' : 'Create'}</button>
            {editing && <button onClick={() => { setEditing(null); setTitle(''); setContent(''); }}>Cancel</button>}
            {editing && <button onClick={() => { if (editing) rewrite(editing); }}>✏️ AI Rewrite</button>}
            {editing && <button onClick={() => { if (editing) showHistory(editing); }}>📜 History</button>}
          </div>
          {historyId && history.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <b>Version History</b>
              {history.map((h) => (
                <div key={h.id} style={{ padding: '4px 0', borderBottom: '1px solid #333', fontSize: 13 }}>
                  v{h.version} · {new Date(h.createdAt).toLocaleString()}
                  <button onClick={async () => { await updateNote(editing!, { content: h.content }); setEditing(null); fetchNotes(); }} style={{ marginLeft: 8 }}>Restore</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkflowsPanel() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState('');
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<{ executed: boolean; results: Record<string, unknown>[] } | null>(null);

  const fetchAll = () => listWorkflows().then(setWorkflows);
  useEffect(() => { fetchAll(); }, []);

  const handleCreate = async () => {
    try {
      const parsed = steps ? JSON.parse(steps) : [];
      await createWorkflow({ name, description, steps: parsed, enabled: true });
      setName(''); setDescription(''); setSteps('');
      fetchAll();
    } catch (e) {
      alert('Invalid steps JSON or creation failed');
    }
  };

  const handleExecute = async (id: string) => {
    setRunning(id);
    setResult(null);
    try {
      const r = await executeWorkflow(id);
      setResult(r);
    } finally {
      setRunning(null);
    }
  };

  return (
    <div className="panel-scroll">
      <div className="panel-header"><b>Workflows</b></div>
      <div style={{ padding: 16 }}>
        <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', marginBottom: 4, padding: '5px 8px', background: '#1a1a1a', border: '1px solid #444', borderRadius: 4, color: '#d0d0d0' }} />
        <input placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: '100%', marginBottom: 4, padding: '5px 8px', background: '#1a1a1a', border: '1px solid #444', borderRadius: 4, color: '#d0d0d0' }} />
        <textarea placeholder='Steps as JSON array, e.g. [{"type":"prompt","config":{"prompt":"Summarize"},"model":"llama3.2:latest"}]' value={steps} onChange={(e) => setSteps(e.target.value)} rows={4} style={{ width: '100%', marginBottom: 6, padding: '5px 8px', background: '#1a1a1a', border: '1px solid #444', borderRadius: 4, color: '#d0d0d0', fontFamily: 'monospace', fontSize: 12 }} />
        <button onClick={handleCreate}>Create Workflow</button>
      </div>
      <div style={{ padding: '0 16px', overflow: 'auto', flex: 1 }}>
        {workflows.map((w) => (
          <div key={w.id} style={{ padding: '8px 0', borderBottom: '1px solid #333' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b>{w.name}</b>
              <span style={{ fontSize: 12, color: w.enabled ? '#4f8' : '#f44' }}>{w.enabled ? '● active' : '○ inactive'}</span>
            </div>
            {w.description && <div style={{ fontSize: 13, color: '#999' }}>{w.description}</div>}
            <div style={{ fontSize: 12, marginTop: 2 }}>
              Steps: {w.steps.length} · {JSON.stringify(w.trigger).slice(0, 60)}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              {w.enabled
                ? <button onClick={() => handleExecute(w.id)} disabled={running === w.id}>{running === w.id ? 'Running…' : '▶ Execute'}</button>
                : <button onClick={async () => { await updateWorkflow(w.id, { enabled: true }); fetchAll(); }}>Enable</button>
              }
              <button onClick={async () => { await updateWorkflow(w.id, { enabled: false }); fetchAll(); }}>Disable</button>
              <button onClick={async () => { await deleteWorkflow(w.id); fetchAll(); }}>Delete</button>
            </div>
          </div>
        ))}
        {result && (
          <div style={{ padding: 8, background: '#111', borderRadius: 4, marginTop: 8 }}>
            <b>Execution result</b>
            {result.results.map((r, i) => (
              <div key={i} style={{ padding: '2px 0', fontSize: 12 }}>
                 Step {i} ({String(r.type)}): {r.content != null ? String(r.content) : r.error != null ? String(r.error) : r.note != null ? String(r.note) : '—'}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CalendarPanel() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); });

  const fetchAll = () => listEvents(from, to).then(setEvents);
  useEffect(() => { fetchAll(); }, []);

  const handleCreate = async () => {
    if (!title.trim() || !start || !end) return;
    await createEvent({ title: title.trim(), start, end, allDay: false });
    setTitle(''); setStart(''); setEnd('');
    fetchAll();
  };

  return (
    <div className="panel-scroll">
      <div className="panel-header"><b>Calendar</b></div>
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <label>From: <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /> To: <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button onClick={fetchAll}>Load</button>
        </div>
        <input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: '100%', marginBottom: 4, padding: '5px 8px', background: '#1a1a1a', border: '1px solid #444', borderRadius: 4, color: '#d0d0d0' }} />
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <label>Start: <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label>End: <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <button onClick={handleCreate}>Add Event</button>
      </div>
      <div style={{ padding: '0 16px', overflow: 'auto', flex: 1 }}>
        {events.map((ev) => (
          <div key={ev.id} style={{ padding: '8px 0', borderBottom: '1px solid #333' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <b>{ev.title}</b>
              <button onClick={async () => { await deleteEvent(ev.id); fetchAll(); }}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: '#999' }}>
              {new Date(ev.start).toLocaleString()} → {new Date(ev.end).toLocaleString()}
              {ev.attendees.length > 0 && <span> · 👥 {ev.attendees.join(', ')}</span>}
              {ev.description && <div>{ev.description}</div>}
            </div>
          </div>
        ))}
        {events.length === 0 && <div className="empty-sm">No events in range.</div>}
      </div>
    </div>
  );
}
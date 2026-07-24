import { useEffect, useState } from 'react';
import { useChat } from './chat';
import { listAgentPresets, installAgentPreset, exportAgent, type Agent, type AgentPreset } from './api';

export function AgentsPanel() {
  const chat = useChat();
  const [editing, setEditing] = useState<Agent | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [presets, setPresets] = useState<AgentPreset[]>([]);
  const [showPresets, setShowPresets] = useState(false);
  const [presetNotice, setPresetNotice] = useState<string | null>(null);

  useEffect(() => {
    if (showPresets) listAgentPresets().then(setPresets).catch(() => {});
  }, [showPresets]);

  const installPreset = async (presetId: string) => {
    try {
      await installAgentPreset(presetId);
      setPresetNotice('Preset installed. Check your saved agents.');
      setTimeout(() => setPresetNotice(null), 3000);
    } catch (e) {
      setPresetNotice(e instanceof Error ? e.message : 'Install failed');
    }
  };

  const handleExport = async (agentId: string) => {
    try { await exportAgent(agentId); } catch (e) {
      setPresetNotice(e instanceof Error ? e.message : 'Export failed');
      setTimeout(() => setPresetNotice(null), 3000);
    }
  };

  const blank: Agent = {
    id: '',
    name: '',
    description: '',
    systemPrompt: '',
    model: '',
    createdAt: 0,
  };

  const save = (a: Agent) => {
    if (!a.name.trim()) return;
    if (a.id) {
      chat.updateAgent(a.id, {
        name: a.name,
        description: a.description,
        systemPrompt: a.systemPrompt,
        model: a.model,
      });
    } else {
      chat.addAgent({
        name: a.name,
        description: a.description,
        systemPrompt: a.systemPrompt,
        model: a.model,
      });
    }
    setEditing(null);
    setShowForm(false);
  };

  const form = editing ?? (showForm ? blank : null);

  return (
    <div className="panel agents-panel">
      <div className="panel-head">
        <div className="panel-title">Agents</div>
        <div className="panel-status">{chat.agents.length} saved</div>
      </div>

      {chat.activeAgentId && (
        <div className="panel-section">
          <div className="panel-callout">
            Active agent: <b>{chat.agents.find((a) => a.id === chat.activeAgentId)?.name}</b>
            <button className="link-btn" onClick={() => chat.setActiveAgent(null)}>deactivate</button>
          </div>
        </div>
      )}

      <section className="panel-section">
        <div className="panel-row">
          <button className="panel-btn" onClick={() => { setEditing(null); setShowForm(true); }}>
            + New agent
          </button>
        </div>

        {form && (
          <AgentForm
            initial={form}
            models={chat.models}
            onCancel={() => { setEditing(null); setShowForm(false); }}
            onSave={save}
          />
        )}
      </section>

      <section className="panel-section">
        <div className="panel-label">Saved agents</div>
        {chat.agents.length === 0 ? (
          <p className="panel-empty">No agents yet. Create one to give the model a persona and instructions.</p>
        ) : (
          <ul className="agent-list">
            {chat.agents.map((a) => (
              <li key={a.id} className={`agent-item${chat.activeAgentId === a.id ? ' active' : ''}`}>
                <div className="agent-name">{a.name}</div>
                {a.description && <div className="agent-desc">{a.description}</div>}
                {a.model && <div className="agent-model">{a.model}</div>}
                <div className="agent-actions">
                  <button className="link-btn" onClick={() => chat.setActiveAgent(chat.activeAgentId === a.id ? null : a.id)}>
                    {chat.activeAgentId === a.id ? 'deactivate' : 'activate'}
                  </button>
                  <button className="link-btn" onClick={() => { setEditing(a); setShowForm(false); }}>edit</button>
                  <button className="link-btn" onClick={() => handleExport(a.id)}>export</button>
                  <button className="link-btn danger" onClick={() => chat.deleteAgent(a.id)}>delete</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel-section">
        <div className="panel-row">
          <button className="panel-btn ghost" onClick={() => setShowPresets(!showPresets)}>
            {showPresets ? 'Hide' : 'Browse'} community presets
          </button>
        </div>
        {presetNotice && <p className="login-error">{presetNotice}</p>}
        {showPresets && (
          <ul className="preset-list">
            {presets.map((p) => (
              <li key={p.id} className="preset-item">
                <div className="preset-name">{p.name}</div>
                <div className="preset-desc">{p.description}</div>
                <div className="preset-meta">
                  <span className="preset-cat">{p.category}</span>
                  {p.tools.length > 0 && <span>tools: {p.tools.join(', ')}</span>}
                  {p.variables.length > 0 && <span>vars: {p.variables.map((v) => v.name).join(', ')}</span>}
                </div>
                <button className="panel-btn" onClick={() => installPreset(p.id)}>Install</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AgentForm({
  initial,
  models,
  onSave,
  onCancel,
}: {
  initial: Agent;
  models: { id: string }[];
  onSave: (a: Agent) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [systemPrompt, setSystemPrompt] = useState(initial.systemPrompt);
  const [model, setModel] = useState(initial.model ?? '');

  return (
    <div className="agent-form">
      <input className="panel-input" placeholder="Agent name" value={name} onChange={(e) => setName(e.target.value)} />
      <input
        className="panel-input"
        placeholder="Short description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <textarea
        className="panel-textarea"
        placeholder="System prompt — instructions and persona for this agent"
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        rows={6}
      />
      <select className="panel-input" value={model} onChange={(e) => setModel(e.target.value)}>
        <option value="">Use current model</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>{m.id}</option>
        ))}
      </select>
      <div className="panel-row">
        <button className="panel-btn" onClick={() => onSave({ ...initial, name, description, systemPrompt, model })} disabled={!name.trim()}>
          Save agent
        </button>
        <button className="panel-btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
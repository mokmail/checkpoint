import { useChat } from './chat';

export function SettingsPanel() {
  const chat = useChat();
  const s = chat.settings;

  return (
    <div className="panel settings-panel">
      <div className="panel-head">
        <div className="panel-title">Model Settings</div>
      </div>

      <section className="panel-section">
        <div className="panel-label">System prompt</div>
        <textarea
          className="panel-textarea"
          placeholder="Optional system prompt applied to all new messages"
          value={s.systemPrompt}
          onChange={(e) => chat.setSettings({ systemPrompt: e.target.value })}
          rows={4}
        />
        {chat.activeAgentId && (
          <p className="panel-help">
            An agent is active — its system prompt overrides this. Deactivate the agent to use it.
          </p>
        )}
      </section>

      <section className="panel-section">
        <div className="panel-label">Temperature · {s.temperature.toFixed(2)}</div>
        <input
          type="range"
          min="0"
          max="2"
          step="0.05"
          value={s.temperature}
          onChange={(e) => chat.setSettings({ temperature: parseFloat(e.target.value) })}
          className="panel-range"
        />
        <div className="range-hint"><span>precise</span><span>creative</span></div>
      </section>

      <section className="panel-section">
        <div className="panel-label">Max tokens · {s.maxTokens}</div>
        <input
          type="range"
          min="64"
          max="8192"
          step="64"
          value={s.maxTokens}
          onChange={(e) => chat.setSettings({ maxTokens: parseInt(e.target.value) })}
          className="panel-range"
        />
        <div className="range-hint"><span>64</span><span>8192</span></div>
      </section>

      <section className="panel-section">
        <div className="panel-label">Knowledge base</div>
        <label className="panel-toggle">
          <input
            type="checkbox"
            checked={!!s.ragMode}
            onChange={(e) => chat.setSettings({ ragMode: e.target.checked })}
          />
          <span>Inject retrieved context into chat</span>
        </label>
        <p className="panel-help">
          When on, each message first retrieves relevant chunks from the Knowledge Base and includes them as context.
        </p>
      </section>
    </div>
  );
}
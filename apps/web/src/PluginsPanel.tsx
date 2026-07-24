import { useEffect, useState } from 'react';
import { listPlugins, enablePlugin, disablePlugin, type Plugin } from './api';

export function PluginsPanel() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    listPlugins()
      .then(setPlugins)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load plugins'))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  const toggle = async (p: Plugin) => {
    try {
      if (p.enabled) await disablePlugin(p.name);
      else await enablePlugin(p.name);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Toggle failed');
    }
  };

  return (
    <div className="panel plugins-panel">
      <div className="panel-head">
        <div className="panel-title">Plugins</div>
        <div className="panel-status">{plugins.length} installed</div>
      </div>

      {loading && <p className="panel-empty">Loading…</p>}
      {error && <p className="login-error">{error}</p>}
      {!loading && plugins.length === 0 && <p className="panel-empty">No plugins installed.</p>}

      <ul className="plugin-list">
        {plugins.map((p) => (
          <li key={p.id} className={`plugin-item${p.active ? ' active' : ''}`}>
            <div className="plugin-head">
              <span className="plugin-name">{p.name}</span>
              <span className="plugin-version">v{p.version}</span>
              <span className="plugin-type">{p.type}</span>
              <button
                className={`link-btn${p.enabled ? '' : ' danger'}`}
                onClick={() => toggle(p)}
                title={p.enabled ? 'Disable' : 'Enable'}
              >
                {p.enabled ? 'enabled' : 'disabled'}
              </button>
            </div>
            {p.description && <div className="plugin-desc">{p.description}</div>}
            <div className="plugin-meta">
              <span>source: {p.source}</span>
              {p.hooks.length > 0 && <span>hooks: {p.hooks.join(', ')}</span>}
              {p.author && <span>by {p.author}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
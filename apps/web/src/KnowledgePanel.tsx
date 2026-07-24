import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ragHealth,
  listKnowledgeBases,
  createKnowledgeBase,
  deleteKnowledgeBase,
  listKbDocuments,
  uploadKbDocumentText,
  uploadKbDocumentFile,
  deleteKbDocument,
  searchKnowledgeBase,
  type KnowledgeBase,
  type KbDocument,
  type RagResult,
} from './api';
import { useChat } from './chat';

export function KnowledgePanel() {
  const chat = useChat();
  const [health, setHealth] = useState<'loading' | 'ok' | 'err'>('loading');
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [activeKb, setActiveKb] = useState<KnowledgeBase | null>(null);
  const [docs, setDocs] = useState<KbDocument[]>([]);
  const [newKbName, setNewKbName] = useState('');
  const [ingestText, setIngestText] = useState('');
  const [ingestTitle, setIngestTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [results, setResults] = useState<RagResult[]>([]);
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshKbs = useCallback(() => {
    listKnowledgeBases()
      .then((list) => {
        setKbs(list);
        if (!activeKb && list.length) setActiveKb(list[0]);
        if (activeKb && !list.find((k) => k.id === activeKb.id)) setActiveKb(list[0] ?? null);
      })
      .catch(() => setKbs([]));
  }, [activeKb]);

  useEffect(() => { ragHealth().then((ok) => setHealth(ok ? 'ok' : 'err')); }, []);
  useEffect(() => { if (health === 'ok') refreshKbs(); }, [health, refreshKbs]);

  useEffect(() => {
    if (!activeKb) { setDocs([]); return; }
    listKbDocuments(activeKb.id).then(setDocs).catch(() => setDocs([]));
  }, [activeKb]);

  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(null), 3000); };

  const handleCreateKb = useCallback(async () => {
    if (!newKbName.trim()) return;
    setBusy(true);
    try {
      const kb = await createKnowledgeBase(newKbName.trim());
      setNewKbName('');
      flash(`Created knowledge base "${kb.name}".`);
      refreshKbs();
      setActiveKb(kb);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Create failed');
    } finally { setBusy(false); }
  }, [newKbName, refreshKbs]);

  const handleIngestText = useCallback(async () => {
    if (!activeKb || !ingestText.trim()) return;
    setBusy(true);
    try {
      const res = await uploadKbDocumentText(activeKb.id, ingestTitle.trim() || 'Untitled', ingestText.trim());
      flash(`Ingested ${res.chunkCount} chunk${res.chunkCount === 1 ? '' : 's'}.`);
      setIngestText(''); setIngestTitle('');
      setDocs(await listKbDocuments(activeKb.id));
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Ingest failed');
    } finally { setBusy(false); }
  }, [activeKb, ingestText, ingestTitle]);

  const handleFile = useCallback(async (files: FileList | null) => {
    if (!activeKb || !files?.length) return;
    setBusy(true);
    try {
      let count = 0;
      for (const file of Array.from(files)) {
        const res = await uploadKbDocumentFile(activeKb.id, file);
        count += res.count;
      }
      flash(`Ingested ${count} chunk${count === 1 ? '' : 's'} from ${files.length} file${files.length === 1 ? '' : 's'}.`);
      setDocs(await listKbDocuments(activeKb.id));
    } catch (e) {
      flash(e instanceof Error ? e.message : 'File ingest failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }, [activeKb]);

  const handleSearch = useCallback(async () => {
    if (!activeKb || !query.trim()) return;
    setBusy(true);
    try {
      setResults(await searchKnowledgeBase(activeKb.id, query.trim(), 6));
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Search failed');
    } finally { setBusy(false); }
  }, [activeKb, query]);

  const handleDeleteDoc = useCallback(async (docId: string) => {
    if (!activeKb) return;
    try {
      await deleteKbDocument(activeKb.id, docId);
      setDocs((prev) => prev.filter((d) => d.id !== docId));
    } catch (e) { flash(e instanceof Error ? e.message : 'Delete failed'); }
  }, [activeKb]);

  const handleDeleteKb = useCallback(async () => {
    if (!activeKb) return;
    if (!confirm(`Delete knowledge base "${activeKb.name}" and all its documents?`)) return;
    try {
      await deleteKnowledgeBase(activeKb.id);
      flash('Knowledge base deleted.');
      setActiveKb(null);
      refreshKbs();
    } catch (e) { flash(e instanceof Error ? e.message : 'Delete failed'); }
  }, [activeKb, refreshKbs]);

  return (
    <div className="panel knowledge-panel">
      <div className="panel-head">
        <div className="panel-title">Knowledge Base</div>
        <div className={`panel-status ${health}`}>
          {health === 'ok' ? '● rag online' : health === 'err' ? '● rag offline' : '○ connecting…'}
        </div>
      </div>

      <section className="panel-section">
        <div className="panel-label">Knowledge bases</div>
        <div className="panel-row">
          <input
            className="panel-input"
            placeholder="New KB name…"
            value={newKbName}
            onChange={(e) => setNewKbName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateKb()}
          />
          <button className="panel-btn" onClick={handleCreateKb} disabled={busy || !newKbName.trim()}>Create</button>
        </div>
        {kbs.length === 0 ? (
          <p className="panel-empty">No knowledge bases yet. Create one to start ingesting documents.</p>
        ) : (
          <ul className="kb-list">
            {kbs.map((kb) => (
              <li key={kb.id} className={`kb-item${activeKb?.id === kb.id ? ' active' : ''}`}>
                <button className="kb-select" onClick={() => setActiveKb(kb)}>
                  <span className="kb-name">{kb.name}</span>
                  {kb.description && <span className="kb-desc">{kb.description}</span>}
                  <span className="kb-count">{kb._count?.documents ?? 0} docs</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {activeKb && (
          <button className="link-btn danger" onClick={handleDeleteKb} style={{ marginTop: 6 }}>
            Delete "{activeKb.name}"
          </button>
        )}
      </section>

      {activeKb && (
        <>
          <section className="panel-section">
            <div className="panel-label">Add documents to "{activeKb.name}"</div>
            <input
              className="panel-input"
              placeholder="Document title (optional)"
              value={ingestTitle}
              onChange={(e) => setIngestTitle(e.target.value)}
            />
            <textarea
              className="panel-textarea"
              placeholder="Paste text — PDF/DOCX/TXT/MD supported via file upload."
              value={ingestText}
              onChange={(e) => setIngestText(e.target.value)}
              rows={5}
            />
            <div className="panel-row">
              <button className="panel-btn" onClick={handleIngestText} disabled={busy || !ingestText.trim()}>Ingest text</button>
              <button className="panel-btn ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
                Upload file (PDF/DOCX/TXT/MD)
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.docx,.txt,.md,.markdown,.json"
                multiple
                hidden
                onChange={(e) => handleFile(e.target.files)}
              />
            </div>
          </section>

          <section className="panel-section">
            <div className="panel-label">Documents ({docs.length})</div>
            {docs.length === 0 ? (
              <p className="panel-empty">No documents in this knowledge base.</p>
            ) : (
              <ul className="doc-list">
                {docs.map((d) => (
                  <li key={d.id} className="doc-item">
                    <div className="doc-head">
                      <span className="doc-title">{d.title}</span>
                      <span className="doc-meta">{d.chunkCount} chunks</span>
                      <button className="link-btn danger" onClick={() => handleDeleteDoc(d.id)}>delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel-section">
            <div className="panel-label">Search &amp; retrieve</div>
            <div className="panel-row">
              <input
                className="panel-input"
                placeholder="Ask about your documents…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
              <button className="panel-btn" onClick={handleSearch} disabled={busy || !query.trim()}>Retrieve</button>
            </div>
            <label className="panel-toggle">
              <input
                type="checkbox"
                checked={!!chat.settings.ragMode}
                onChange={(e) => chat.setSettings({ ragMode: e.target.checked })}
              />
              <span>Inject context into chat</span>
            </label>

            {results.length > 0 && (
              <div className="rag-results">
                <div className="panel-label">Retrieved chunks</div>
                {results.map((r) => (
                  <div key={r.id} className="rag-result">
                    <div className="rag-result-head">
                      <span className="rag-id">{r.id.slice(0, 12)}</span>
                      <span className="rag-score">{(r.score * 100).toFixed(0)}%</span>
                    </div>
                    <p>{r.content.slice(0, 240)}{r.content.length > 240 ? '…' : ''}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {notice && <div className="panel-notice">{notice}</div>}
    </div>
  );
}
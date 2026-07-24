import { useEffect, useRef, useState } from 'react';
import { formatBytes, formatCtx } from './format';
import type { ModelInfo } from './api';

interface Props {
  models: ModelInfo[];
  selected: string;
  onSelect: (id: string) => void;
  status: 'ok' | 'err' | 'loading';
}

export function ModelPanel({ models, selected, onSelect, status }: Props) {
  const current = models.find((m) => m.id === selected);
  const disabled = status === 'loading' || models.length === 0;

  const label =
    status === 'loading' ? 'loading…' :
    status === 'err' ? 'unavailable' :
    models.length === 0 ? 'no models' :
    current ? current.id : 'select model';

  return (
    <div className="sidebar-section">
      <div className="sidebar-label">Model</div>
      <Combobox
        value={selected}
        label={label}
        options={models.map((m) => ({ value: m.id, label: m.id, hint: `${formatCtx(m.contextWindow)}${m.size ? ' · ' + formatBytes(m.size) : ''}` }))}
        onChange={onSelect}
        disabled={disabled}
        placeholder="search models…"
      />
      {current && (
        <dl className="model-meta">
          <dt>ctx</dt>
          <dd>{formatCtx(current.contextWindow)}</dd>
          {current.size ? <dt>size</dt> : null}
          {current.size ? <dd>{formatBytes(current.size)}</dd> : null}
          <dt>caps</dt>
          <dd>{current.capabilities.join(' · ')}</dd>
        </dl>
      )}
    </div>
  );
}

export interface ComboboxProps {
  value: string;
  label: string;
  options: { value: string; label: string; hint?: string }[];
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  emptyLabel?: string;
}

export function Combobox({ value, label, options, onChange, disabled, placeholder, emptyLabel }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setActive(-1);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQuery('');
    }
  }, [open]);

  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()) || (o.hint?.toLowerCase().includes(query.toLowerCase())))
    : options;

  const commit = (idx: number) => {
    const opt = filtered[idx];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(active === -1 ? 0 : active);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`combobox${open ? ' open' : ''}${disabled ? ' disabled' : ''}`}>
      <button
        type="button"
        className="combobox-trigger"
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabled}
        disabled={disabled}
        title={label}
      >
        <span className="combobox-label">{label}</span>
        <span className="combobox-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="combobox-pop" role="listbox">
          <div className="combobox-search" onKeyDown={onListKey}>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActive(-1); }}
              placeholder={placeholder ?? 'filter…'}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <ul className="combobox-list" role="presentation">
            {filtered.length === 0 && (
              <li className="combobox-empty">{emptyLabel ?? 'no matches'}</li>
            )}
            {filtered.map((opt, i) => (
              <li
                key={opt.value}
                role="option"
                aria-selected={opt.value === value}
                className={`combobox-option${i === active ? ' active' : ''}${opt.value === value ? ' selected' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); commit(i); }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="combobox-option-label">{opt.label}</span>
                {opt.hint && <span className="combobox-option-hint">{opt.hint}</span>}
                {opt.value === value && <span className="combobox-option-check">✓</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
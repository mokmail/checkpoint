import { useEffect, useRef, useState } from 'react';

interface PopoverItem {
  value: string;
  label: string;
  hint?: string;
}

interface Props {
  trigger: (onOpen: () => void, ref: React.RefObject<HTMLButtonElement>) => React.ReactNode;
  items: PopoverItem[];
  selectedValue?: string | null;
  emptyLabel?: string;
  title?: string;
  searchPlaceholder?: string;
  initialQuery?: string;
  onSelect: (value: string | null) => void;
  allowClear?: boolean;
  clearLabel?: string;
  side?: 'up' | 'down';
}

export function FilterPopover({ trigger, items, selectedValue, emptyLabel, title, searchPlaceholder, initialQuery, onSelect, allowClear, clearLabel, side = 'up' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(initialQuery ?? '');
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  useEffect(() => {
    if (open) {
      setActive(0);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  const lc = query.toLowerCase();
  const filtered = query
    ? items.filter((i) => i.label.toLowerCase().includes(lc) || (i.hint?.toLowerCase().includes(lc)))
    : items;

  const commit = (i: number) => {
    const it = filtered[i];
    if (it) onSelect(it.value);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={`filter-pop${open ? ' open' : ''} side-${side}`}>
      {trigger(() => setOpen((v) => !v), triggerRef)}
      {open && (
        <div className="filter-pop-panel" role="listbox" onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); commit(active); }
          else if (e.key === 'Tab') setOpen(false);
        }}>
          {title && <div className="filter-pop-title">{title}</div>}
          <input
            ref={searchRef}
            className="filter-pop-search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            placeholder={searchPlaceholder ?? 'filter…'}
            autoComplete="off"
            spellCheck={false}
          />
          <ul className="filter-pop-list">
            {filtered.length === 0 && <li className="filter-pop-empty">{emptyLabel ?? 'no matches'}</li>}
            {allowClear && (
              <li
                className={`filter-pop-item clear${!selectedValue ? ' selected' : ''}${active === -1 ? ' active' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); onSelect(null); setOpen(false); }}
                onMouseEnter={() => setActive(-1)}
              >
                {clearLabel ?? 'None'}
              </li>
            )}
            {active === -1 && allowClear && null}
            {active >= 0 && filtered.map((it, i) => (
              <li
                key={it.value}
                className={`filter-pop-item${i === active ? ' active' : ''}${it.value === selectedValue ? ' selected' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); commit(i); }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="filter-pop-main">{it.label}</span>
                {it.hint && <span className="filter-pop-meta">{it.hint}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
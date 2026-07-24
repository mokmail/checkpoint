export function formatBytes(bytes?: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function formatCtx(ctx?: number): string {
  if (!ctx) return '—';
  if (ctx >= 1024) return `${Math.round(ctx / 1024)}K`;
  return `${ctx}`;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function titleFromContent(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= 42) return clean || 'New chat';
  return clean.slice(0, 42).trimEnd() + '…';
}
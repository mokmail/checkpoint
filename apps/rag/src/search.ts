// Web search providers. Default: DuckDuckGo HTML (no API key required).
// Optional: SearXNG (self-hosted) via WEB_SEARCH_SEARXNG_URL.

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchProvider {
  id: string;
  search(query: string, topK?: number): Promise<WebSearchResult[]>;
}

const UA = 'AIChatRAG/1.0 (+https://github.com/ai-chat)';

/** DuckDuckGo HTML endpoint — no key required. */
class DuckDuckGoProvider implements WebSearchProvider {
  id = 'duckduckgo';

  async search(query: string, topK = 5): Promise<WebSearchResult[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (!res.ok) throw new Error(`DuckDuckGo search failed: ${res.status}`);
    const html = await res.text();
    return parseDuckDuckGoHtml(html).slice(0, topK);
  }
}

/** SearXNG (self-hosted, no key). Expects a JSON API endpoint. */
class SearXNGProvider implements WebSearchProvider {
  id = 'searxng';
  constructor(private baseUrl: string) {}

  async search(query: string, topK = 5): Promise<WebSearchResult[]> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`SearXNG search failed: ${res.status}`);
    const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
    return (data.results ?? [])
      .map((r) => ({ title: r.title ?? '', url: r.url ?? '', snippet: r.content ?? '' }))
      .slice(0, topK);
  }
}

/** Tavily API (key required). */
class TavilyProvider implements WebSearchProvider {
  id = 'tavily';
  constructor(private apiKey: string) {}

  async search(query: string, topK = 5): Promise<WebSearchResult[]> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        query,
        max_results: topK,
        include_answer: false,
      }),
    });
    if (!res.ok) throw new Error(`Tavily search failed: ${res.status}`);
    const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
    return (data.results ?? [])
      .map((r) => ({ title: r.title ?? '', url: r.url ?? '', snippet: r.content ?? '' }))
      .slice(0, topK);
  }
}

function parseDuckDuckGoHtml(html: string): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  // DDG html results: each result is in <div class="result ..."> ... <a class="result__a" href="...">title</a> ... <a class="result__snippet" ...>snippet</a>
  const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = resultRegex.exec(html)) !== null) {
    const rawUrl = m[1];
    const title = stripTags(m[2]).trim();
    const snippet = stripTags(m[3]).trim();
    // DDG wraps URLs in a redirect: //duckduckgo.com/l/?uddg=<encoded>
    const url = decodeDdgUrl(rawUrl);
    if (title && url) results.push({ title, url, snippet });
  }
  // fallback: looser parse if the class names changed
  if (results.length === 0) {
    const linkRegex = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    while ((m = linkRegex.exec(html)) !== null && results.length < 10) {
      const url = decodeDdgUrl(m[1]);
      const title = stripTags(m[2]).trim();
      if (title && url) results.push({ title, url, snippet: '' });
    }
  }
  return results;
}

function decodeDdgUrl(raw: string): string {
  try {
    const u = new URL(raw, 'https://duckduckgo.com');
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return u.toString();
  } catch {
    return raw;
  }
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").trim();
}

let provider: WebSearchProvider | null = null;

export function getSearchProvider(): WebSearchProvider {
  if (provider) return provider;
  const searxng = process.env.WEB_SEARCH_SEARXNG_URL;
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (searxng) provider = new SearXNGProvider(searxng);
  else if (tavilyKey) provider = new TavilyProvider(tavilyKey);
  else provider = new DuckDuckGoProvider();
  return provider;
}

export function configuredProviderId(): string {
  return getSearchProvider().id;
}
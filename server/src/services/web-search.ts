// Keyless web search via DuckDuckGo's HTML endpoint. Returns a small set of
// result snippets suitable for injection into an agent's prompt context.
//
// Why HTML and not the Instant Answer API: DDG's Instant Answer API only
// returns results for ~5% of queries (dictionary/wiki-style lookups) and is
// useless for marketing research queries. The HTML endpoint returns actual
// SERP results for any query, and DDG explicitly allows scraping it for
// non-commercial / tooling use.
//
// Keep this stateless and side-effect-free. Callers are responsible for
// rate-limiting and caching.

export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

const DDG_HTML_ENDPOINT = "https://html.duckduckgo.com/html/";
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_TIMEOUT_MS = 10_000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

export type WebSearchOptions = {
  maxResults?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// DDG wraps result URLs in a redirect: /l/?kh=-1&uddg=<encoded>. Unwrap.
function unwrapDdgRedirect(raw: string): string {
  try {
    const m = /[?&]uddg=([^&]+)/.exec(raw);
    if (m && m[1]) return decodeURIComponent(m[1]);
  } catch {
    // fall through
  }
  if (raw.startsWith("//")) return `https:${raw}`;
  return raw;
}

// Extract result blocks from DDG's HTML. Each result is a <div class="result">
// with a title anchor and a snippet. We parse with regex rather than pulling
// in a DOM library — DDG's markup is stable enough for this use.
export function parseDdgHtml(html: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const blockRegex = /<div[^>]*class="[^"]*result__body[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(html)) !== null && results.length < maxResults) {
    const block = match[1];
    const titleMatch = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!titleMatch) continue;
    const snippetMatch = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const url = unwrapDdgRedirect(decodeHtmlEntities(titleMatch[1]));
    const title = decodeHtmlEntities(stripTags(titleMatch[2]));
    const snippet = snippetMatch ? decodeHtmlEntities(stripTags(snippetMatch[1])) : "";
    if (!title || !url) continue;
    results.push({ title, url, snippet });
  }
  return results;
}

export async function webSearch(
  query: string,
  options: WebSearchOptions = {},
): Promise<WebSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // DDG's html endpoint rejects our POST bodies (returns the homepage with
    // no results) but accepts GET with q in the query string.
    const url = `${DDG_HTML_ENDPOINT}?q=${encodeURIComponent(trimmed)}&kl=us-en`;
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        "user-agent": USER_AGENT,
        "accept": "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`DuckDuckGo returned HTTP ${response.status}`);
    }
    const html = await response.text();
    return parseDdgHtml(html, maxResults);
  } finally {
    clearTimeout(timer);
  }
}

// Format results as a compact markdown block the LLM can cite from.
export function formatSearchResultsForPrompt(
  query: string,
  results: WebSearchResult[],
): string {
  if (results.length === 0) {
    return `# Web research: "${query}"\n\nNo results.`;
  }
  const lines: string[] = [`# Web research: "${query}"`, ""];
  results.forEach((r, i) => {
    lines.push(`${i + 1}. **${r.title}**`);
    lines.push(`   ${r.url}`);
    if (r.snippet) lines.push(`   ${r.snippet}`);
    lines.push("");
  });
  return lines.join("\n");
}

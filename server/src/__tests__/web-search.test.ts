import { describe, expect, it } from "vitest";
import {
  parseDdgHtml,
  formatSearchResultsForPrompt,
  webSearch,
} from "../services/web-search.js";

const FIXTURE = `
<div class="result results_links">
  <div class="result__body links_main links_deep">
    <h2 class="result__title">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1&amp;kh=-1">Example Page One</a>
    </h2>
    <a class="result__snippet" href="x">This is a snippet about <b>example</b>.</a>
  </div>
</div>
<div class="result results_links">
  <div class="result__body links_main links_deep">
    <h2 class="result__title">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fformbuddy.ai%2Ffeatures&amp;kh=-1">FormBuddy — 50,000+ templates</a>
    </h2>
    <a class="result__snippet" href="x">Scan, auto-fill, and submit any form in seconds.</a>
  </div>
</div>
`;

describe("parseDdgHtml", () => {
  it("extracts titles, unwrapped URLs, and snippets", () => {
    const results = parseDdgHtml(FIXTURE, 10);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      title: "Example Page One",
      url: "https://example.com/page1",
      snippet: "This is a snippet about example.",
    });
    expect(results[1].url).toBe("https://formbuddy.ai/features");
    expect(results[1].title).toBe("FormBuddy — 50,000+ templates");
  });

  it("respects the maxResults cap", () => {
    const results = parseDdgHtml(FIXTURE, 1);
    expect(results).toHaveLength(1);
  });

  it("returns empty array for empty or non-matching HTML", () => {
    expect(parseDdgHtml("", 5)).toEqual([]);
    expect(parseDdgHtml("<html><body>no results</body></html>", 5)).toEqual([]);
  });
});

describe("formatSearchResultsForPrompt", () => {
  it("formats results as a numbered markdown block", () => {
    const formatted = formatSearchResultsForPrompt("formbuddy alternatives", [
      { title: "A", url: "https://a.com", snippet: "snippet a" },
      { title: "B", url: "https://b.com", snippet: "" },
    ]);
    expect(formatted).toContain('# Web research: "formbuddy alternatives"');
    expect(formatted).toContain("1. **A**");
    expect(formatted).toContain("https://a.com");
    expect(formatted).toContain("snippet a");
    expect(formatted).toContain("2. **B**");
  });

  it("emits a 'No results' notice when empty", () => {
    const formatted = formatSearchResultsForPrompt("q", []);
    expect(formatted).toContain("No results");
  });
});

describe("webSearch", () => {
  it("returns empty array for empty query without hitting the network", async () => {
    let called = false;
    const results = await webSearch("  ", {
      fetchImpl: (async () => {
        called = true;
        return new Response("");
      }) as unknown as typeof fetch,
    });
    expect(results).toEqual([]);
    expect(called).toBe(false);
  });

  it("parses results from a mocked fetch response", async () => {
    const mockFetch = (async () => new Response(FIXTURE, { status: 200 })) as unknown as typeof fetch;
    const results = await webSearch("example query", { fetchImpl: mockFetch });
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].url).toBe("https://example.com/page1");
  });

  it("throws on non-200 responses", async () => {
    const mockFetch = (async () => new Response("boom", { status: 503 })) as unknown as typeof fetch;
    await expect(webSearch("q", { fetchImpl: mockFetch })).rejects.toThrow(/503/);
  });
});

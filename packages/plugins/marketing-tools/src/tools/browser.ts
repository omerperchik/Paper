// ---------------------------------------------------------------------------
// Browser automation tools: SERP scraping, competitor analysis, app store,
// landing page audit. Used as fallbacks when APIs aren't configured.
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";

export function registerBrowserTools(ctx: PluginContext) {

  ctx.tools.register("marketing_scrape_serp", async ({ params }) => {
    const { query, engine = "google", numResults = 10, location } = params as {
      query: string; engine?: string; numResults?: number; location?: string;
    };
    try {
      const searchUrl = engine === "bing"
        ? `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${numResults}`
        : `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${numResults}${location ? `&gl=${location}` : ""}`;

      const response = await ctx.http.get(searchUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PaperMarketingBot/1.0)" },
      });

      const html = response.data as string;
      // Extract basic SERP data from HTML
      const results = extractSerpResults(html, engine);
      return { query, engine, results: results.slice(0, numResults), totalFound: results.length };
    } catch (err) {
      return { error: `SERP scrape failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  ctx.tools.register("marketing_scrape_competitor", async ({ params }) => {
    const { url, extractors } = params as { url: string; extractors?: string[] };
    const targets = extractors ?? ["meta", "headings", "text"];

    try {
      const response = await ctx.http.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PaperMarketingBot/1.0)" },
      });
      const html = response.data as string;
      const result: Record<string, unknown> = { url };

      if (targets.includes("meta")) {
        result.meta = {
          title: extractTag(html, "title"),
          description: extractMeta(html, "description"),
          ogTitle: extractMeta(html, "og:title"),
          ogDescription: extractMeta(html, "og:description"),
        };
      }
      if (targets.includes("headings")) {
        result.headings = extractHeadings(html);
      }
      if (targets.includes("text")) {
        result.textPreview = stripHtml(html).slice(0, 2000);
        result.wordCount = stripHtml(html).split(/\s+/).length;
      }
      if (targets.includes("links")) {
        result.linkCount = (html.match(/<a\s/gi) || []).length;
      }
      if (targets.includes("images")) {
        result.imageCount = (html.match(/<img\s/gi) || []).length;
      }
      if (targets.includes("structured_data")) {
        result.hasStructuredData = html.includes("application/ld+json");
      }

      return result;
    } catch (err) {
      return { error: `Competitor scrape failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  ctx.tools.register("marketing_scrape_app_store", async ({ params }) => {
    const { appId, store, country = "us" } = params as { appId: string; store: string; country?: string };

    try {
      if (store === "apple") {
        const url = `https://itunes.apple.com/lookup?id=${appId}&country=${country}`;
        const response = await ctx.http.get(url);
        return response.data;
      }
      // Google Play - scrape the page
      const url = `https://play.google.com/store/apps/details?id=${appId}&hl=en&gl=${country}`;
      const response = await ctx.http.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PaperMarketingBot/1.0)" },
      });
      const html = response.data as string;
      return {
        appId,
        store,
        title: extractTag(html, "title"),
        description: extractMeta(html, "description"),
        textPreview: stripHtml(html).slice(0, 3000),
      };
    } catch (err) {
      return { error: `App store scrape failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  ctx.tools.register("marketing_check_landing_page", async ({ params }) => {
    const { url, checks: requestedChecks } = params as { url: string; checks?: string[] };
    const targets = requestedChecks ?? ["cta", "load_time", "mobile", "seo", "trust_signals"];

    try {
      const startTime = Date.now();
      const response = await ctx.http.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; PaperMarketingBot/1.0)" },
      });
      const loadTime = Date.now() - startTime;
      const html = response.data as string;

      const audit: Array<{ check: string; status: "pass" | "warn" | "fail"; detail: string }> = [];

      if (targets.includes("cta")) {
        const hasCta = /button|btn|cta|sign.?up|get.?started|try.?free|download/i.test(html);
        audit.push({
          check: "call_to_action",
          status: hasCta ? "pass" : "fail",
          detail: hasCta ? "CTA elements found" : "No clear call-to-action detected",
        });
      }

      if (targets.includes("load_time")) {
        audit.push({
          check: "load_time",
          status: loadTime < 2000 ? "pass" : loadTime < 5000 ? "warn" : "fail",
          detail: `${loadTime}ms${loadTime >= 5000 ? " — very slow, optimize for speed" : loadTime >= 2000 ? " — could be faster" : ""}`,
        });
      }

      if (targets.includes("mobile")) {
        const hasViewport = /viewport/.test(html);
        audit.push({
          check: "mobile_viewport",
          status: hasViewport ? "pass" : "fail",
          detail: hasViewport ? "Viewport meta tag present" : "Missing viewport meta tag — not mobile-optimized",
        });
      }

      if (targets.includes("seo")) {
        const hasTitle = /<title>/.test(html);
        const hasMeta = /meta.*description/.test(html);
        const hasH1 = /<h1/i.test(html);
        audit.push(
          { check: "seo_title", status: hasTitle ? "pass" : "fail", detail: hasTitle ? "Title tag present" : "Missing title tag" },
          { check: "seo_meta_description", status: hasMeta ? "pass" : "fail", detail: hasMeta ? "Meta description present" : "Missing meta description" },
          { check: "seo_h1", status: hasH1 ? "pass" : "warn", detail: hasH1 ? "H1 heading found" : "No H1 heading" },
        );
      }

      if (targets.includes("trust_signals")) {
        const hasTrustSignals = /testimonial|review|rating|customer|trusted|secure|guarantee|money.?back/i.test(html);
        audit.push({
          check: "trust_signals",
          status: hasTrustSignals ? "pass" : "warn",
          detail: hasTrustSignals ? "Trust signals found" : "Consider adding testimonials, reviews, or trust badges",
        });
      }

      if (targets.includes("accessibility")) {
        const hasAltTags = !/<img(?![^>]*alt=)/i.test(html);
        audit.push({
          check: "image_alt_tags",
          status: hasAltTags ? "pass" : "warn",
          detail: hasAltTags ? "Images have alt attributes" : "Some images missing alt attributes",
        });
      }

      const passCount = audit.filter((a) => a.status === "pass").length;
      const score = audit.length > 0 ? Math.round((passCount / audit.length) * 100) : 0;

      return { url, score, loadTimeMs: loadTime, audit };
    } catch (err) {
      return { error: `Landing page audit failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  });
}

// ---------------------------------------------------------------------------
// HTML parsing helpers
// ---------------------------------------------------------------------------

function extractSerpResults(html: string, engine: string): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  // Simple regex-based extraction (production would use a proper parser)
  const linkRegex = engine === "bing"
    ? /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*><h2>(.*?)<\/h2>/gi
    : /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>/gi;

  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1];
    if (url.includes("google.com") || url.includes("bing.com")) continue;
    results.push({ title: stripHtml(match[2]), url, snippet: "" });
  }
  return results;
}

function extractTag(html: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "is");
  const match = regex.exec(html);
  return match ? stripHtml(match[1]).trim() : null;
}

function extractMeta(html: string, name: string): string | null {
  const regex = new RegExp(`<meta[^>]*(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i");
  const match = regex.exec(html);
  if (match) return match[1];
  // Try reversed attribute order
  const regex2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i");
  const match2 = regex2.exec(html);
  return match2 ? match2[1] : null;
}

function extractHeadings(html: string): Array<{ level: number; text: string }> {
  const headings: Array<{ level: number; text: string }> = [];
  const regex = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    headings.push({ level: parseInt(match[1], 10), text: stripHtml(match[2]).trim() });
  }
  return headings;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

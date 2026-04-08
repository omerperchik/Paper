// ---------------------------------------------------------------------------
// Website Monitor — Scrape competitor sites, detect changes in content,
// pricing, features, and copy.
// ---------------------------------------------------------------------------

import type { PluginContext, WebsiteSnapshot, PageSnapshot, PricingTier } from "../types.js";
import { loadCompetitors, STATE_SCOPE } from "./competitor-tracker.js";

const DEFAULT_PAGES = ["/", "/pricing", "/features", "/about"];

async function fetchPage(ctx: PluginContext, url: string): Promise<string> {
  try {
    const resp = await ctx.http.get(url, {
      headers: { "User-Agent": "PaperclipBot/1.0 (competitive-intel)" },
    });
    return typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data);
  } catch (err) {
    ctx.logger.warn("Failed to fetch page", { url, error: String(err) });
    return "";
  }
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : undefined;
}

function extractMetaDescription(html: string): string | undefined {
  const match = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i);
  return match ? match[1].trim() : undefined;
}

function extractHeadings(html: string): string[] {
  const headings: string[] = [];
  const regex = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(html)) !== null) {
    const text = m[1].replace(/<[^>]+>/g, "").trim();
    if (text) headings.push(text);
  }
  return headings;
}

function extractFeatures(html: string): string[] {
  // Heuristic: look for list items within sections that mention "features"
  const features: string[] = [];
  const featureSection = html.match(/features[\s\S]{0,5000}?<\/section>/i);
  if (featureSection) {
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let m: RegExpExecArray | null;
    while ((m = liRegex.exec(featureSection[0])) !== null) {
      const text = m[1].replace(/<[^>]+>/g, "").trim();
      if (text && text.length < 200) features.push(text);
    }
  }
  return features;
}

function extractPricing(html: string): PricingTier[] {
  const tiers: PricingTier[] = [];
  // Heuristic: look for pricing patterns like $X/mo or $X per month
  const priceBlocks = html.match(/\$[\d,.]+(?:\s*\/\s*(?:mo|month|year|yr|annually))?/gi) ?? [];
  const tierNames = html.match(/(?:free|starter|basic|pro|premium|enterprise|business|team|growth)\s*(?:plan|tier)?/gi) ?? [];

  for (let i = 0; i < Math.min(priceBlocks.length, 6); i++) {
    tiers.push({
      name: tierNames[i] ?? `Tier ${i + 1}`,
      price: priceBlocks[i],
      period: priceBlocks[i].includes("/") ? priceBlocks[i].split("/")[1] : undefined,
      features: [],
    });
  }
  return tiers;
}

function extractTechSignals(html: string): string[] {
  const signals: string[] = [];
  const checks: Array<[RegExp, string]> = [
    [/react/i, "React"],
    [/next\.js|__next/i, "Next.js"],
    [/vue/i, "Vue"],
    [/angular/i, "Angular"],
    [/stripe/i, "Stripe"],
    [/intercom/i, "Intercom"],
    [/segment/i, "Segment"],
    [/google-analytics|gtag/i, "Google Analytics"],
    [/hotjar/i, "Hotjar"],
    [/hubspot/i, "HubSpot"],
    [/cloudflare/i, "Cloudflare"],
    [/shopify/i, "Shopify"],
    [/wordpress/i, "WordPress"],
  ];
  for (const [regex, name] of checks) {
    if (regex.test(html)) signals.push(name);
  }
  return [...new Set(signals)];
}

function extractTextContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 5000);
}

async function scanPage(ctx: PluginContext, url: string): Promise<PageSnapshot> {
  const html = await fetchPage(ctx, url);
  return {
    url,
    title: extractTitle(html),
    metaDescription: extractMetaDescription(html),
    headings: extractHeadings(html),
    features: extractFeatures(html),
    pricingTiers: extractPricing(html),
    techSignals: extractTechSignals(html),
    textContent: extractTextContent(html),
  };
}

export function registerWebsiteMonitorTools(ctx: PluginContext) {

  ctx.tools.register("competitive_scan_website", async ({ params }) => {
    const { competitorId, pages } = params as { competitorId: string; pages?: string[] };

    if (!competitorId) {
      return { error: "'competitorId' is required." };
    }

    const competitors = await loadCompetitors(ctx);
    const competitor = competitors.find((c) => c.id === competitorId);
    if (!competitor) {
      return { error: `Competitor '${competitorId}' not found.` };
    }

    const pagePaths = pages && pages.length > 0 ? pages : DEFAULT_PAGES;
    const baseUrl = `https://${competitor.domain}`;

    ctx.logger.info("Starting website scan", { competitorId, domain: competitor.domain, pages: pagePaths });

    const pageSnapshots: PageSnapshot[] = [];
    for (const path of pagePaths) {
      const url = path.startsWith("http") ? path : `${baseUrl}${path}`;
      try {
        const snapshot = await scanPage(ctx, url);
        pageSnapshots.push(snapshot);
      } catch (err) {
        ctx.logger.warn("Failed to scan page", { url, error: String(err) });
        pageSnapshots.push({
          url,
          headings: [],
          features: [],
          pricingTiers: [],
          techSignals: [],
          textContent: "",
        });
      }
    }

    const websiteSnapshot: WebsiteSnapshot = {
      competitorId,
      scannedAt: new Date().toISOString(),
      pages: pageSnapshots,
    };

    // Persist snapshot history (keep last 30)
    let history: WebsiteSnapshot[] = [];
    try {
      const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `snapshots:${competitorId}` });
      if (raw) history = JSON.parse(raw as string) ?? [];
    } catch { /* first scan */ }

    history.push(websiteSnapshot);
    if (history.length > 30) history = history.slice(-30);
    await ctx.state.set(
      { ...STATE_SCOPE, stateKey: `snapshots:${competitorId}` },
      JSON.stringify(history),
    );

    // Update competitor lastScannedAt
    const idx = competitors.findIndex((c) => c.id === competitorId);
    if (idx >= 0) {
      competitors[idx].lastScannedAt = websiteSnapshot.scannedAt;
      await ctx.state.set(
        { ...STATE_SCOPE, stateKey: "competitors" },
        JSON.stringify(competitors),
      );
    }

    ctx.logger.info("Website scan completed", {
      competitorId,
      pagesScanned: pageSnapshots.length,
      pricingTiersFound: pageSnapshots.reduce((n, p) => n + p.pricingTiers.length, 0),
    });

    return {
      snapshot: websiteSnapshot,
      summary: {
        pagesScanned: pageSnapshots.length,
        pricingTiersFound: pageSnapshots.reduce((n, p) => n + p.pricingTiers.length, 0),
        featuresFound: pageSnapshots.reduce((n, p) => n + p.features.length, 0),
        techSignals: [...new Set(pageSnapshots.flatMap((p) => p.techSignals))],
      },
    };
  });
}

export { scanPage, fetchPage };

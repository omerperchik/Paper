// ---------------------------------------------------------------------------
// Ad Library Monitor — Monitor Meta Ad Library and Google Ads Transparency
// Center for competitor ads.
// ---------------------------------------------------------------------------

import type { PluginContext, AdSnapshot, AdEntry } from "../types.js";
import { loadCompetitors, STATE_SCOPE } from "./competitor-tracker.js";

async function fetchMetaAds(
  ctx: PluginContext,
  domain: string,
  token: string | null,
  limit: number,
): Promise<AdEntry[]> {
  if (!token) {
    ctx.logger.warn("Meta Ad Library token not configured; returning simulated data");
    return [
      {
        id: `meta_sim_${Date.now()}`,
        headline: `[Simulated] Ad for ${domain}`,
        body: "Configure metaAdLibraryTokenRef to fetch real ads.",
        status: "simulated",
      },
    ];
  }

  try {
    const url = `https://graph.facebook.com/v19.0/ads_archive?search_terms=${encodeURIComponent(domain)}&ad_reached_countries=US&limit=${limit}&access_token=${token}`;
    const resp = await ctx.http.get(url);
    const data = resp.data as { data?: Array<Record<string, unknown>> };
    if (!data.data) return [];

    return data.data.map((ad) => ({
      id: String(ad.id ?? `meta_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
      headline: String(ad.ad_creative_bodies?.[0] ?? ad.page_name ?? ""),
      body: String(ad.ad_creative_bodies?.[1] ?? ""),
      imageUrl: undefined,
      landingUrl: String(ad.ad_creative_link_captions?.[0] ?? ""),
      startDate: String(ad.ad_delivery_start_time ?? ""),
      status: String(ad.ad_delivery_stop_time ? "inactive" : "active"),
    }));
  } catch (err) {
    ctx.logger.error("Failed to fetch Meta ads", { error: String(err) });
    return [];
  }
}

async function fetchGoogleAds(ctx: PluginContext, domain: string, limit: number): Promise<AdEntry[]> {
  // Google Ads Transparency Center does not have a public API.
  // Return placeholder indicating manual review is needed.
  ctx.logger.info("Google Ads Transparency Center has no public API; returning guidance", { domain });
  return [
    {
      id: `google_manual_${Date.now()}`,
      headline: `[Manual Review Required] ${domain}`,
      body: `Visit https://adstransparency.google.com/?domain=${encodeURIComponent(domain)} to review ads manually. Automated scraping is not available via a public API.`,
      landingUrl: `https://adstransparency.google.com/?domain=${encodeURIComponent(domain)}`,
      status: "manual_review",
    },
  ];
}

export function registerAdLibraryTools(ctx: PluginContext) {

  ctx.tools.register("competitive_scan_ads", async ({ params }) => {
    const { competitorId, platform = "meta", limit = 25 } = params as {
      competitorId: string;
      platform?: "meta" | "google";
      limit?: number;
    };

    if (!competitorId) {
      return { error: "'competitorId' is required." };
    }

    const competitors = await loadCompetitors(ctx);
    const competitor = competitors.find((c) => c.id === competitorId);
    if (!competitor) {
      return { error: `Competitor '${competitorId}' not found.` };
    }

    ctx.logger.info("Scanning competitor ads", { competitorId, platform, domain: competitor.domain });

    let ads: AdEntry[];
    if (platform === "google") {
      ads = await fetchGoogleAds(ctx, competitor.domain, limit);
    } else {
      const token = await ctx.secrets.get("metaAdLibraryTokenRef").catch(() => null);
      ads = await fetchMetaAds(ctx, competitor.domain, token, limit);
    }

    const snapshot: AdSnapshot = {
      competitorId,
      platform,
      scannedAt: new Date().toISOString(),
      ads,
    };

    // Persist ad snapshot history (keep last 20)
    let history: AdSnapshot[] = [];
    try {
      const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `ads:${competitorId}` });
      if (raw) history = JSON.parse(raw as string) ?? [];
    } catch { /* first scan */ }

    history.push(snapshot);
    if (history.length > 20) history = history.slice(-20);
    await ctx.state.set(
      { ...STATE_SCOPE, stateKey: `ads:${competitorId}` },
      JSON.stringify(history),
    );

    ctx.logger.info("Ad scan completed", { competitorId, platform, adsFound: ads.length });

    return {
      snapshot,
      summary: {
        platform,
        totalAds: ads.length,
        activeAds: ads.filter((a) => a.status === "active").length,
        inactiveAds: ads.filter((a) => a.status === "inactive").length,
      },
    };
  });
}

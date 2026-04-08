// ---------------------------------------------------------------------------
// Share of Voice — Estimate share of voice in search for target keywords
// ---------------------------------------------------------------------------

import type { PluginContext, ShareOfVoiceEntry } from "../types.js";
import { loadCompetitors, STATE_SCOPE } from "./competitor-tracker.js";

/**
 * Position-based visibility score (CTR model).
 * Approximates click-through rates by search position.
 */
function visibilityScore(position: number | null | undefined): number {
  if (!position || position > 100) return 0;
  if (position === 1) return 0.316;
  if (position === 2) return 0.241;
  if (position === 3) return 0.186;
  if (position <= 5) return 0.10;
  if (position <= 10) return 0.04;
  if (position <= 20) return 0.01;
  return 0.002;
}

/**
 * Fetch SERP positions for a keyword for a given domain.
 */
async function fetchPosition(
  ctx: PluginContext,
  keyword: string,
  domain: string,
  apiKey: string | null,
): Promise<number | null> {
  if (!apiKey) {
    // Without API, return null (unknown)
    return null;
  }

  try {
    const url = `https://api.serpapi.com/search.json?engine=google&q=${encodeURIComponent(keyword)}&api_key=${apiKey}&num=50`;
    const resp = await ctx.http.get(url);
    const data = resp.data as { organic_results?: Array<{ link?: string; position?: number }> };
    if (!data.organic_results) return null;

    const match = data.organic_results.find(
      (r) => r.link && r.link.includes(domain),
    );
    return match?.position ?? null;
  } catch (err) {
    ctx.logger.warn("Failed to fetch SERP position", { keyword, domain, error: String(err) });
    return null;
  }
}

export function registerShareOfVoiceTools(ctx: PluginContext) {

  ctx.tools.register("competitive_share_of_voice", async ({ params }) => {
    const { keywords, competitorIds } = params as { keywords: string[]; competitorIds?: string[] };

    if (!keywords || keywords.length === 0) {
      return { error: "'keywords' must contain at least one keyword." };
    }

    const competitors = await loadCompetitors(ctx);
    const targetCompetitors = competitorIds
      ? competitors.filter((c) => competitorIds.includes(c.id))
      : competitors;

    const ownDomain = (await ctx.config.get("ownDomain")) as string | undefined;
    const apiKey = await ctx.secrets.get("serpApiKeyRef").catch(() => null);

    if (!apiKey) {
      ctx.logger.warn("SERP API key not configured; share of voice will use estimated data");
    }

    const entries: ShareOfVoiceEntry[] = [];

    for (const keyword of keywords) {
      // Get own position
      const ownPosition = ownDomain ? await fetchPosition(ctx, keyword, ownDomain, apiKey) : null;

      // Get competitor positions
      const compPositions = await Promise.all(
        targetCompetitors.map(async (c) => ({
          competitorId: c.id,
          position: await fetchPosition(ctx, keyword, c.domain, apiKey),
        })),
      );

      const ownVis = visibilityScore(ownPosition);

      entries.push({
        keyword,
        volume: 0, // Would require additional API call for volume data
        ownPosition,
        competitors: compPositions,
        ownVisibilityScore: Math.round(ownVis * 1000) / 1000,
      });
    }

    // Calculate aggregate share of voice
    const totalOwnVisibility = entries.reduce((sum, e) => sum + e.ownVisibilityScore, 0);
    const totalAllVisibility = entries.reduce((sum, e) => {
      const compVis = e.competitors.reduce((cs, c) => cs + visibilityScore(c.position), 0);
      return sum + e.ownVisibilityScore + compVis;
    }, 0);

    const overallShareOfVoice = totalAllVisibility > 0
      ? Math.round((totalOwnVisibility / totalAllVisibility) * 10000) / 100
      : 0;

    // Per-competitor share
    const competitorShares = targetCompetitors.map((c) => {
      const compTotal = entries.reduce((sum, e) => {
        const cp = e.competitors.find((cp) => cp.competitorId === c.id);
        return sum + visibilityScore(cp?.position);
      }, 0);
      return {
        competitorId: c.id,
        name: c.name,
        shareOfVoice: totalAllVisibility > 0
          ? Math.round((compTotal / totalAllVisibility) * 10000) / 100
          : 0,
      };
    });

    ctx.logger.info("Share of voice analysis completed", {
      keywords: keywords.length,
      ownShare: overallShareOfVoice,
    });

    return {
      keywords: entries,
      aggregate: {
        ownShareOfVoice: overallShareOfVoice,
        competitorShares,
        keywordsAnalyzed: keywords.length,
      },
    };
  });
}

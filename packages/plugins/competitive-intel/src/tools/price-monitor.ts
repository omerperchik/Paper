// ---------------------------------------------------------------------------
// Price Monitor — Track competitor pricing page changes over time
// ---------------------------------------------------------------------------

import type { PluginContext, PriceChangeRecord, PricingTier, WebsiteSnapshot } from "../types.js";
import { loadCompetitors, STATE_SCOPE } from "./competitor-tracker.js";

/**
 * Compare two sets of pricing tiers and describe changes.
 */
function diffPricing(previous: PricingTier[], current: PricingTier[]): string[] {
  const changes: string[] = [];

  const prevMap = new Map(previous.map((t) => [t.name.toLowerCase(), t]));
  const currMap = new Map(current.map((t) => [t.name.toLowerCase(), t]));

  // Detect removed tiers
  for (const [name, tier] of prevMap) {
    if (!currMap.has(name)) {
      changes.push(`Tier removed: "${tier.name}" (was ${tier.price})`);
    }
  }

  // Detect added tiers
  for (const [name, tier] of currMap) {
    if (!prevMap.has(name)) {
      changes.push(`New tier added: "${tier.name}" at ${tier.price}`);
    }
  }

  // Detect price changes
  for (const [name, currTier] of currMap) {
    const prevTier = prevMap.get(name);
    if (prevTier && prevTier.price !== currTier.price) {
      changes.push(`Price change for "${currTier.name}": ${prevTier.price} -> ${currTier.price}`);
    }
  }

  return changes;
}

/**
 * Detect pricing changes from snapshot history and persist them.
 */
async function detectAndStorePriceChanges(
  ctx: PluginContext,
  competitorId: string,
): Promise<PriceChangeRecord[]> {
  let snapshots: WebsiteSnapshot[] = [];
  try {
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `snapshots:${competitorId}` });
    if (raw) snapshots = JSON.parse(raw as string) ?? [];
  } catch {
    return [];
  }

  if (snapshots.length < 2) return [];

  const newChanges: PriceChangeRecord[] = [];

  for (let i = 1; i < snapshots.length; i++) {
    const prevPricing = snapshots[i - 1].pages.flatMap((p) => p.pricingTiers);
    const currPricing = snapshots[i].pages.flatMap((p) => p.pricingTiers);

    if (prevPricing.length === 0 && currPricing.length === 0) continue;

    const changes = diffPricing(prevPricing, currPricing);
    if (changes.length > 0) {
      newChanges.push({
        competitorId,
        detectedAt: snapshots[i].scannedAt,
        previousSnapshot: prevPricing,
        currentSnapshot: currPricing,
        changes,
      });
    }
  }

  // Store price change history
  if (newChanges.length > 0) {
    let existing: PriceChangeRecord[] = [];
    try {
      const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `price-history:${competitorId}` });
      if (raw) existing = JSON.parse(raw as string) ?? [];
    } catch { /* first time */ }

    // Merge and deduplicate by detectedAt
    const existingDates = new Set(existing.map((e) => e.detectedAt));
    const merged = [...existing, ...newChanges.filter((n) => !existingDates.has(n.detectedAt))];

    // Keep last 100 records
    const trimmed = merged.slice(-100);
    await ctx.state.set(
      { ...STATE_SCOPE, stateKey: `price-history:${competitorId}` },
      JSON.stringify(trimmed),
    );

    return trimmed;
  }

  // Return existing history
  try {
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `price-history:${competitorId}` });
    if (raw) return JSON.parse(raw as string) ?? [];
  } catch { /* empty */ }
  return [];
}

export function registerPriceMonitorTools(ctx: PluginContext) {

  ctx.tools.register("competitive_price_changes", async ({ params }) => {
    const { competitorId, lookbackDays = 90 } = params as { competitorId: string; lookbackDays?: number };

    if (!competitorId) {
      return { error: "'competitorId' is required." };
    }

    const competitors = await loadCompetitors(ctx);
    const competitor = competitors.find((c) => c.id === competitorId);
    if (!competitor) {
      return { error: `Competitor '${competitorId}' not found.` };
    }

    ctx.logger.info("Fetching price change history", { competitorId, lookbackDays });

    const allChanges = await detectAndStorePriceChanges(ctx, competitorId);

    // Filter by lookback window
    const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    const filtered = allChanges.filter((c) => c.detectedAt >= cutoff);

    // Get current pricing from latest snapshot
    let currentPricing: PricingTier[] = [];
    try {
      const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `snapshots:${competitorId}` });
      if (raw) {
        const snapshots = JSON.parse(raw as string) as WebsiteSnapshot[];
        const latest = snapshots[snapshots.length - 1];
        if (latest) {
          currentPricing = latest.pages.flatMap((p) => p.pricingTiers);
        }
      }
    } catch { /* no snapshots */ }

    ctx.logger.info("Price change history retrieved", {
      competitorId,
      changesInWindow: filtered.length,
    });

    return {
      competitorId,
      competitorName: competitor.name,
      lookbackDays,
      currentPricing,
      changeHistory: filtered,
      totalChangesDetected: filtered.length,
      summary: filtered.length > 0
        ? `${filtered.length} pricing change(s) detected in the last ${lookbackDays} days.`
        : `No pricing changes detected in the last ${lookbackDays} days.`,
    };
  });
}

export { detectAndStorePriceChanges };

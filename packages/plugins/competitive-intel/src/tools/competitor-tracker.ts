// ---------------------------------------------------------------------------
// Competitor Tracker — CRUD for competitor entries stored in plugin state
// ---------------------------------------------------------------------------

import type { PluginContext, Competitor } from "../types.js";

const STATE_SCOPE = { scopeKind: "plugin", scopeId: "competitive-intel" };

async function loadCompetitors(ctx: PluginContext): Promise<Competitor[]> {
  try {
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: "competitors" });
    if (!raw) return [];
    return JSON.parse(raw as string) as Competitor[];
  } catch {
    return [];
  }
}

async function saveCompetitors(ctx: PluginContext, competitors: Competitor[]): Promise<void> {
  await ctx.state.set({ ...STATE_SCOPE, stateKey: "competitors" }, JSON.stringify(competitors));
}

function generateId(): string {
  return `comp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function registerCompetitorTrackerTools(ctx: PluginContext) {

  ctx.tools.register("competitive_add_competitor", async ({ params }) => {
    const { name, domain, notes } = params as { name: string; domain: string; notes?: string };

    if (!name || !domain) {
      return { error: "Both 'name' and 'domain' are required." };
    }

    const competitors = await loadCompetitors(ctx);

    // Check for duplicate domain
    const normalized = domain.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase();
    const existing = competitors.find(
      (c) => c.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "").toLowerCase() === normalized,
    );
    if (existing) {
      return { error: `Competitor with domain '${domain}' already tracked as '${existing.name}' (${existing.id}).` };
    }

    const competitor: Competitor = {
      id: generateId(),
      name,
      domain: normalized,
      notes,
      addedAt: new Date().toISOString(),
    };

    competitors.push(competitor);
    await saveCompetitors(ctx, competitors);

    ctx.logger.info("Competitor added", { id: competitor.id, name, domain: normalized });

    return {
      competitor,
      message: `Competitor '${name}' (${normalized}) added successfully. Run competitive_scan_website to perform the initial scan.`,
    };
  });

  ctx.tools.register("competitive_remove_competitor", async ({ params }) => {
    const { competitorId } = params as { competitorId: string };

    if (!competitorId) {
      return { error: "'competitorId' is required." };
    }

    const competitors = await loadCompetitors(ctx);
    const index = competitors.findIndex((c) => c.id === competitorId);

    if (index === -1) {
      return { error: `Competitor '${competitorId}' not found.` };
    }

    const removed = competitors.splice(index, 1)[0];
    await saveCompetitors(ctx, competitors);

    // Clean up related state
    const cleanupKeys = [
      `snapshots:${competitorId}`,
      `price-history:${competitorId}`,
      `ads:${competitorId}`,
    ];
    for (const key of cleanupKeys) {
      try {
        await ctx.state.set({ ...STATE_SCOPE, stateKey: key }, JSON.stringify(null));
      } catch {
        // Best-effort cleanup
      }
    }

    ctx.logger.info("Competitor removed", { id: competitorId, name: removed.name });

    return { removed, message: `Competitor '${removed.name}' removed and associated data cleaned up.` };
  });

  ctx.tools.register("competitive_list_competitors", async ({ params }) => {
    const { includeSnapshots = false } = params as { includeSnapshots?: boolean };

    const competitors = await loadCompetitors(ctx);

    if (competitors.length === 0) {
      return { competitors: [], message: "No competitors tracked yet. Use competitive_add_competitor to start." };
    }

    if (!includeSnapshots) {
      return { competitors, count: competitors.length };
    }

    // Attach latest snapshot summary for each competitor
    const enriched = await Promise.all(
      competitors.map(async (c) => {
        try {
          const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `snapshots:${c.id}` });
          const snapshots = raw ? JSON.parse(raw as string) : [];
          const latest = Array.isArray(snapshots) && snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
          return { ...c, latestSnapshot: latest ? { scannedAt: latest.scannedAt, pageCount: latest.pages?.length ?? 0 } : null };
        } catch {
          return { ...c, latestSnapshot: null };
        }
      }),
    );

    return { competitors: enriched, count: enriched.length };
  });
}

export { loadCompetitors, saveCompetitors, STATE_SCOPE };

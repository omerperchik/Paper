// ---------------------------------------------------------------------------
// Competitive Intelligence Plugin — worker entrypoint
// Tracks competitors, monitors website/pricing changes, analyzes keyword
// and content gaps, estimates share of voice, and generates reports.
// ---------------------------------------------------------------------------

import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { registerCompetitorTrackerTools, loadCompetitors } from "./tools/competitor-tracker.js";
import { registerWebsiteMonitorTools, scanPage } from "./tools/website-monitor.js";
import { registerAdLibraryTools } from "./tools/ad-library-monitor.js";
import { registerKeywordGapTools } from "./tools/keyword-gap.js";
import { registerContentGapTools } from "./tools/content-gap.js";
import { registerShareOfVoiceTools } from "./tools/share-of-voice.js";
import { registerPriceMonitorTools, detectAndStorePriceChanges } from "./tools/price-monitor.js";
import { registerCompetitorReportTools } from "./tools/competitor-report.js";

const STATE_SCOPE = { scopeKind: "plugin", scopeId: "competitive-intel" };

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("Competitive Intelligence plugin starting up");

    // Register all tool groups
    registerCompetitorTrackerTools(ctx);
    registerWebsiteMonitorTools(ctx);
    registerAdLibraryTools(ctx);
    registerKeywordGapTools(ctx);
    registerContentGapTools(ctx);
    registerShareOfVoiceTools(ctx);
    registerPriceMonitorTools(ctx);
    registerCompetitorReportTools(ctx);

    // -----------------------------------------------------------------------
    // Scheduled jobs
    // -----------------------------------------------------------------------

    ctx.jobs.register("competitor-daily-scan", async (job) => {
      ctx.logger.info("Starting daily competitor scan", { runId: job.runId });

      const competitors = await loadCompetitors(ctx);
      if (competitors.length === 0) {
        ctx.logger.info("No competitors tracked; skipping daily scan");
        return;
      }

      let scanned = 0;
      let errors = 0;

      for (const competitor of competitors) {
        try {
          const baseUrl = `https://${competitor.domain}`;
          const pages = ["/", "/pricing", "/features"];
          const pageSnapshots = [];

          for (const path of pages) {
            try {
              const snapshot = await scanPage(ctx, `${baseUrl}${path}`);
              pageSnapshots.push(snapshot);
            } catch {
              // Individual page failure is non-fatal
            }
          }

          const websiteSnapshot = {
            competitorId: competitor.id,
            scannedAt: new Date().toISOString(),
            pages: pageSnapshots,
          };

          // Persist snapshot
          let history: unknown[] = [];
          try {
            const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `snapshots:${competitor.id}` });
            if (raw) history = JSON.parse(raw as string) ?? [];
          } catch { /* first scan */ }

          history.push(websiteSnapshot);
          if (history.length > 30) history = history.slice(-30);
          await ctx.state.set(
            { ...STATE_SCOPE, stateKey: `snapshots:${competitor.id}` },
            JSON.stringify(history),
          );

          // Detect price changes
          const priceChanges = await detectAndStorePriceChanges(ctx, competitor.id);
          const alertOnPriceChange = await ctx.config.get("alertOnPriceChange");

          if (alertOnPriceChange && priceChanges.length > 0) {
            const latest = priceChanges[priceChanges.length - 1];
            if (latest.changes.length > 0) {
              ctx.logger.warn("Pricing change detected", {
                competitor: competitor.name,
                changes: latest.changes,
              });
              await ctx.events.emit("competitive.price-change", {
                competitorId: competitor.id,
                competitorName: competitor.name,
                changes: latest.changes,
              });
            }
          }

          scanned++;
        } catch (err) {
          errors++;
          ctx.logger.error("Failed to scan competitor", {
            competitorId: competitor.id,
            error: String(err),
          });
        }
      }

      ctx.logger.info("Daily competitor scan completed", { scanned, errors, total: competitors.length });
    });

    ctx.jobs.register("competitor-weekly-report", async (job) => {
      ctx.logger.info("Generating weekly competitive report", { runId: job.runId });

      const competitors = await loadCompetitors(ctx);
      if (competitors.length === 0) {
        ctx.logger.info("No competitors tracked; skipping weekly report");
        return;
      }

      // Build summary
      const summaries = [];
      for (const competitor of competitors) {
        let snapshotCount = 0;
        let priceChangeCount = 0;

        try {
          const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `snapshots:${competitor.id}` });
          if (raw) snapshotCount = (JSON.parse(raw as string) ?? []).length;
        } catch { /* ok */ }

        try {
          const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `price-history:${competitor.id}` });
          if (raw) priceChangeCount = (JSON.parse(raw as string) ?? []).length;
        } catch { /* ok */ }

        summaries.push({
          name: competitor.name,
          domain: competitor.domain,
          lastScanned: competitor.lastScannedAt ?? "never",
          snapshotsCollected: snapshotCount,
          pricingChanges: priceChangeCount,
        });
      }

      ctx.logger.info("Weekly competitive report generated", {
        competitorsTracked: competitors.length,
        summaries,
      });

      await ctx.events.emit("competitive.weekly-report", {
        generatedAt: new Date().toISOString(),
        competitorsTracked: competitors.length,
        summaries,
      });
    });

    // -----------------------------------------------------------------------
    // Data providers
    // -----------------------------------------------------------------------

    ctx.data.register("competitive-overview", async () => {
      const competitors = await loadCompetitors(ctx);
      return {
        competitorsTracked: competitors.length,
        competitors: competitors.map((c) => ({
          id: c.id,
          name: c.name,
          domain: c.domain,
          lastScanned: c.lastScannedAt ?? "never",
        })),
      };
    });
  },

  async onHealth() {
    return { status: "ok" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);

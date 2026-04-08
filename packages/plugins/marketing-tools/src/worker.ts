// ---------------------------------------------------------------------------
// Marketing Tools Plugin — worker entrypoint
// Provides analytics, content quality, channel integrations, CAC tracking,
// browser automation, and outreach tools for marketing agents.
// ---------------------------------------------------------------------------

import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerContentTools } from "./tools/content.js";
import { registerChannelTools } from "./tools/channels.js";
import { registerCacTools } from "./tools/cac-tracker.js";
import { registerBrowserTools } from "./tools/browser.js";
import { registerOutreachTools } from "./tools/outreach.js";
import { CostTracker } from "./services/cost-tracker.js";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("Marketing Tools plugin starting up");

    // Initialize cost tracker (shared state for CAC calculations)
    const costTracker = new CostTracker(ctx);

    // Register all tool groups
    registerAnalyticsTools(ctx, costTracker);
    registerContentTools(ctx);
    registerChannelTools(ctx);
    registerCacTools(ctx, costTracker);
    registerBrowserTools(ctx);
    registerOutreachTools(ctx);

    // Listen for relevant events
    ctx.events.on("issue.created", async (event) => {
      ctx.logger.info("Issue created in marketing context", { issueId: event.entityId });
    });

    ctx.events.on("heartbeat.completed", async (event) => {
      ctx.logger.info("Marketing agent heartbeat completed", { agentId: event.entityId });
    });

    // Register scheduled jobs
    ctx.jobs.register("daily-brief", async (job) => {
      ctx.logger.info("Generating daily marketing brief", { runId: job.runId });
      const brief = await costTracker.generateDailyBrief();
      ctx.logger.info("Daily brief generated", { brief: brief.summary });
    });

    ctx.jobs.register("cac-monitor", async (job) => {
      ctx.logger.info("Running CAC monitor", { runId: job.runId });
      const alerts = await costTracker.checkCacThresholds();
      if (alerts.length > 0) {
        ctx.logger.warn("CAC threshold alerts", { alerts });
      }
    });

    ctx.jobs.register("reddit-monitor", async (job) => {
      ctx.logger.info("Running Reddit monitor", { runId: job.runId });
    });

    // Register data providers
    ctx.data.register("marketing-overview", async ({ companyId }) => {
      return costTracker.getOverview(String(companyId));
    });

    ctx.data.register("cac-dashboard", async ({ companyId }) => {
      return costTracker.getCacDashboard(String(companyId));
    });
  },

  async onHealth() {
    return { status: "ok" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);

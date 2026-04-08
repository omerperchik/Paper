// ---------------------------------------------------------------------------
// Meta-Optimizer Plugin — worker entrypoint
// Self-improving system that tracks agent performance, analyzes prompt
// effectiveness, runs A/B experiments, and evolves playbooks.
// ---------------------------------------------------------------------------

import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { registerAgentPerformanceTools, STATE_SCOPE } from "./tools/agent-performance.js";
import { registerPromptAnalyzerTools } from "./tools/prompt-analyzer.js";
import { registerPlaybookEvolverTools } from "./tools/playbook-evolver.js";
import { registerExperimentTrackerTools } from "./tools/experiment-tracker.js";
import { registerBenchmarkTools } from "./tools/benchmark.js";
import { generateWeeklyScorecard, generateMonthlyEvolution } from "./tools/optimization-report.js";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("Meta-Optimizer plugin starting up");

    // Register all tool groups
    registerAgentPerformanceTools(ctx);
    registerPromptAnalyzerTools(ctx);
    registerPlaybookEvolverTools(ctx);
    registerExperimentTrackerTools(ctx);
    registerBenchmarkTools(ctx);

    // -----------------------------------------------------------------------
    // Event listeners — auto-track outcomes from agent events
    // -----------------------------------------------------------------------

    ctx.events.on("heartbeat.completed", async (event) => {
      ctx.logger.info("Agent heartbeat observed", { agentId: event.entityId });
    });

    ctx.events.on("task.completed", async (event) => {
      ctx.logger.info("Task completion observed — consider tracking outcome", {
        agentId: event.entityId,
      });
    });

    // -----------------------------------------------------------------------
    // Scheduled jobs
    // -----------------------------------------------------------------------

    ctx.jobs.register("meta-weekly-scorecard", async (job) => {
      ctx.logger.info("Generating weekly agent scorecard", { runId: job.runId });

      try {
        const report = await generateWeeklyScorecard(ctx);

        // Store the report
        let reports: unknown[] = [];
        try {
          const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: "weekly-scorecards" });
          if (raw) reports = JSON.parse(raw as string) ?? [];
        } catch { /* first report */ }

        reports.push(report);
        if (reports.length > 52) reports = reports.slice(-52); // Keep last year
        await ctx.state.set(
          { ...STATE_SCOPE, stateKey: "weekly-scorecards" },
          JSON.stringify(reports),
        );

        ctx.logger.info("Weekly scorecard generated", {
          agentsScored: report.agents.length,
          overallHealth: report.overallHealth,
        });

        // Emit event for other plugins/agents to consume
        await ctx.events.emit("meta-optimizer.weekly-scorecard", {
          generatedAt: report.generatedAt,
          agentCount: report.agents.length,
          overallHealth: report.overallHealth,
          degradingAgents: report.agents
            .filter((a) => a.trend === "down")
            .map((a) => a.agentId),
        });
      } catch (err) {
        ctx.logger.error("Failed to generate weekly scorecard", { error: String(err) });
      }
    });

    ctx.jobs.register("meta-monthly-evolution", async (job) => {
      ctx.logger.info("Generating monthly evolution recommendations", { runId: job.runId });

      try {
        const report = await generateMonthlyEvolution(ctx);

        // Store the report
        let reports: unknown[] = [];
        try {
          const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: "monthly-evolutions" });
          if (raw) reports = JSON.parse(raw as string) ?? [];
        } catch { /* first report */ }

        reports.push(report);
        if (reports.length > 12) reports = reports.slice(-12); // Keep last year
        await ctx.state.set(
          { ...STATE_SCOPE, stateKey: "monthly-evolutions" },
          JSON.stringify(reports),
        );

        const highPriority = report.agentRecommendations.filter((r) => r.priority === "high");

        ctx.logger.info("Monthly evolution report generated", {
          agentsAnalyzed: report.agentRecommendations.length,
          highPriorityCount: highPriority.length,
        });

        await ctx.events.emit("meta-optimizer.monthly-evolution", {
          generatedAt: report.generatedAt,
          agentsAnalyzed: report.agentRecommendations.length,
          highPriorityAgents: highPriority.map((r) => ({
            agentId: r.agentId,
            topSuggestion: r.topSuggestion,
          })),
        });
      } catch (err) {
        ctx.logger.error("Failed to generate monthly evolution report", { error: String(err) });
      }
    });

    // -----------------------------------------------------------------------
    // Data providers
    // -----------------------------------------------------------------------

    ctx.data.register("meta-optimizer-overview", async () => {
      let agentCount = 0;
      let totalOutcomes = 0;
      let experimentCount = 0;

      try {
        const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: "outcomes:index" });
        if (raw) {
          const index = JSON.parse(raw as string) as Array<{ agentId: string }>;
          agentCount = new Set(index.map((i) => i.agentId)).size;
          totalOutcomes = index.length;
        }
      } catch { /* no data */ }

      try {
        const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: "experiments:index" });
        if (raw) {
          experimentCount = (JSON.parse(raw as string) ?? []).length;
        }
      } catch { /* no data */ }

      return {
        agentsTracked: agentCount,
        totalOutcomesRecorded: totalOutcomes,
        activeExperiments: experimentCount,
      };
    });
  },

  async onHealth() {
    return { status: "ok" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);

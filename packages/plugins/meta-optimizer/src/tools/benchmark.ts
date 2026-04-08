// ---------------------------------------------------------------------------
// Benchmark — Compare current agent performance against historical
// baselines and configurable targets.
// ---------------------------------------------------------------------------

import type { PluginContext, AgentStats } from "../types.js";
import { loadOutcomes, computeAgentStats, STATE_SCOPE } from "./agent-performance.js";

interface BenchmarkEntry {
  agentId: string;
  current: AgentStats;
  baseline: AgentStats;
  deltas: {
    successRate: number;
    avgQuality: number;
    avgLatencyMs: number;
    avgCostUsd: number;
  };
  assessment: "improving" | "stable" | "degrading";
}

export function registerBenchmarkTools(ctx: PluginContext) {

  ctx.tools.register("meta_benchmark_report", async ({ params }) => {
    const { agentIds, compareWindowDays = 30, baselineWindowDays = 90 } = params as {
      agentIds?: string[];
      compareWindowDays?: number;
      baselineWindowDays?: number;
    };

    // Discover agents if not specified
    let targetAgentIds = agentIds ?? [];
    if (targetAgentIds.length === 0) {
      try {
        const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: "outcomes:index" });
        if (raw) {
          const index = JSON.parse(raw as string) as Array<{ agentId: string }>;
          targetAgentIds = [...new Set(index.map((i) => i.agentId))];
        }
      } catch { /* no data */ }
    }

    if (targetAgentIds.length === 0) {
      return {
        benchmarks: [],
        message: "No agent data available. Use meta_track_outcome to start recording outcomes.",
      };
    }

    const benchmarks: BenchmarkEntry[] = [];

    for (const agentId of targetAgentIds) {
      const outcomes = await loadOutcomes(ctx, agentId);
      if (outcomes.length === 0) continue;

      const current = computeAgentStats(outcomes, compareWindowDays);
      current.agentId = agentId;

      const baseline = computeAgentStats(outcomes, baselineWindowDays);
      baseline.agentId = agentId;

      const deltas = {
        successRate: Math.round((current.successRate - baseline.successRate) * 100) / 100,
        avgQuality: Math.round((current.avgQuality - baseline.avgQuality) * 1000) / 1000,
        avgLatencyMs: Math.round(current.avgLatencyMs - baseline.avgLatencyMs),
        avgCostUsd: Math.round((current.avgCostUsd - baseline.avgCostUsd) * 100) / 100,
      };

      // Compute overall assessment
      let score = 0;
      if (deltas.successRate > 2) score++;
      if (deltas.successRate < -2) score--;
      if (deltas.avgQuality > 0.05) score++;
      if (deltas.avgQuality < -0.05) score--;
      if (deltas.avgLatencyMs < -100) score++;
      if (deltas.avgLatencyMs > 100) score--;
      if (deltas.avgCostUsd < -0.01) score++;
      if (deltas.avgCostUsd > 0.01) score--;

      let assessment: "improving" | "stable" | "degrading";
      if (score >= 2) assessment = "improving";
      else if (score <= -2) assessment = "degrading";
      else assessment = "stable";

      benchmarks.push({ agentId, current, baseline, deltas, assessment });
    }

    // Sort: degrading first (they need attention)
    const order = { degrading: 0, stable: 1, improving: 2 };
    benchmarks.sort((a, b) => order[a.assessment] - order[b.assessment]);

    ctx.logger.info("Benchmark report generated", {
      agentsAnalyzed: benchmarks.length,
      improving: benchmarks.filter((b) => b.assessment === "improving").length,
      stable: benchmarks.filter((b) => b.assessment === "stable").length,
      degrading: benchmarks.filter((b) => b.assessment === "degrading").length,
    });

    return {
      benchmarks,
      summary: {
        agentsAnalyzed: benchmarks.length,
        improving: benchmarks.filter((b) => b.assessment === "improving").length,
        stable: benchmarks.filter((b) => b.assessment === "stable").length,
        degrading: benchmarks.filter((b) => b.assessment === "degrading").length,
        compareWindowDays,
        baselineWindowDays,
      },
      generatedAt: new Date().toISOString(),
    };
  });
}

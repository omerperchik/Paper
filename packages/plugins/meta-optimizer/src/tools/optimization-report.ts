// ---------------------------------------------------------------------------
// Optimization Report — Generate comprehensive optimization recommendations
// combining agent performance, prompt analysis, experiments, and benchmarks.
// ---------------------------------------------------------------------------
//
// This module is used internally by the scheduled jobs. The public tools are
// registered in the other tool modules. This file provides shared helpers
// for the weekly scorecard and monthly evolution jobs.
// ---------------------------------------------------------------------------

import type { PluginContext, AgentStats } from "../types.js";
import { loadOutcomes, computeAgentStats, STATE_SCOPE } from "./agent-performance.js";
import { buildPromptPatterns } from "./prompt-analyzer.js";

export interface WeeklyScorecardReport {
  generatedAt: string;
  agents: Array<{
    agentId: string;
    stats: AgentStats;
    topPromptPattern: string | null;
    trend: "up" | "down" | "flat";
  }>;
  overallHealth: "healthy" | "needs_attention" | "critical";
}

export async function generateWeeklyScorecard(ctx: PluginContext): Promise<WeeklyScorecardReport> {
  // Discover all tracked agents
  let agentIds: string[] = [];
  try {
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: "outcomes:index" });
    if (raw) {
      const index = JSON.parse(raw as string) as Array<{ agentId: string }>;
      agentIds = [...new Set(index.map((i) => i.agentId))];
    }
  } catch { /* no data */ }

  const windowDays = ((await ctx.config.get("scorecardWindowDays")) as number) ?? 30;

  const agents: WeeklyScorecardReport["agents"] = [];

  for (const agentId of agentIds) {
    const outcomes = await loadOutcomes(ctx, agentId);
    if (outcomes.length === 0) continue;

    const stats = computeAgentStats(outcomes, windowDays);
    stats.agentId = agentId;

    // Get top prompt pattern
    const patterns = buildPromptPatterns(outcomes);
    patterns.sort((a, b) => b.avgOutcomeValue - a.avgOutcomeValue);
    const topPattern = patterns.length > 0 ? patterns[0].snippet.slice(0, 100) : null;

    // Compute trend by comparing last 7 days vs previous 7 days
    const now = Date.now();
    const recentOutcomes = outcomes.filter(
      (o) => new Date(o.recordedAt).getTime() > now - 7 * 24 * 60 * 60 * 1000,
    );
    const prevOutcomes = outcomes.filter((o) => {
      const t = new Date(o.recordedAt).getTime();
      return t > now - 14 * 24 * 60 * 60 * 1000 && t <= now - 7 * 24 * 60 * 60 * 1000;
    });

    let trend: "up" | "down" | "flat" = "flat";
    if (recentOutcomes.length > 0 && prevOutcomes.length > 0) {
      const recentAvg = recentOutcomes.reduce((s, o) => s + o.value, 0) / recentOutcomes.length;
      const prevAvg = prevOutcomes.reduce((s, o) => s + o.value, 0) / prevOutcomes.length;
      const delta = prevAvg !== 0 ? (recentAvg - prevAvg) / Math.abs(prevAvg) : 0;
      if (delta > 0.05) trend = "up";
      else if (delta < -0.05) trend = "down";
    }

    agents.push({ agentId, stats, topPromptPattern: topPattern, trend });
  }

  // Determine overall health
  const degradingCount = agents.filter((a) => a.trend === "down").length;
  let overallHealth: "healthy" | "needs_attention" | "critical";
  if (degradingCount === 0) overallHealth = "healthy";
  else if (degradingCount <= agents.length * 0.3) overallHealth = "needs_attention";
  else overallHealth = "critical";

  return {
    generatedAt: new Date().toISOString(),
    agents,
    overallHealth,
  };
}

export interface MonthlyEvolutionReport {
  generatedAt: string;
  agentRecommendations: Array<{
    agentId: string;
    suggestionsCount: number;
    topSuggestion: string;
    priority: "high" | "medium" | "low";
  }>;
}

export async function generateMonthlyEvolution(ctx: PluginContext): Promise<MonthlyEvolutionReport> {
  let agentIds: string[] = [];
  try {
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: "outcomes:index" });
    if (raw) {
      const index = JSON.parse(raw as string) as Array<{ agentId: string }>;
      agentIds = [...new Set(index.map((i) => i.agentId))];
    }
  } catch { /* no data */ }

  const recommendations: MonthlyEvolutionReport["agentRecommendations"] = [];

  for (const agentId of agentIds) {
    const outcomes = await loadOutcomes(ctx, agentId);
    if (outcomes.length < 10) continue;

    const stats = computeAgentStats(outcomes, 30);

    let suggestionsCount = 0;
    let topSuggestion = "Agent is performing well.";
    let priority: "high" | "medium" | "low" = "low";

    if (stats.successRate < 70) {
      suggestionsCount++;
      topSuggestion = `Low success rate (${stats.successRate}%). Review failure patterns and add guardrails.`;
      priority = "high";
    } else if (stats.successRate < 85) {
      suggestionsCount++;
      topSuggestion = `Success rate at ${stats.successRate}%. Investigate recent failures for quick wins.`;
      priority = "medium";
    }

    if (stats.avgCostUsd > 0 && stats.successCount > 0) {
      const costPerSuccess = stats.totalCostUsd / stats.successCount;
      if (costPerSuccess > stats.avgCostUsd * 2) {
        suggestionsCount++;
        if (priority === "low") {
          topSuggestion = `High cost per success ($${Math.round(costPerSuccess * 100) / 100}). Add early-exit conditions.`;
          priority = "medium";
        }
      }
    }

    const patterns = buildPromptPatterns(outcomes);
    if (patterns.length > 3) {
      const sorted = [...patterns].sort((a, b) => b.avgOutcomeValue - a.avgOutcomeValue);
      const spread = sorted[0].avgOutcomeValue - sorted[sorted.length - 1].avgOutcomeValue;
      if (spread > sorted[0].avgOutcomeValue * 0.5) {
        suggestionsCount++;
        if (priority === "low") {
          topSuggestion = "High variance between prompt patterns. Standardize on top-performing patterns.";
          priority = "medium";
        }
      }
    }

    recommendations.push({ agentId, suggestionsCount, topSuggestion, priority });
  }

  // Sort: high priority first
  const pOrder = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => pOrder[a.priority] - pOrder[b.priority]);

  return {
    generatedAt: new Date().toISOString(),
    agentRecommendations: recommendations,
  };
}

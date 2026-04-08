// ---------------------------------------------------------------------------
// Agent Performance — Track and score agent performance over time
// ---------------------------------------------------------------------------

import type { PluginContext, OutcomeRecord, AgentStats } from "../types.js";

const STATE_SCOPE = { scopeKind: "plugin", scopeId: "meta-optimizer" };

function generateId(): string {
  return `out_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return `ph_${Math.abs(hash).toString(36)}`;
}

async function loadOutcomes(ctx: PluginContext, agentId?: string): Promise<OutcomeRecord[]> {
  try {
    const key = agentId ? `outcomes:${agentId}` : "outcomes:all";
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: key });
    if (!raw) return [];
    return JSON.parse(raw as string) as OutcomeRecord[];
  } catch {
    return [];
  }
}

async function saveOutcome(ctx: PluginContext, record: OutcomeRecord): Promise<void> {
  // Save to agent-specific list
  const agentOutcomes = await loadOutcomes(ctx, record.agentId);
  agentOutcomes.push(record);
  // Keep last 1000 per agent
  const trimmed = agentOutcomes.slice(-1000);
  await ctx.state.set(
    { ...STATE_SCOPE, stateKey: `outcomes:${record.agentId}` },
    JSON.stringify(trimmed),
  );

  // Save to global index (id + agentId only, for listing)
  let index: Array<{ id: string; agentId: string; recordedAt: string }> = [];
  try {
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: "outcomes:index" });
    if (raw) index = JSON.parse(raw as string) ?? [];
  } catch { /* first record */ }

  index.push({ id: record.id, agentId: record.agentId, recordedAt: record.recordedAt });
  if (index.length > 5000) index = index.slice(-5000);
  await ctx.state.set({ ...STATE_SCOPE, stateKey: "outcomes:index" }, JSON.stringify(index));
}

function computeAgentStats(outcomes: OutcomeRecord[], windowDays: number): AgentStats {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const filtered = outcomes.filter((o) => o.recordedAt >= cutoff);

  if (filtered.length === 0 && outcomes.length > 0) {
    // Fall back to all data if window is empty
    return computeStatsFromRecords(outcomes);
  }

  return computeStatsFromRecords(filtered.length > 0 ? filtered : outcomes);
}

function computeStatsFromRecords(records: OutcomeRecord[]): AgentStats {
  if (records.length === 0) {
    return {
      agentId: "",
      totalRuns: 0,
      successCount: 0,
      failureCount: 0,
      successRate: 0,
      avgQuality: 0,
      avgLatencyMs: 0,
      totalCostUsd: 0,
      avgCostUsd: 0,
      outcomesByType: {},
      lastUpdated: new Date().toISOString(),
    };
  }

  const agentId = records[0].agentId;

  // Consider positive outcomes as successes
  const successCount = records.filter((r) => r.value > 0).length;
  const failureCount = records.length - successCount;

  const qualityRecords = records.filter((r) => r.outcomeType === "quality_score");
  const avgQuality = qualityRecords.length > 0
    ? qualityRecords.reduce((s, r) => s + r.value, 0) / qualityRecords.length
    : 0;

  const latencyRecords = records.filter((r) => r.latencyMs != null);
  const avgLatencyMs = latencyRecords.length > 0
    ? latencyRecords.reduce((s, r) => s + (r.latencyMs ?? 0), 0) / latencyRecords.length
    : 0;

  const totalCostUsd = records.reduce((s, r) => s + (r.costUsd ?? 0), 0);

  // Group by outcome type
  const outcomesByType: Record<string, { count: number; avgValue: number; minValue: number; maxValue: number }> = {};
  for (const r of records) {
    if (!outcomesByType[r.outcomeType]) {
      outcomesByType[r.outcomeType] = { count: 0, avgValue: 0, minValue: Infinity, maxValue: -Infinity };
    }
    const group = outcomesByType[r.outcomeType];
    group.count++;
    group.avgValue += r.value;
    group.minValue = Math.min(group.minValue, r.value);
    group.maxValue = Math.max(group.maxValue, r.value);
  }
  for (const group of Object.values(outcomesByType)) {
    group.avgValue = Math.round((group.avgValue / group.count) * 1000) / 1000;
  }

  return {
    agentId,
    totalRuns: records.length,
    successCount,
    failureCount,
    successRate: Math.round((successCount / records.length) * 10000) / 100,
    avgQuality: Math.round(avgQuality * 1000) / 1000,
    avgLatencyMs: Math.round(avgLatencyMs),
    totalCostUsd: Math.round(totalCostUsd * 100) / 100,
    avgCostUsd: Math.round((totalCostUsd / records.length) * 100) / 100,
    outcomesByType,
    lastUpdated: new Date().toISOString(),
  };
}

export function registerAgentPerformanceTools(ctx: PluginContext) {

  ctx.tools.register("meta_track_outcome", async ({ params }) => {
    const {
      agentId,
      outcomeType,
      value,
      metadata,
      promptSnippet,
      latencyMs,
      costUsd,
    } = params as {
      agentId: string;
      outcomeType: string;
      value: number;
      metadata?: Record<string, unknown>;
      promptSnippet?: string;
      latencyMs?: number;
      costUsd?: number;
    };

    if (!agentId || !outcomeType || value === undefined) {
      return { error: "'agentId', 'outcomeType', and 'value' are required." };
    }

    const record: OutcomeRecord = {
      id: generateId(),
      agentId,
      outcomeType,
      value,
      metadata,
      promptSnippet,
      promptHash: promptSnippet ? simpleHash(promptSnippet) : undefined,
      latencyMs,
      costUsd,
      recordedAt: new Date().toISOString(),
    };

    await saveOutcome(ctx, record);

    ctx.logger.info("Outcome tracked", { id: record.id, agentId, outcomeType, value });

    return {
      recorded: record,
      message: `Outcome recorded for agent '${agentId}': ${outcomeType} = ${value}`,
    };
  });

  ctx.tools.register("meta_agent_scorecard", async ({ params }) => {
    const { agentId, windowDays = 30 } = params as { agentId: string; windowDays?: number };

    if (!agentId) {
      return { error: "'agentId' is required." };
    }

    const outcomes = await loadOutcomes(ctx, agentId);

    if (outcomes.length === 0) {
      return {
        agentId,
        message: `No outcomes recorded for agent '${agentId}'. Use meta_track_outcome to start tracking.`,
        scorecard: computeStatsFromRecords([]),
      };
    }

    const scorecard = computeAgentStats(outcomes, windowDays);
    scorecard.agentId = agentId;

    // Compute trend (compare current window to previous window)
    const prevWindowOutcomes = outcomes.filter((o) => {
      const cutoffCurrent = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
      const cutoffPrev = new Date(Date.now() - windowDays * 2 * 24 * 60 * 60 * 1000).toISOString();
      return o.recordedAt >= cutoffPrev && o.recordedAt < cutoffCurrent;
    });
    const prevStats = computeStatsFromRecords(prevWindowOutcomes);

    const trend = {
      successRateDelta: prevStats.totalRuns > 0
        ? Math.round((scorecard.successRate - prevStats.successRate) * 100) / 100
        : null,
      qualityDelta: prevStats.avgQuality > 0
        ? Math.round((scorecard.avgQuality - prevStats.avgQuality) * 1000) / 1000
        : null,
      latencyDelta: prevStats.avgLatencyMs > 0
        ? Math.round(scorecard.avgLatencyMs - prevStats.avgLatencyMs)
        : null,
      costDelta: prevStats.avgCostUsd > 0
        ? Math.round((scorecard.avgCostUsd - prevStats.avgCostUsd) * 100) / 100
        : null,
    };

    ctx.logger.info("Agent scorecard generated", { agentId, totalRuns: scorecard.totalRuns });

    return { scorecard, trend, windowDays };
  });
}

export { loadOutcomes, saveOutcome, computeAgentStats, STATE_SCOPE, simpleHash };

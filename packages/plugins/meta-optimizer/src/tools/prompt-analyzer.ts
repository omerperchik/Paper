// ---------------------------------------------------------------------------
// Prompt Analyzer — Analyze which prompts/instructions produce best outcomes
// ---------------------------------------------------------------------------

import type { PluginContext, PromptPattern, OutcomeRecord } from "../types.js";
import { loadOutcomes, STATE_SCOPE, simpleHash } from "./agent-performance.js";

/**
 * Build prompt pattern statistics from outcome records.
 */
function buildPromptPatterns(outcomes: OutcomeRecord[]): PromptPattern[] {
  // Group by prompt hash
  const byHash = new Map<string, OutcomeRecord[]>();

  for (const o of outcomes) {
    if (!o.promptSnippet || !o.promptHash) continue;
    const existing = byHash.get(o.promptHash) ?? [];
    existing.push(o);
    byHash.set(o.promptHash, existing);
  }

  const patterns: PromptPattern[] = [];

  for (const [hash, records] of byHash) {
    if (records.length < 2) continue; // Need at least 2 observations

    const values = records.map((r) => r.value);
    const avgValue = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - avgValue) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // Group by outcome type (use the most common)
    const typeCounts = new Map<string, number>();
    for (const r of records) {
      typeCounts.set(r.outcomeType, (typeCounts.get(r.outcomeType) ?? 0) + 1);
    }
    let dominantType = records[0].outcomeType;
    let maxCount = 0;
    for (const [type, count] of typeCounts) {
      if (count > maxCount) {
        dominantType = type;
        maxCount = count;
      }
    }

    const dates = records.map((r) => r.recordedAt).sort();

    patterns.push({
      hash,
      snippet: records[0].promptSnippet ?? "",
      agentId: records[0].agentId,
      usageCount: records.length,
      avgOutcomeValue: Math.round(avgValue * 1000) / 1000,
      outcomeType: dominantType,
      stdDev: Math.round(stdDev * 1000) / 1000,
      firstSeen: dates[0],
      lastSeen: dates[dates.length - 1],
    });
  }

  return patterns;
}

export function registerPromptAnalyzerTools(ctx: PluginContext) {

  ctx.tools.register("meta_prompt_effectiveness", async ({ params }) => {
    const { agentId, outcomeType, topN = 10 } = params as {
      agentId?: string;
      outcomeType?: string;
      topN?: number;
    };

    // Load outcomes -- either for a specific agent or scan known agents
    let allOutcomes: OutcomeRecord[] = [];

    if (agentId) {
      allOutcomes = await loadOutcomes(ctx, agentId);
    } else {
      // Load the global index to find all agents
      try {
        const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: "outcomes:index" });
        if (raw) {
          const index = JSON.parse(raw as string) as Array<{ agentId: string }>;
          const agentIds = [...new Set(index.map((i) => i.agentId))];
          for (const aid of agentIds) {
            const agentOutcomes = await loadOutcomes(ctx, aid);
            allOutcomes.push(...agentOutcomes);
          }
        }
      } catch {
        return { error: "No outcome data available. Use meta_track_outcome first." };
      }
    }

    if (allOutcomes.length === 0) {
      return {
        patterns: [],
        message: "No outcomes with prompt snippets found. Include 'promptSnippet' when calling meta_track_outcome.",
      };
    }

    // Filter by outcome type if specified
    if (outcomeType) {
      allOutcomes = allOutcomes.filter((o) => o.outcomeType === outcomeType);
    }

    // Build and rank patterns
    const patterns = buildPromptPatterns(allOutcomes);

    // Sort by average outcome value descending
    patterns.sort((a, b) => b.avgOutcomeValue - a.avgOutcomeValue);

    const topPatterns = patterns.slice(0, topN);
    const bottomPatterns = patterns.slice(-Math.min(topN, patterns.length)).reverse();

    ctx.logger.info("Prompt effectiveness analysis completed", {
      totalPatterns: patterns.length,
      returned: topPatterns.length,
    });

    return {
      topPatterns,
      bottomPatterns: bottomPatterns.slice(0, 5),
      totalPatternsAnalyzed: patterns.length,
      totalOutcomesAnalyzed: allOutcomes.length,
      insight: patterns.length > 0
        ? `Best performing pattern (avg ${topPatterns[0]?.avgOutcomeValue}): "${topPatterns[0]?.snippet.slice(0, 100)}..."`
        : "Not enough data to determine patterns.",
    };
  });
}

export { buildPromptPatterns };

// ---------------------------------------------------------------------------
// Playbook Evolver — Suggest updates to agent instructions based on
// performance data and experiment results.
// ---------------------------------------------------------------------------

import type { PluginContext, PlaybookSuggestion, OutcomeRecord } from "../types.js";
import { loadOutcomes, computeAgentStats, STATE_SCOPE } from "./agent-performance.js";
import { buildPromptPatterns } from "./prompt-analyzer.js";

/**
 * Analyze outcomes and generate improvement suggestions.
 */
function generateSuggestions(
  outcomes: OutcomeRecord[],
  focusArea: string,
  currentPlaybook?: string,
  maxSuggestions = 5,
): PlaybookSuggestion[] {
  const suggestions: PlaybookSuggestion[] = [];
  const stats = computeAgentStats(outcomes.length > 0 ? outcomes : [], 90);
  const patterns = buildPromptPatterns(outcomes);

  // Sort patterns by performance
  patterns.sort((a, b) => b.avgOutcomeValue - a.avgOutcomeValue);

  const topPatterns = patterns.slice(0, 3);
  const bottomPatterns = patterns.slice(-3);

  // --- Quality suggestions ---
  if (focusArea === "all" || focusArea === "quality") {
    if (topPatterns.length > 0 && bottomPatterns.length > 0) {
      const bestSnippet = topPatterns[0].snippet.slice(0, 200);
      const worstSnippet = bottomPatterns[0].snippet.slice(0, 200);

      suggestions.push({
        area: "quality",
        currentPattern: worstSnippet,
        suggestedChange: `Replace low-performing instruction pattern with high-performing one. Best pattern averages ${topPatterns[0].avgOutcomeValue} vs worst at ${bottomPatterns[0].avgOutcomeValue}.`,
        expectedImpact: `Potential ${Math.round(((topPatterns[0].avgOutcomeValue - bottomPatterns[0].avgOutcomeValue) / Math.abs(bottomPatterns[0].avgOutcomeValue || 1)) * 100)}% improvement in outcome value`,
        confidence: topPatterns[0].usageCount >= 10 ? "high" : topPatterns[0].usageCount >= 5 ? "medium" : "low",
        supportingData: `Based on ${topPatterns[0].usageCount} observations of top pattern and ${bottomPatterns[0].usageCount} of bottom pattern`,
      });
    }

    const qualityOutcomes = outcomes.filter((o) => o.outcomeType === "quality_score");
    if (qualityOutcomes.length > 10) {
      const recent = qualityOutcomes.slice(-10);
      const avgRecent = recent.reduce((s, r) => s + r.value, 0) / recent.length;
      const avgAll = qualityOutcomes.reduce((s, r) => s + r.value, 0) / qualityOutcomes.length;

      if (avgRecent < avgAll * 0.9) {
        suggestions.push({
          area: "quality",
          currentPattern: "Recent quality trend is declining",
          suggestedChange: "Review and reinforce quality criteria in agent instructions. Add explicit quality checkpoints.",
          expectedImpact: `Quality has dropped ${Math.round((1 - avgRecent / avgAll) * 100)}% recently`,
          confidence: "medium",
          supportingData: `Recent avg: ${Math.round(avgRecent * 100) / 100}, Historical avg: ${Math.round(avgAll * 100) / 100}`,
        });
      }
    }
  }

  // --- Speed suggestions ---
  if (focusArea === "all" || focusArea === "speed") {
    if (stats.avgLatencyMs > 0) {
      const slowOutcomes = outcomes.filter((o) => (o.latencyMs ?? 0) > stats.avgLatencyMs * 1.5);
      if (slowOutcomes.length > outcomes.length * 0.2) {
        suggestions.push({
          area: "speed",
          currentPattern: `${Math.round(slowOutcomes.length / outcomes.length * 100)}% of runs exceed 1.5x average latency`,
          suggestedChange: "Add time budgets to agent instructions. Break complex tasks into smaller steps with individual time limits.",
          expectedImpact: `Could reduce p90 latency by ~${Math.round(stats.avgLatencyMs * 0.3)}ms`,
          confidence: "medium",
          supportingData: `Avg latency: ${stats.avgLatencyMs}ms, ${slowOutcomes.length} slow runs out of ${outcomes.length}`,
        });
      }
    }
  }

  // --- Cost suggestions ---
  if (focusArea === "all" || focusArea === "cost") {
    if (stats.totalCostUsd > 0 && stats.totalRuns > 10) {
      const costPerSuccess = stats.successCount > 0
        ? stats.totalCostUsd / stats.successCount
        : stats.totalCostUsd;

      suggestions.push({
        area: "cost",
        currentPattern: `Average cost per successful outcome: $${Math.round(costPerSuccess * 100) / 100}`,
        suggestedChange: "Add early-exit conditions for low-probability tasks. Use cheaper models for initial screening before expensive operations.",
        expectedImpact: `Potential 20-30% cost reduction by avoiding wasted runs`,
        confidence: stats.totalRuns > 50 ? "high" : "medium",
        supportingData: `Total cost: $${stats.totalCostUsd}, ${stats.successCount} successes out of ${stats.totalRuns} runs`,
      });
    }
  }

  // --- Success rate suggestions ---
  if (focusArea === "all" || focusArea === "success_rate") {
    if (stats.successRate < 80 && stats.totalRuns > 10) {
      suggestions.push({
        area: "success_rate",
        currentPattern: `Success rate: ${stats.successRate}%`,
        suggestedChange: "Add pre-validation steps to catch likely failures early. Include fallback strategies in agent instructions.",
        expectedImpact: `Target: improve success rate from ${stats.successRate}% to ${Math.min(stats.successRate + 15, 95)}%`,
        confidence: stats.totalRuns > 50 ? "high" : "medium",
        supportingData: `${stats.failureCount} failures out of ${stats.totalRuns} runs`,
      });
    }
  }

  // --- Playbook-specific suggestions ---
  if (currentPlaybook) {
    if (currentPlaybook.length < 200) {
      suggestions.push({
        area: "quality",
        currentPattern: "Playbook is very short",
        suggestedChange: "Expand playbook with specific examples, edge case handling, and quality criteria. Short instructions lead to inconsistent outputs.",
        expectedImpact: "More detailed instructions typically improve consistency by 20-40%",
        confidence: "medium",
        supportingData: `Current playbook is only ${currentPlaybook.length} characters`,
      });
    }

    if (!/\b(example|e\.g\.|for instance)\b/i.test(currentPlaybook)) {
      suggestions.push({
        area: "quality",
        currentPattern: "Playbook lacks concrete examples",
        suggestedChange: "Add 2-3 concrete examples of desired output to the playbook. Few-shot examples significantly improve output quality.",
        expectedImpact: "Adding examples typically improves quality scores by 15-25%",
        confidence: "high",
        supportingData: "Research shows few-shot prompting consistently outperforms zero-shot",
      });
    }
  }

  return suggestions.slice(0, maxSuggestions);
}

export function registerPlaybookEvolverTools(ctx: PluginContext) {

  ctx.tools.register("meta_suggest_improvements", async ({ params }) => {
    const { agentId, focusArea = "all" } = params as {
      agentId: string;
      focusArea?: "quality" | "speed" | "cost" | "success_rate" | "all";
    };

    if (!agentId) {
      return { error: "'agentId' is required." };
    }

    const outcomes = await loadOutcomes(ctx, agentId);

    if (outcomes.length === 0) {
      return {
        agentId,
        suggestions: [],
        message: `No outcomes recorded for agent '${agentId}'. Track outcomes first with meta_track_outcome.`,
      };
    }

    const suggestions = generateSuggestions(outcomes, focusArea);

    ctx.logger.info("Improvement suggestions generated", {
      agentId,
      focusArea,
      suggestionsCount: suggestions.length,
    });

    return {
      agentId,
      focusArea,
      suggestions,
      outcomesAnalyzed: outcomes.length,
    };
  });

  ctx.tools.register("meta_evolve_playbook", async ({ params }) => {
    const { agentId, currentPlaybook, maxSuggestions = 5 } = params as {
      agentId: string;
      currentPlaybook?: string;
      maxSuggestions?: number;
    };

    if (!agentId) {
      return { error: "'agentId' is required." };
    }

    const outcomes = await loadOutcomes(ctx, agentId);

    if (outcomes.length < 5) {
      return {
        agentId,
        suggestions: [],
        message: `Need at least 5 recorded outcomes to generate evolution recommendations. Currently have ${outcomes.length}.`,
      };
    }

    const suggestions = generateSuggestions(outcomes, "all", currentPlaybook, maxSuggestions);

    // Load experiment results for additional context
    let experimentInsights: string[] = [];
    try {
      const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: "experiments:index" });
      if (raw) {
        const experiments = JSON.parse(raw as string) as Array<{
          experimentId: string;
          agentId: string;
          status: string;
        }>;
        const agentExperiments = experiments.filter(
          (e) => e.agentId === agentId && e.status === "completed",
        );
        for (const exp of agentExperiments.slice(-3)) {
          experimentInsights.push(
            `Experiment '${exp.experimentId}' completed — review results with meta_experiment_results for additional data.`,
          );
        }
      }
    } catch { /* no experiments */ }

    ctx.logger.info("Playbook evolution generated", {
      agentId,
      suggestionsCount: suggestions.length,
    });

    return {
      agentId,
      suggestions,
      experimentInsights,
      outcomesAnalyzed: outcomes.length,
      recommendation: suggestions.length > 0
        ? `Found ${suggestions.length} improvement opportunities. Prioritize high-confidence suggestions first.`
        : "Agent is performing well. Continue monitoring and consider running A/B experiments for further optimization.",
    };
  });
}

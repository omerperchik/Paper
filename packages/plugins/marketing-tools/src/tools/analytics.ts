// ---------------------------------------------------------------------------
// Analytics tools: CAC calculation, LTV ratio, anomaly detection, experiments
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";
import type { CostTracker } from "../services/cost-tracker.js";

export function registerAnalyticsTools(ctx: PluginContext, costTracker: CostTracker) {

  ctx.tools.register("marketing_calculate_cac", async ({ params }) => {
    const { channels } = params as { channels: Array<{ name: string; spend: number; conversions: number }> };
    const results = channels.map((ch) => ({
      channel: ch.name,
      spend: ch.spend,
      conversions: ch.conversions,
      cac: ch.conversions > 0 ? Math.round((ch.spend / ch.conversions) * 100) / 100 : null,
    }));
    const totalSpend = channels.reduce((s, c) => s + c.spend, 0);
    const totalConversions = channels.reduce((s, c) => s + c.conversions, 0);
    return {
      channels: results,
      overall: {
        totalSpend,
        totalConversions,
        blendedCac: totalConversions > 0 ? Math.round((totalSpend / totalConversions) * 100) / 100 : null,
      },
    };
  });

  ctx.tools.register("marketing_ltv_cac_ratio", async ({ params }) => {
    const { ltv, cac } = params as { ltv: number; cac: number };
    const ratio = cac > 0 ? Math.round((ltv / cac) * 100) / 100 : null;
    let health: string;
    if (ratio === null) health = "unknown";
    else if (ratio >= 5) health = "excellent";
    else if (ratio >= 3) health = "healthy";
    else if (ratio >= 1) health = "marginal";
    else health = "unprofitable";
    return { ltv, cac, ratio, health, recommendation: getRecommendation(ratio) };
  });

  ctx.tools.register("marketing_anomaly_detect", async ({ params }) => {
    const { values, labels, threshold = 2 } = params as { values: number[]; labels?: string[]; threshold?: number };
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);

    const anomalies = values.map((v, i) => {
      const zScore = stdDev > 0 ? (v - mean) / stdDev : 0;
      return {
        index: i,
        label: labels?.[i] ?? `point_${i}`,
        value: v,
        zScore: Math.round(zScore * 100) / 100,
        isAnomaly: Math.abs(zScore) > threshold,
        direction: zScore > threshold ? "high" as const : zScore < -threshold ? "low" as const : "normal" as const,
      };
    }).filter((a) => a.isAnomaly);

    return { mean: Math.round(mean * 100) / 100, stdDev: Math.round(stdDev * 100) / 100, threshold, anomalies };
  });

  ctx.tools.register("marketing_experiment_score", async ({ params }) => {
    const { control, variant, confidenceLevel = 0.95 } = params as {
      control: { visitors: number; conversions: number };
      variant: { visitors: number; conversions: number };
      confidenceLevel?: number;
    };

    const controlRate = control.conversions / control.visitors;
    const variantRate = variant.conversions / variant.visitors;
    const lift = controlRate > 0 ? (variantRate - controlRate) / controlRate : 0;

    // Two-proportion z-test
    const pooledRate = (control.conversions + variant.conversions) / (control.visitors + variant.visitors);
    const se = Math.sqrt(pooledRate * (1 - pooledRate) * (1 / control.visitors + 1 / variant.visitors));
    const zScore = se > 0 ? (variantRate - controlRate) / se : 0;

    // p-value from z-score (two-tailed approximation)
    const pValue = 2 * (1 - normalCdf(Math.abs(zScore)));
    const isSignificant = pValue < (1 - confidenceLevel);

    // Bootstrap confidence interval (simplified)
    const bootstrapSamples = 1000;
    const diffs: number[] = [];
    for (let i = 0; i < bootstrapSamples; i++) {
      const cSample = binomialSample(control.visitors, controlRate);
      const vSample = binomialSample(variant.visitors, variantRate);
      diffs.push(vSample - cSample);
    }
    diffs.sort((a, b) => a - b);
    const ciLow = diffs[Math.floor(bootstrapSamples * 0.025)];
    const ciHigh = diffs[Math.floor(bootstrapSamples * 0.975)];

    let recommendation: string;
    if (!isSignificant) recommendation = "Continue collecting data — not yet significant";
    else if (lift > 0) recommendation = "Variant wins — promote to default";
    else recommendation = "Control wins — revert variant";

    return {
      control: { ...control, rate: round4(controlRate) },
      variant: { ...variant, rate: round4(variantRate) },
      lift: round4(lift),
      liftPercent: `${round4(lift * 100)}%`,
      zScore: round4(zScore),
      pValue: round4(pValue),
      isSignificant,
      confidenceInterval: { low: round4(ciLow), high: round4(ciHigh) },
      recommendation,
    };
  });

  ctx.tools.register("marketing_daily_brief", async ({ params }) => {
    const { date, channels } = params as { date?: string; channels?: string[] };
    return costTracker.generateDailyBrief(date, channels);
  });
}

function getRecommendation(ratio: number | null): string {
  if (ratio === null) return "Cannot calculate — CAC is zero";
  if (ratio >= 5) return "Excellent unit economics. Consider scaling spend aggressively.";
  if (ratio >= 3) return "Healthy ratio. Maintain current strategy and look for incremental improvements.";
  if (ratio >= 1) return "Marginal ratio. Optimize conversion funnel and reduce CAC before scaling.";
  return "Unprofitable. Pause or significantly restructure this channel.";
}

function normalCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

function binomialSample(n: number, p: number): number {
  let successes = 0;
  for (let i = 0; i < n && i < 10000; i++) {
    if (Math.random() < p) successes++;
  }
  return successes / n;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

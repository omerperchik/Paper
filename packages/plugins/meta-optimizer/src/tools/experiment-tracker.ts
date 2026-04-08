// ---------------------------------------------------------------------------
// Experiment Tracker — Track A/B experiments across agents with
// statistical significance testing.
// ---------------------------------------------------------------------------

import type { PluginContext, Experiment, ExperimentResult } from "../types.js";
import { STATE_SCOPE } from "./agent-performance.js";

async function loadExperiment(ctx: PluginContext, experimentId: string): Promise<Experiment | null> {
  try {
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `experiment:${experimentId}` });
    if (!raw) return null;
    return JSON.parse(raw as string) as Experiment;
  } catch {
    return null;
  }
}

async function saveExperiment(ctx: PluginContext, experiment: Experiment): Promise<void> {
  await ctx.state.set(
    { ...STATE_SCOPE, stateKey: `experiment:${experiment.experimentId}` },
    JSON.stringify(experiment),
  );

  // Update experiment index
  let index: Array<{ experimentId: string; agentId: string; status: string }> = [];
  try {
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: "experiments:index" });
    if (raw) index = JSON.parse(raw as string) ?? [];
  } catch { /* first experiment */ }

  const existing = index.findIndex((e) => e.experimentId === experiment.experimentId);
  const entry = {
    experimentId: experiment.experimentId,
    agentId: experiment.agentId,
    status: experiment.status,
  };
  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.push(entry);
  }

  await ctx.state.set({ ...STATE_SCOPE, stateKey: "experiments:index" }, JSON.stringify(index));
}

/**
 * Standard normal CDF approximation (Abramowitz and Stegun).
 */
function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Welch's t-test for unequal variances.
 */
function welchTTest(
  a: number[],
  b: number[],
): { tStat: number; pValue: number; degreesOfFreedom: number } {
  const nA = a.length;
  const nB = b.length;

  if (nA < 2 || nB < 2) {
    return { tStat: 0, pValue: 1, degreesOfFreedom: 0 };
  }

  const meanA = a.reduce((s, v) => s + v, 0) / nA;
  const meanB = b.reduce((s, v) => s + v, 0) / nB;

  const varA = a.reduce((s, v) => s + (v - meanA) ** 2, 0) / (nA - 1);
  const varB = b.reduce((s, v) => s + (v - meanB) ** 2, 0) / (nB - 1);

  const se = Math.sqrt(varA / nA + varB / nB);
  if (se === 0) return { tStat: 0, pValue: 1, degreesOfFreedom: nA + nB - 2 };

  const tStat = (meanA - meanB) / se;

  // Welch-Satterthwaite degrees of freedom
  const num = (varA / nA + varB / nB) ** 2;
  const denom = (varA / nA) ** 2 / (nA - 1) + (varB / nB) ** 2 / (nB - 1);
  const df = denom > 0 ? num / denom : nA + nB - 2;

  // Approximate p-value using normal distribution (good for large samples)
  const pValue = 2 * (1 - normalCdf(Math.abs(tStat)));

  return { tStat, pValue, degreesOfFreedom: Math.round(df) };
}

function analyzeExperiment(experiment: Experiment, significanceLevel: number): ExperimentResult {
  const control = experiment.controlObservations;
  const treatment = experiment.treatmentObservations;

  const controlMean = control.length > 0 ? control.reduce((a, b) => a + b, 0) / control.length : 0;
  const treatmentMean = treatment.length > 0 ? treatment.reduce((a, b) => a + b, 0) / treatment.length : 0;

  const lift = treatmentMean - controlMean;
  const liftPercent = controlMean !== 0 ? (lift / Math.abs(controlMean)) * 100 : 0;

  const { pValue } = welchTTest(treatment, control);
  const isSignificant = pValue < significanceLevel;

  // Bootstrap confidence interval (simplified)
  const se = Math.sqrt(
    (control.length > 1 ? control.reduce((s, v) => s + (v - controlMean) ** 2, 0) / (control.length - 1) / control.length : 0) +
    (treatment.length > 1 ? treatment.reduce((s, v) => s + (v - treatmentMean) ** 2, 0) / (treatment.length - 1) / treatment.length : 0),
  );
  const z = 1.96; // 95% CI
  const confidenceInterval = {
    lower: Math.round((lift - z * se) * 1000) / 1000,
    upper: Math.round((lift + z * se) * 1000) / 1000,
  };

  let recommendation: string;
  if (control.length < 10 || treatment.length < 10) {
    recommendation = "Insufficient data. Continue collecting observations.";
  } else if (isSignificant && lift > 0) {
    recommendation = "Treatment outperforms control with statistical significance. Consider adopting the treatment approach.";
  } else if (isSignificant && lift < 0) {
    recommendation = "Control outperforms treatment with statistical significance. Revert to the control approach.";
  } else {
    recommendation = "No statistically significant difference detected. Continue collecting data or end the experiment as inconclusive.";
  }

  return {
    experimentId: experiment.experimentId,
    status: experiment.status,
    controlMean: Math.round(controlMean * 1000) / 1000,
    treatmentMean: Math.round(treatmentMean * 1000) / 1000,
    lift: Math.round(lift * 1000) / 1000,
    liftPercent: Math.round(liftPercent * 100) / 100,
    pValue: Math.round(pValue * 10000) / 10000,
    isSignificant,
    confidenceInterval,
    controlN: control.length,
    treatmentN: treatment.length,
    recommendation,
  };
}

export function registerExperimentTrackerTools(ctx: PluginContext) {

  ctx.tools.register("meta_track_experiment", async ({ params }) => {
    const {
      experimentId,
      agentId,
      hypothesis,
      controlDescription,
      treatmentDescription,
      primaryMetric,
      targetSampleSize = 100,
    } = params as {
      experimentId: string;
      agentId: string;
      hypothesis: string;
      controlDescription: string;
      treatmentDescription: string;
      primaryMetric: string;
      targetSampleSize?: number;
    };

    if (!experimentId || !agentId || !hypothesis || !controlDescription || !treatmentDescription || !primaryMetric) {
      return { error: "All required fields must be provided: experimentId, agentId, hypothesis, controlDescription, treatmentDescription, primaryMetric." };
    }

    // Check if experiment already exists
    const existing = await loadExperiment(ctx, experimentId);
    if (existing) {
      return { error: `Experiment '${experimentId}' already exists. Use a different ID or check results with meta_experiment_results.` };
    }

    const experiment: Experiment = {
      experimentId,
      agentId,
      hypothesis,
      controlDescription,
      treatmentDescription,
      primaryMetric,
      targetSampleSize,
      status: "running",
      createdAt: new Date().toISOString(),
      controlObservations: [],
      treatmentObservations: [],
    };

    await saveExperiment(ctx, experiment);

    ctx.logger.info("Experiment registered", { experimentId, agentId, primaryMetric });

    return {
      experiment: {
        experimentId,
        agentId,
        hypothesis,
        primaryMetric,
        targetSampleSize,
        status: "running",
        createdAt: experiment.createdAt,
      },
      message: `Experiment '${experimentId}' created. Add observations by including experimentId and arm ('control' or 'treatment') in meta_track_outcome metadata.`,
    };
  });

  ctx.tools.register("meta_experiment_results", async ({ params }) => {
    const { experimentId } = params as { experimentId: string };

    if (!experimentId) {
      return { error: "'experimentId' is required." };
    }

    const experiment = await loadExperiment(ctx, experimentId);
    if (!experiment) {
      return { error: `Experiment '${experimentId}' not found.` };
    }

    // Pull observations from outcomes that reference this experiment
    try {
      const agentOutcomes = await ctx.state.get({
        ...STATE_SCOPE,
        stateKey: `outcomes:${experiment.agentId}`,
      });
      if (agentOutcomes) {
        const outcomes = JSON.parse(agentOutcomes as string) as Array<{
          value: number;
          outcomeType: string;
          metadata?: Record<string, unknown>;
        }>;

        for (const o of outcomes) {
          if (o.metadata?.experimentId !== experimentId) continue;
          if (o.outcomeType !== experiment.primaryMetric && !o.metadata?.arm) continue;

          const arm = o.metadata?.arm as string;
          if (arm === "control" && !experiment.controlObservations.includes(o.value)) {
            experiment.controlObservations.push(o.value);
          } else if (arm === "treatment" && !experiment.treatmentObservations.includes(o.value)) {
            experiment.treatmentObservations.push(o.value);
          }
        }
      }
    } catch {
      // No additional observations found
    }

    // Auto-complete if target sample size reached
    if (
      experiment.status === "running" &&
      experiment.controlObservations.length >= experiment.targetSampleSize &&
      experiment.treatmentObservations.length >= experiment.targetSampleSize
    ) {
      experiment.status = "completed";
      experiment.completedAt = new Date().toISOString();
    }

    await saveExperiment(ctx, experiment);

    const significanceLevel = ((await ctx.config.get("significanceLevel")) as number) ?? 0.05;
    const result = analyzeExperiment(experiment, significanceLevel);

    ctx.logger.info("Experiment results computed", {
      experimentId,
      controlN: result.controlN,
      treatmentN: result.treatmentN,
      pValue: result.pValue,
      isSignificant: result.isSignificant,
    });

    return {
      experiment: {
        experimentId: experiment.experimentId,
        agentId: experiment.agentId,
        hypothesis: experiment.hypothesis,
        controlDescription: experiment.controlDescription,
        treatmentDescription: experiment.treatmentDescription,
        primaryMetric: experiment.primaryMetric,
        status: experiment.status,
      },
      results: result,
    };
  });
}

export { loadExperiment, saveExperiment, analyzeExperiment };

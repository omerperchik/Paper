// ---------------------------------------------------------------------------
// CAC tracking tools: spend tracking, conversion tracking, CAC by channel,
// CAC trends, budget optimization, payback period calculation
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";
import type { CostTracker } from "../services/cost-tracker.js";

export function registerCacTools(ctx: PluginContext, costTracker: CostTracker) {

  ctx.tools.register("marketing_track_spend", async ({ params }) => {
    const { channel, campaign, amount, currency = "USD", date, category } = params as {
      channel: string; campaign?: string; amount: number; currency?: string; date: string;
      category?: string;
    };
    return costTracker.recordSpend({ channel, campaign, amount, currency, date, category });
  });

  ctx.tools.register("marketing_track_conversion", async ({ params }) => {
    const { channel, campaign, conversionType, value, date, metadata } = params as {
      channel: string; campaign?: string; conversionType: string; value?: number;
      date: string; metadata?: Record<string, unknown>;
    };
    return costTracker.recordConversion({ channel, campaign, conversionType, value, date, metadata });
  });

  ctx.tools.register("marketing_cac_by_channel", async ({ params }) => {
    const { dateFrom, dateTo, channels } = params as {
      dateFrom?: string; dateTo?: string; channels?: string[];
    };
    return costTracker.getCacByChannel(dateFrom, dateTo, channels);
  });

  ctx.tools.register("marketing_cac_trend", async ({ params }) => {
    const { channel, period = "weekly", lookbackDays = 90 } = params as {
      channel?: string; period?: string; lookbackDays?: number;
    };
    return costTracker.getCacTrend(channel, period, lookbackDays);
  });

  ctx.tools.register("marketing_optimize_budget", async ({ params }) => {
    const { totalBudget, constraints } = params as {
      totalBudget: number;
      constraints?: Record<string, { min?: number; max?: number }>;
    };
    return costTracker.optimizeBudget(totalBudget, constraints);
  });

  ctx.tools.register("marketing_payback_period", async ({ params }) => {
    const { channel, avgMonthlyRevenue, grossMargin } = params as {
      channel?: string; avgMonthlyRevenue: number; grossMargin: number;
    };
    const cacData = await costTracker.getCacByChannel();
    const channelData = channel
      ? (cacData.channels ?? []).filter((c: { name: string }) => c.name === channel)
      : (cacData.channels ?? []);

    const results = channelData.map((ch: { name: string; cac: number | null }) => {
      if (!ch.cac || ch.cac === 0) return { channel: ch.name, paybackMonths: null, note: "No CAC data" };
      const monthlyContribution = avgMonthlyRevenue * grossMargin;
      const paybackMonths = monthlyContribution > 0 ? ch.cac / monthlyContribution : null;
      return {
        channel: ch.name,
        cac: ch.cac,
        monthlyContribution: Math.round(monthlyContribution * 100) / 100,
        paybackMonths: paybackMonths ? Math.round(paybackMonths * 10) / 10 : null,
        health: paybackMonths === null ? "unknown"
          : paybackMonths <= 3 ? "excellent"
          : paybackMonths <= 6 ? "good"
          : paybackMonths <= 12 ? "acceptable"
          : "concerning",
      };
    });

    return { avgMonthlyRevenue, grossMargin, channels: results };
  });
}

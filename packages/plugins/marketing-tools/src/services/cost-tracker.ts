// ---------------------------------------------------------------------------
// Cost Tracker Service
// Tracks marketing spend, conversions, and calculates CAC in real-time.
// Uses plugin state for persistence.
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";

interface SpendEntry {
  id: string;
  channel: string;
  campaign?: string;
  amount: number;
  currency: string;
  date: string;
  category?: string;
  recordedAt: string;
}

interface ConversionEntry {
  id: string;
  channel: string;
  campaign?: string;
  conversionType: string;
  value?: number;
  date: string;
  metadata?: Record<string, unknown>;
  recordedAt: string;
}

interface ChannelCac {
  name: string;
  totalSpend: number;
  totalConversions: number;
  cac: number | null;
  avgConversionValue: number | null;
}

export class CostTracker {
  constructor(private ctx: PluginContext) {}

  private async getSpendEntries(): Promise<SpendEntry[]> {
    const raw = await this.ctx.state.get({
      scopeKind: "plugin", scopeId: "marketing-tools", stateKey: "spend-ledger",
    }) as string | null;
    return raw ? JSON.parse(raw) : [];
  }

  private async saveSpendEntries(entries: SpendEntry[]): Promise<void> {
    await this.ctx.state.set(
      { scopeKind: "plugin", scopeId: "marketing-tools", stateKey: "spend-ledger" },
      JSON.stringify(entries),
    );
  }

  private async getConversionEntries(): Promise<ConversionEntry[]> {
    const raw = await this.ctx.state.get({
      scopeKind: "plugin", scopeId: "marketing-tools", stateKey: "conversion-ledger",
    }) as string | null;
    return raw ? JSON.parse(raw) : [];
  }

  private async saveConversionEntries(entries: ConversionEntry[]): Promise<void> {
    await this.ctx.state.set(
      { scopeKind: "plugin", scopeId: "marketing-tools", stateKey: "conversion-ledger" },
      JSON.stringify(entries),
    );
  }

  async recordSpend(data: Omit<SpendEntry, "id" | "recordedAt">): Promise<SpendEntry> {
    const entries = await this.getSpendEntries();
    const entry: SpendEntry = {
      ...data,
      id: `spend_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      recordedAt: new Date().toISOString(),
    };
    entries.push(entry);
    await this.saveSpendEntries(entries);
    return entry;
  }

  async recordConversion(data: Omit<ConversionEntry, "id" | "recordedAt">): Promise<ConversionEntry> {
    const entries = await this.getConversionEntries();
    const entry: ConversionEntry = {
      ...data,
      id: `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      recordedAt: new Date().toISOString(),
    };
    entries.push(entry);
    await this.saveConversionEntries(entries);
    return entry;
  }

  async getCacByChannel(
    dateFrom?: string,
    dateTo?: string,
    filterChannels?: string[],
  ): Promise<{ channels: ChannelCac[]; blendedCac: number | null }> {
    let spendEntries = await this.getSpendEntries();
    let convEntries = await this.getConversionEntries();

    if (dateFrom) {
      spendEntries = spendEntries.filter((e) => e.date >= dateFrom);
      convEntries = convEntries.filter((e) => e.date >= dateFrom);
    }
    if (dateTo) {
      spendEntries = spendEntries.filter((e) => e.date <= dateTo);
      convEntries = convEntries.filter((e) => e.date <= dateTo);
    }

    const channelSet = new Set([
      ...spendEntries.map((e) => e.channel),
      ...convEntries.map((e) => e.channel),
    ]);

    if (filterChannels?.length) {
      for (const ch of channelSet) {
        if (!filterChannels.includes(ch)) channelSet.delete(ch);
      }
    }

    const channels: ChannelCac[] = Array.from(channelSet).map((ch) => {
      const channelSpend = spendEntries.filter((e) => e.channel === ch);
      const channelConv = convEntries.filter((e) => e.channel === ch);
      const totalSpend = channelSpend.reduce((s, e) => s + e.amount, 0);
      const totalConversions = channelConv.length;
      const totalValue = channelConv.reduce((s, e) => s + (e.value ?? 0), 0);

      return {
        name: ch,
        totalSpend: Math.round(totalSpend * 100) / 100,
        totalConversions,
        cac: totalConversions > 0 ? Math.round((totalSpend / totalConversions) * 100) / 100 : null,
        avgConversionValue: totalConversions > 0 ? Math.round((totalValue / totalConversions) * 100) / 100 : null,
      };
    }).sort((a, b) => (a.cac ?? Infinity) - (b.cac ?? Infinity));

    const totalSpend = channels.reduce((s, c) => s + c.totalSpend, 0);
    const totalConversions = channels.reduce((s, c) => s + c.totalConversions, 0);
    const blendedCac = totalConversions > 0 ? Math.round((totalSpend / totalConversions) * 100) / 100 : null;

    return { channels, blendedCac };
  }

  async getCacTrend(
    channel?: string,
    period: string = "weekly",
    lookbackDays: number = 90,
  ): Promise<{ periods: Array<{ label: string; cac: number | null; spend: number; conversions: number }> }> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - lookbackDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    let spendEntries = (await this.getSpendEntries()).filter((e) => e.date >= cutoffStr);
    let convEntries = (await this.getConversionEntries()).filter((e) => e.date >= cutoffStr);

    if (channel) {
      spendEntries = spendEntries.filter((e) => e.channel === channel);
      convEntries = convEntries.filter((e) => e.channel === channel);
    }

    // Group by period
    const bucketFn = period === "daily" ? (d: string) => d
      : period === "monthly" ? (d: string) => d.slice(0, 7)
      : (d: string) => getWeekLabel(d);

    const spendByPeriod = new Map<string, number>();
    const convByPeriod = new Map<string, number>();

    for (const e of spendEntries) {
      const key = bucketFn(e.date);
      spendByPeriod.set(key, (spendByPeriod.get(key) ?? 0) + e.amount);
    }
    for (const e of convEntries) {
      const key = bucketFn(e.date);
      convByPeriod.set(key, (convByPeriod.get(key) ?? 0) + 1);
    }

    const allPeriods = Array.from(new Set([...spendByPeriod.keys(), ...convByPeriod.keys()])).sort();
    const periods = allPeriods.map((label) => {
      const spend = spendByPeriod.get(label) ?? 0;
      const conversions = convByPeriod.get(label) ?? 0;
      return {
        label,
        spend: Math.round(spend * 100) / 100,
        conversions,
        cac: conversions > 0 ? Math.round((spend / conversions) * 100) / 100 : null,
      };
    });

    return { periods };
  }

  async optimizeBudget(
    totalBudget: number,
    constraints?: Record<string, { min?: number; max?: number }>,
  ): Promise<{
    current: ChannelCac[];
    recommended: Array<{ channel: string; currentBudget: number; recommendedBudget: number; expectedCac: number | null; change: string }>;
    expectedBlendedCac: number | null;
  }> {
    const { channels } = await this.getCacByChannel();

    // Channels with valid CAC, sorted by efficiency
    const withCac = channels.filter((c) => c.cac !== null && c.cac > 0);
    const withoutCac = channels.filter((c) => c.cac === null || c.cac === 0);

    if (withCac.length === 0) {
      return {
        current: channels,
        recommended: channels.map((c) => ({
          channel: c.name,
          currentBudget: c.totalSpend,
          recommendedBudget: totalBudget / channels.length,
          expectedCac: null,
          change: "Even distribution — no CAC data to optimize",
        })),
        expectedBlendedCac: null,
      };
    }

    // Inverse CAC weighting: lower CAC channels get more budget
    const totalInverseCac = withCac.reduce((s, c) => s + (1 / c.cac!), 0);
    const recommended = withCac.map((c) => {
      const weight = (1 / c.cac!) / totalInverseCac;
      let recommended = totalBudget * weight;

      // Apply constraints
      const constraint = constraints?.[c.name];
      if (constraint?.min && recommended < constraint.min) recommended = constraint.min;
      if (constraint?.max && recommended > constraint.max) recommended = constraint.max;

      const changePct = c.totalSpend > 0
        ? Math.round(((recommended - c.totalSpend) / c.totalSpend) * 100)
        : 0;

      return {
        channel: c.name,
        currentBudget: c.totalSpend,
        recommendedBudget: Math.round(recommended * 100) / 100,
        expectedCac: c.cac,
        change: changePct > 0 ? `+${changePct}% (scale up — efficient channel)`
          : changePct < 0 ? `${changePct}% (scale down — high CAC)`
          : "No change",
      };
    });

    // Calculate expected blended CAC
    const totalRecommendedSpend = recommended.reduce((s, r) => s + r.recommendedBudget, 0);
    const expectedConversions = recommended.reduce((s, r) => {
      return s + (r.expectedCac ? r.recommendedBudget / r.expectedCac : 0);
    }, 0);
    const expectedBlendedCac = expectedConversions > 0
      ? Math.round((totalRecommendedSpend / expectedConversions) * 100) / 100
      : null;

    return { current: channels, recommended, expectedBlendedCac };
  }

  async checkCacThresholds(): Promise<Array<{ channel: string; cac: number; threshold: number }>> {
    const threshold = (await this.ctx.config.get("cacAlertThreshold") as number) ?? 100;
    const { channels } = await this.getCacByChannel();
    return channels
      .filter((c) => c.cac !== null && c.cac > threshold)
      .map((c) => ({ channel: c.name, cac: c.cac!, threshold }));
  }

  async generateDailyBrief(date?: string, filterChannels?: string[]): Promise<{
    date: string;
    summary: string;
    channels: ChannelCac[];
    blendedCac: number | null;
    alerts: string[];
  }> {
    const targetDate = date ?? new Date().toISOString().slice(0, 10);
    const { channels, blendedCac } = await this.getCacByChannel(targetDate, targetDate, filterChannels);
    const alerts: string[] = [];

    const threshold = (await this.ctx.config.get("cacAlertThreshold") as number) ?? 100;
    for (const ch of channels) {
      if (ch.cac !== null && ch.cac > threshold) {
        alerts.push(`${ch.name}: CAC $${ch.cac} exceeds threshold of $${threshold}`);
      }
    }

    const totalSpend = channels.reduce((s, c) => s + c.totalSpend, 0);
    const totalConversions = channels.reduce((s, c) => s + c.totalConversions, 0);

    const summary = [
      `Daily Marketing Brief — ${targetDate}`,
      `Total spend: $${totalSpend.toFixed(2)}`,
      `Total conversions: ${totalConversions}`,
      `Blended CAC: ${blendedCac ? `$${blendedCac.toFixed(2)}` : "N/A"}`,
      `Active channels: ${channels.length}`,
      alerts.length > 0 ? `Alerts: ${alerts.length}` : "No alerts",
    ].join("\n");

    return { date: targetDate, summary, channels, blendedCac, alerts };
  }

  async getOverview(companyId: string): Promise<Record<string, unknown>> {
    const { channels, blendedCac } = await this.getCacByChannel();
    return { companyId, channels, blendedCac, updatedAt: new Date().toISOString() };
  }

  async getCacDashboard(companyId: string): Promise<Record<string, unknown>> {
    const { channels, blendedCac } = await this.getCacByChannel();
    const trend = await this.getCacTrend(undefined, "weekly", 30);
    return { companyId, channels, blendedCac, trend: trend.periods, updatedAt: new Date().toISOString() };
  }
}

function getWeekLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const firstDayOfYear = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d.getTime() - firstDayOfYear.getTime()) / 86400000 + firstDayOfYear.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

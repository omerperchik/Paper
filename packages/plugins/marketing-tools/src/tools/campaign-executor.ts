// ---------------------------------------------------------------------------
// Autonomous campaign management — bid optimization, health checks, emergency controls
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";

const GOOGLE_ADS_BASE = "https://googleads.googleapis.com/v18";
const META_ADS_BASE = "https://graph.facebook.com/v21.0";

export function registerCampaignExecutorTools(ctx: PluginContext) {

  // -----------------------------------------------------------------------
  // AI-driven bid adjustment based on ROAS targets
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_auto_optimize_bids", async ({ params }) => {
    const {
      platform, targetRoas, maxBidAdjustmentPercent = 25,
      lookbackDays = 7, dryRun = true,
    } = params as {
      platform: string; targetRoas: number; maxBidAdjustmentPercent?: number;
      lookbackDays?: number; dryRun?: boolean;
    };
    try {
      const adjustments: Array<Record<string, unknown>> = [];

      if (platform === "google_ads") {
        const accessToken = await ctx.secrets.get("googleAdsAccessToken");
        const customerId = await ctx.secrets.get("googleAdsCustomerId");
        const developerToken = await ctx.secrets.get("googleAdsDeveloperToken");
        if (!accessToken || !customerId || !developerToken) {
          return { error: "Google Ads not configured for bid optimization." };
        }

        const hdrs = {
          Authorization: `Bearer ${accessToken}`,
          "developer-token": developerToken,
          "Content-Type": "application/json",
          "login-customer-id": customerId,
        };

        // Query campaign performance
        const dateTo = new Date().toISOString().split("T")[0];
        const dateFrom = new Date(Date.now() - lookbackDays * 86400 * 1000).toISOString().split("T")[0];
        const query = `SELECT campaign.id, campaign.name, campaign.status, campaign.bidding_strategy_type,
          metrics.cost_micros, metrics.conversions_value, metrics.conversions, metrics.clicks, metrics.impressions
          FROM campaign
          WHERE campaign.status = 'ENABLED' AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'
          ORDER BY metrics.cost_micros DESC LIMIT 50`;

        const queryUrl = `${GOOGLE_ADS_BASE}/customers/${customerId}/googleAds:searchStream`;
        const queryResp = await ctx.http.post(queryUrl, {
          headers: hdrs,
          body: JSON.stringify({ query }),
        });
        const results = queryResp.data as Array<{ results: Array<{
          campaign: { id: string; name: string; status: string; biddingStrategyType: string };
          metrics: { costMicros: string; conversionsValue: number; conversions: number };
        }> }>;

        for (const batch of (Array.isArray(results) ? results : [results])) {
          const rows = (batch as Record<string, unknown>).results as Array<Record<string, unknown>> ?? [];
          for (const row of rows) {
            const campaign = row.campaign as Record<string, unknown>;
            const metrics = row.metrics as Record<string, unknown>;
            const costMicros = Number(metrics.costMicros ?? 0);
            const conversionValue = Number(metrics.conversionsValue ?? 0);
            const cost = costMicros / 1_000_000;

            if (cost <= 0) continue;

            const currentRoas = cost > 0 ? conversionValue / cost : 0;
            const roasRatio = targetRoas > 0 ? currentRoas / targetRoas : 1;

            let bidAdjustment = 0;
            let recommendation: string;

            if (roasRatio >= 1.5) {
              // Performing well above target — increase bids
              bidAdjustment = Math.min(maxBidAdjustmentPercent, Math.round((roasRatio - 1) * 20));
              recommendation = "Increase bids — ROAS exceeds target significantly";
            } else if (roasRatio >= 1.0) {
              // At or above target — small increase
              bidAdjustment = Math.min(10, Math.round((roasRatio - 1) * 50));
              recommendation = "Slight bid increase — ROAS meets target";
            } else if (roasRatio >= 0.7) {
              // Below target but recoverable
              bidAdjustment = -Math.min(15, Math.round((1 - roasRatio) * 30));
              recommendation = "Decrease bids — ROAS below target";
            } else {
              // Far below target
              bidAdjustment = -maxBidAdjustmentPercent;
              recommendation = "Significant bid decrease — ROAS far below target. Consider pausing.";
            }

            const adjustment = {
              campaignId: campaign.id,
              campaignName: campaign.name,
              currentRoas: Math.round(currentRoas * 100) / 100,
              targetRoas,
              bidAdjustmentPercent: bidAdjustment,
              recommendation,
              applied: false,
            };

            // Apply if not dry run
            if (!dryRun && bidAdjustment !== 0) {
              try {
                // For Target CPA/ROAS strategies, adjust the target
                const mutateUrl = `${GOOGLE_ADS_BASE}/customers/${customerId}/campaigns:mutate`;
                const newTarget = Math.round(targetRoas * (1 + bidAdjustment / 100) * 100) / 100;
                await ctx.http.post(mutateUrl, {
                  headers: hdrs,
                  body: JSON.stringify({
                    operations: [{
                      update: {
                        resourceName: `customers/${customerId}/campaigns/${campaign.id}`,
                        targetRoas: { targetRoas: newTarget },
                      },
                      updateMask: "target_roas.target_roas",
                    }],
                  }),
                });
                adjustment.applied = true;
              } catch {
                adjustment.applied = false;
              }
            }

            adjustments.push(adjustment);
          }
        }
      } else if (platform === "meta_ads") {
        const accessToken = await ctx.secrets.get("metaAdsAccessToken");
        const adAccountId = await ctx.config.get("metaAdAccountId") as string | null;
        if (!accessToken || !adAccountId) {
          return { error: "Meta Ads not configured for bid optimization." };
        }

        const dateTo = new Date().toISOString().split("T")[0];
        const dateFrom = new Date(Date.now() - lookbackDays * 86400 * 1000).toISOString().split("T")[0];

        // Get campaigns with insights
        const insightsUrl = `${META_ADS_BASE}/act_${adAccountId}/insights?fields=campaign_id,campaign_name,spend,purchase_roas,actions,cost_per_action_type&level=campaign&time_range={"since":"${dateFrom}","until":"${dateTo}"}&limit=50&access_token=${accessToken}`;
        const insightsResp = await ctx.http.get(insightsUrl);
        const insightsData = insightsResp.data as { data: Array<Record<string, unknown>> };

        for (const row of insightsData.data ?? []) {
          const spend = Number(row.spend ?? 0);
          const roas = (row.purchase_roas as Array<{ value: string }> ?? [])[0];
          const currentRoas = roas ? Number(roas.value) : 0;

          if (spend <= 0) continue;

          const roasRatio = targetRoas > 0 ? currentRoas / targetRoas : 1;
          let bidAdjustment = 0;
          let recommendation: string;

          if (roasRatio >= 1.5) {
            bidAdjustment = Math.min(maxBidAdjustmentPercent, Math.round((roasRatio - 1) * 20));
            recommendation = "Increase budget — ROAS exceeds target significantly";
          } else if (roasRatio >= 1.0) {
            bidAdjustment = Math.min(10, Math.round((roasRatio - 1) * 50));
            recommendation = "Slight budget increase — ROAS meets target";
          } else if (roasRatio >= 0.7) {
            bidAdjustment = -Math.min(15, Math.round((1 - roasRatio) * 30));
            recommendation = "Decrease budget — ROAS below target";
          } else {
            bidAdjustment = -maxBidAdjustmentPercent;
            recommendation = "Significant budget decrease — ROAS far below target. Consider pausing.";
          }

          adjustments.push({
            campaignId: row.campaign_id,
            campaignName: row.campaign_name,
            currentRoas: Math.round(currentRoas * 100) / 100,
            targetRoas,
            bidAdjustmentPercent: bidAdjustment,
            recommendation,
            applied: false,
          });
        }
      } else {
        return { error: `Unsupported platform: ${platform}. Supported: google_ads, meta_ads` };
      }

      ctx.logger.info("Bid optimization completed", { platform, adjustmentCount: adjustments.length, dryRun });
      return {
        platform,
        targetRoas,
        dryRun,
        lookbackDays,
        adjustments,
        summary: {
          total: adjustments.length,
          increaseCount: adjustments.filter((a) => (a.bidAdjustmentPercent as number) > 0).length,
          decreaseCount: adjustments.filter((a) => (a.bidAdjustmentPercent as number) < 0).length,
          noChangeCount: adjustments.filter((a) => (a.bidAdjustmentPercent as number) === 0).length,
        },
      };
    } catch (err) {
      ctx.logger.error("Bid optimization failed", { error: String(err) });
      return { error: `Bid optimization error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Campaign health check — check all active campaigns against thresholds
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_campaign_health_check", async ({ params }) => {
    const {
      minRoas = 1.0, maxCpa, maxCpc, minCtr = 0.5, minConversionRate,
    } = params as {
      minRoas?: number; maxCpa?: number; maxCpc?: number;
      minCtr?: number; minConversionRate?: number;
    };
    try {
      const alerts: Array<Record<string, unknown>> = [];

      // Check Google Ads campaigns
      const gAccessToken = await ctx.secrets.get("googleAdsAccessToken");
      const gCustomerId = await ctx.secrets.get("googleAdsCustomerId");
      const gDevToken = await ctx.secrets.get("googleAdsDeveloperToken");

      if (gAccessToken && gCustomerId && gDevToken) {
        const hdrs = {
          Authorization: `Bearer ${gAccessToken}`,
          "developer-token": gDevToken,
          "Content-Type": "application/json",
          "login-customer-id": gCustomerId,
        };
        const dateTo = new Date().toISOString().split("T")[0];
        const dateFrom = new Date(Date.now() - 7 * 86400 * 1000).toISOString().split("T")[0];

        const query = `SELECT campaign.id, campaign.name, campaign.status,
          metrics.cost_micros, metrics.conversions_value, metrics.conversions,
          metrics.clicks, metrics.impressions, metrics.ctr, metrics.average_cpc,
          metrics.cost_per_conversion
          FROM campaign WHERE campaign.status = 'ENABLED'
          AND segments.date BETWEEN '${dateFrom}' AND '${dateTo}'`;

        try {
          const resp = await ctx.http.post(`${GOOGLE_ADS_BASE}/customers/${gCustomerId}/googleAds:searchStream`, {
            headers: hdrs,
            body: JSON.stringify({ query }),
          });
          const data = resp.data as Array<{ results: Array<Record<string, unknown>> }>;
          for (const batch of (Array.isArray(data) ? data : [data])) {
            for (const row of ((batch as Record<string, unknown>).results as Array<Record<string, unknown>> ?? [])) {
              const campaign = row.campaign as Record<string, unknown>;
              const metrics = row.metrics as Record<string, unknown>;
              const issues: string[] = [];

              const cost = Number(metrics.costMicros ?? 0) / 1_000_000;
              const convValue = Number(metrics.conversionsValue ?? 0);
              const conversions = Number(metrics.conversions ?? 0);
              const ctr = Number(metrics.ctr ?? 0) * 100;
              const avgCpc = Number(metrics.averageCpc ?? 0) / 1_000_000;
              const costPerConv = Number(metrics.costPerConversion ?? 0) / 1_000_000;
              const roas = cost > 0 ? convValue / cost : 0;

              if (cost > 0 && roas < minRoas) issues.push(`Low ROAS: ${roas.toFixed(2)} (min: ${minRoas})`);
              if (maxCpa && costPerConv > maxCpa) issues.push(`High CPA: $${costPerConv.toFixed(2)} (max: $${maxCpa})`);
              if (maxCpc && avgCpc > maxCpc) issues.push(`High CPC: $${avgCpc.toFixed(2)} (max: $${maxCpc})`);
              if (ctr < minCtr) issues.push(`Low CTR: ${ctr.toFixed(2)}% (min: ${minCtr}%)`);
              if (minConversionRate && conversions > 0) {
                const clicks = Number(metrics.clicks ?? 0);
                const convRate = clicks > 0 ? (conversions / clicks) * 100 : 0;
                if (convRate < minConversionRate) issues.push(`Low conversion rate: ${convRate.toFixed(2)}% (min: ${minConversionRate}%)`);
              }

              if (issues.length > 0) {
                alerts.push({
                  platform: "google_ads",
                  campaignId: campaign.id,
                  campaignName: campaign.name,
                  severity: issues.length >= 3 ? "critical" : issues.length >= 2 ? "warning" : "info",
                  issues,
                  metrics: { cost, roas, ctr, avgCpc, costPerConv, conversions },
                });
              }
            }
          }
        } catch (err) {
          ctx.logger.warn("Google Ads health check skipped", { error: String(err) });
        }
      }

      // Check Meta Ads campaigns
      const mAccessToken = await ctx.secrets.get("metaAdsAccessToken");
      const mAdAccountId = await ctx.config.get("metaAdAccountId") as string | null;

      if (mAccessToken && mAdAccountId) {
        const dateTo = new Date().toISOString().split("T")[0];
        const dateFrom = new Date(Date.now() - 7 * 86400 * 1000).toISOString().split("T")[0];

        try {
          const url = `${META_ADS_BASE}/act_${mAdAccountId}/insights?fields=campaign_id,campaign_name,spend,purchase_roas,cpc,ctr,actions,cost_per_action_type&level=campaign&time_range={"since":"${dateFrom}","until":"${dateTo}"}&filtering=[{"field":"campaign.effective_status","operator":"IN","value":["ACTIVE"]}]&limit=50&access_token=${mAccessToken}`;
          const resp = await ctx.http.get(url);
          const data = resp.data as { data: Array<Record<string, unknown>> };

          for (const row of data.data ?? []) {
            const issues: string[] = [];
            const spend = Number(row.spend ?? 0);
            const ctr = Number(row.ctr ?? 0);
            const cpc = Number(row.cpc ?? 0);
            const roas = (row.purchase_roas as Array<{ value: string }> ?? [])[0];
            const currentRoas = roas ? Number(roas.value) : 0;

            if (spend > 0 && currentRoas < minRoas) issues.push(`Low ROAS: ${currentRoas.toFixed(2)} (min: ${minRoas})`);
            if (maxCpc && cpc > maxCpc) issues.push(`High CPC: $${cpc.toFixed(2)} (max: $${maxCpc})`);
            if (ctr < minCtr) issues.push(`Low CTR: ${ctr.toFixed(2)}% (min: ${minCtr}%)`);

            if (issues.length > 0) {
              alerts.push({
                platform: "meta_ads",
                campaignId: row.campaign_id,
                campaignName: row.campaign_name,
                severity: issues.length >= 3 ? "critical" : issues.length >= 2 ? "warning" : "info",
                issues,
                metrics: { spend, roas: currentRoas, ctr, cpc },
              });
            }
          }
        } catch (err) {
          ctx.logger.warn("Meta Ads health check skipped", { error: String(err) });
        }
      }

      ctx.logger.info("Campaign health check completed", { alertCount: alerts.length });
      return {
        thresholds: { minRoas, maxCpa, maxCpc, minCtr, minConversionRate },
        alerts,
        summary: {
          totalAlerts: alerts.length,
          critical: alerts.filter((a) => a.severity === "critical").length,
          warning: alerts.filter((a) => a.severity === "warning").length,
          info: alerts.filter((a) => a.severity === "info").length,
          platformsChecked: [
            ...(gAccessToken && gCustomerId ? ["google_ads"] : []),
            ...(mAccessToken && mAdAccountId ? ["meta_ads"] : []),
          ],
        },
      };
    } catch (err) {
      ctx.logger.error("Campaign health check failed", { error: String(err) });
      return { error: `Health check error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Emergency pause all campaigns (budget protection)
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_emergency_pause_all", async ({ params }) => {
    const { reason, platforms = ["google_ads", "meta_ads"] } = params as {
      reason: string; platforms?: string[];
    };
    try {
      const results: Array<{ platform: string; paused: number; errors: string[] }> = [];

      if (platforms.includes("google_ads")) {
        const accessToken = await ctx.secrets.get("googleAdsAccessToken");
        const customerId = await ctx.secrets.get("googleAdsCustomerId");
        const devToken = await ctx.secrets.get("googleAdsDeveloperToken");
        const gErrors: string[] = [];
        let gPaused = 0;

        if (accessToken && customerId && devToken) {
          const hdrs = {
            Authorization: `Bearer ${accessToken}`,
            "developer-token": devToken,
            "Content-Type": "application/json",
            "login-customer-id": customerId,
          };

          // Get all enabled campaigns
          const queryResp = await ctx.http.post(`${GOOGLE_ADS_BASE}/customers/${customerId}/googleAds:searchStream`, {
            headers: hdrs,
            body: JSON.stringify({
              query: "SELECT campaign.id, campaign.name FROM campaign WHERE campaign.status = 'ENABLED'",
            }),
          });
          const data = queryResp.data as Array<{ results: Array<{ campaign: { id: string; name: string } }> }>;

          const campaigns: Array<{ id: string; name: string }> = [];
          for (const batch of (Array.isArray(data) ? data : [data])) {
            for (const row of ((batch as Record<string, unknown>).results as Array<Record<string, unknown>> ?? [])) {
              const c = row.campaign as Record<string, unknown>;
              campaigns.push({ id: c.id as string, name: c.name as string });
            }
          }

          // Pause all in a single mutate
          if (campaigns.length > 0) {
            const operations = campaigns.map((c) => ({
              update: {
                resourceName: `customers/${customerId}/campaigns/${c.id}`,
                status: "PAUSED",
              },
              updateMask: "status",
            }));

            try {
              await ctx.http.post(`${GOOGLE_ADS_BASE}/customers/${customerId}/campaigns:mutate`, {
                headers: hdrs,
                body: JSON.stringify({ operations }),
              });
              gPaused = campaigns.length;
            } catch (err) {
              gErrors.push(`Batch pause failed: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        } else {
          gErrors.push("Google Ads credentials not configured");
        }
        results.push({ platform: "google_ads", paused: gPaused, errors: gErrors });
      }

      if (platforms.includes("meta_ads")) {
        const accessToken = await ctx.secrets.get("metaAdsAccessToken");
        const adAccountId = await ctx.config.get("metaAdAccountId") as string | null;
        const mErrors: string[] = [];
        let mPaused = 0;

        if (accessToken && adAccountId) {
          // Get active campaigns
          const listUrl = `${META_ADS_BASE}/act_${adAccountId}/campaigns?fields=id,name&filtering=[{"field":"effective_status","operator":"IN","value":["ACTIVE"]}]&limit=100&access_token=${accessToken}`;
          const listResp = await ctx.http.get(listUrl);
          const campaigns = (listResp.data as { data: Array<{ id: string; name: string }> }).data ?? [];

          // Pause each campaign
          for (const campaign of campaigns) {
            try {
              await ctx.http.post(`${META_ADS_BASE}/${campaign.id}`, {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "PAUSED", access_token: accessToken }),
              });
              mPaused++;
            } catch (err) {
              mErrors.push(`Failed to pause ${campaign.id}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        } else {
          mErrors.push("Meta Ads credentials not configured");
        }
        results.push({ platform: "meta_ads", paused: mPaused, errors: mErrors });
      }

      const totalPaused = results.reduce((s, r) => s + r.paused, 0);
      ctx.logger.warn("Emergency pause executed", { reason, totalPaused });
      return {
        reason,
        results,
        totalPaused,
        timestamp: new Date().toISOString(),
        message: `Emergency pause complete. ${totalPaused} campaigns paused across ${platforms.join(", ")}.`,
      };
    } catch (err) {
      ctx.logger.error("Emergency pause failed", { error: String(err) });
      return { error: `Emergency pause error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Rebalance budget across channels based on CAC
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_rebalance_budget", async ({ params }) => {
    const {
      totalBudget, channels, optimizeFor = "cac", constraints,
    } = params as {
      totalBudget: number;
      channels: Array<{
        name: string; currentSpend: number; conversions: number;
        revenue?: number; minBudget?: number; maxBudget?: number;
      }>;
      optimizeFor?: string;
      constraints?: { maxChannelPercent?: number; minChannelPercent?: number };
    };
    try {
      const maxPct = constraints?.maxChannelPercent ?? 60;
      const minPct = constraints?.minChannelPercent ?? 5;
      const maxBudget = totalBudget * (maxPct / 100);
      const minBudget = totalBudget * (minPct / 100);

      // Calculate efficiency scores for each channel
      const scored = channels.map((ch) => {
        const cac = ch.conversions > 0 ? ch.currentSpend / ch.conversions : Infinity;
        const roas = ch.revenue && ch.currentSpend > 0 ? ch.revenue / ch.currentSpend : 0;
        let score: number;
        if (optimizeFor === "roas") {
          score = roas;
        } else {
          // Lower CAC = higher score
          score = cac === Infinity ? 0 : cac > 0 ? 1 / cac : 0;
        }
        return { ...ch, cac, roas, score };
      });

      const totalScore = scored.reduce((s, ch) => s + ch.score, 0);

      // Allocate budget proportional to score, respecting constraints
      let allocated = scored.map((ch) => {
        const rawAllocation = totalScore > 0
          ? (ch.score / totalScore) * totalBudget
          : totalBudget / channels.length;

        const chMin = Math.max(ch.minBudget ?? minBudget, minBudget);
        const chMax = Math.min(ch.maxBudget ?? maxBudget, maxBudget);
        const constrained = Math.max(chMin, Math.min(chMax, rawAllocation));

        return {
          name: ch.name,
          currentSpend: ch.currentSpend,
          recommendedBudget: Math.round(constrained * 100) / 100,
          change: Math.round((constrained - ch.currentSpend) * 100) / 100,
          changePercent: ch.currentSpend > 0
            ? Math.round(((constrained - ch.currentSpend) / ch.currentSpend) * 10000) / 100
            : 0,
          cac: ch.conversions > 0 ? Math.round((ch.currentSpend / ch.conversions) * 100) / 100 : null,
          roas: ch.revenue && ch.currentSpend > 0 ? Math.round((ch.revenue / ch.currentSpend) * 100) / 100 : null,
          efficiencyScore: Math.round(ch.score * 10000) / 10000,
        };
      });

      // Normalize to exactly match total budget
      const allocatedTotal = allocated.reduce((s, a) => s + a.recommendedBudget, 0);
      if (allocatedTotal !== totalBudget && allocated.length > 0) {
        const diff = totalBudget - allocatedTotal;
        // Add remainder to the highest-scoring channel
        const sorted = [...allocated].sort((a, b) => b.efficiencyScore - a.efficiencyScore);
        sorted[0].recommendedBudget = Math.round((sorted[0].recommendedBudget + diff) * 100) / 100;
        sorted[0].change = Math.round((sorted[0].recommendedBudget - sorted[0].currentSpend) * 100) / 100;
      }

      ctx.logger.info("Budget rebalanced", { totalBudget, channelCount: channels.length });
      return {
        totalBudget,
        optimizeFor,
        allocation: allocated,
        summary: {
          channelsIncreased: allocated.filter((a) => a.change > 0).length,
          channelsDecreased: allocated.filter((a) => a.change < 0).length,
          channelsUnchanged: allocated.filter((a) => a.change === 0).length,
          totalAllocated: allocated.reduce((s, a) => s + a.recommendedBudget, 0),
        },
      };
    } catch (err) {
      ctx.logger.error("Budget rebalance failed", { error: String(err) });
      return { error: `Budget rebalance error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });
}

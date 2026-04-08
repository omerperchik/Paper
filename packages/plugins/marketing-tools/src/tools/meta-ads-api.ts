// ---------------------------------------------------------------------------
// Meta Marketing API v21.0 — real REST API integration
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";

const BASE_URL = "https://graph.facebook.com/v21.0";

async function getCredentials(ctx: PluginContext) {
  const accessToken = await ctx.secrets.get("metaAdsAccessToken");
  const adAccountId = await ctx.config.get("metaAdAccountId") as string | null;
  if (!accessToken || !adAccountId) {
    return null;
  }
  return { accessToken, adAccountId };
}

export function registerMetaAdsApiTools(ctx: PluginContext) {

  // -----------------------------------------------------------------------
  // List ad campaigns
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_meta_ads_list_campaigns", async ({ params }) => {
    const { status, limit = 50, fields } = params as {
      status?: string; limit?: number; fields?: string[];
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "Meta Ads not configured. Set metaAdsAccessToken and metaAdAccountId in plugin config." };
    }
    try {
      const defaultFields = ["id", "name", "status", "objective", "daily_budget", "lifetime_budget", "created_time", "updated_time", "start_time", "stop_time"];
      const fieldStr = (fields ?? defaultFields).join(",");
      let url = `${BASE_URL}/act_${creds.adAccountId}/campaigns?fields=${fieldStr}&limit=${limit}&access_token=${creds.accessToken}`;
      if (status) {
        url += `&filtering=[{"field":"effective_status","operator":"IN","value":["${status.toUpperCase()}"]}]`;
      }
      const response = await ctx.http.get(url);
      ctx.logger.info("Meta Ads list campaigns completed", { adAccountId: creds.adAccountId });
      return response.data;
    } catch (err) {
      ctx.logger.error("Meta Ads list campaigns failed", { error: String(err) });
      return { error: `Meta Ads API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Create campaign with objective
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_meta_ads_create_campaign", async ({ params }) => {
    const {
      name, objective, status = "PAUSED", specialAdCategories = [],
      dailyBudget, lifetimeBudget, bidStrategy,
    } = params as {
      name: string; objective: string; status?: string;
      specialAdCategories?: string[]; dailyBudget?: number;
      lifetimeBudget?: number; bidStrategy?: string;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "Meta Ads not configured. Set metaAdsAccessToken and metaAdAccountId in plugin config." };
    }
    try {
      const body: Record<string, string> = {
        name,
        objective: objective.toUpperCase(),
        status: status.toUpperCase(),
        special_ad_categories: JSON.stringify(specialAdCategories),
        access_token: creds.accessToken,
      };
      if (dailyBudget) body.daily_budget = String(Math.round(dailyBudget * 100)); // cents
      if (lifetimeBudget) body.lifetime_budget = String(Math.round(lifetimeBudget * 100));
      if (bidStrategy) body.bid_strategy = bidStrategy.toUpperCase();

      const url = `${BASE_URL}/act_${creds.adAccountId}/campaigns`;
      const response = await ctx.http.post(url, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      ctx.logger.info("Meta Ads campaign created", { name, objective });
      return response.data;
    } catch (err) {
      ctx.logger.error("Meta Ads create campaign failed", { error: String(err) });
      return { error: `Meta Ads API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Create ad set with targeting
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_meta_ads_create_adset", async ({ params }) => {
    const {
      name, campaignId, dailyBudget, lifetimeBudget, billingEvent = "IMPRESSIONS",
      optimizationGoal = "REACH", startTime, endTime, targeting, status = "PAUSED",
    } = params as {
      name: string; campaignId: string; dailyBudget?: number; lifetimeBudget?: number;
      billingEvent?: string; optimizationGoal?: string; startTime?: string;
      endTime?: string; targeting: Record<string, unknown>; status?: string;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "Meta Ads not configured. Set metaAdsAccessToken and metaAdAccountId in plugin config." };
    }
    try {
      const body: Record<string, unknown> = {
        name,
        campaign_id: campaignId,
        billing_event: billingEvent.toUpperCase(),
        optimization_goal: optimizationGoal.toUpperCase(),
        targeting: JSON.stringify(targeting),
        status: status.toUpperCase(),
        access_token: creds.accessToken,
      };
      if (dailyBudget) body.daily_budget = String(Math.round(dailyBudget * 100));
      if (lifetimeBudget) body.lifetime_budget = String(Math.round(lifetimeBudget * 100));
      if (startTime) body.start_time = startTime;
      if (endTime) body.end_time = endTime;

      const url = `${BASE_URL}/act_${creds.adAccountId}/adsets`;
      const response = await ctx.http.post(url, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      ctx.logger.info("Meta Ads ad set created", { name, campaignId });
      return response.data;
    } catch (err) {
      ctx.logger.error("Meta Ads create adset failed", { error: String(err) });
      return { error: `Meta Ads API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Create ad creative
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_meta_ads_create_ad", async ({ params }) => {
    const {
      name, adsetId, creativeId, headline, body: adBody, linkUrl, imageUrl,
      callToAction = "LEARN_MORE", status = "PAUSED",
    } = params as {
      name: string; adsetId: string; creativeId?: string; headline?: string;
      body?: string; linkUrl?: string; imageUrl?: string;
      callToAction?: string; status?: string;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "Meta Ads not configured. Set metaAdsAccessToken and metaAdAccountId in plugin config." };
    }
    try {
      let creative: Record<string, unknown>;

      if (creativeId) {
        creative = { creative_id: creativeId };
      } else {
        // Build inline creative
        creative = {
          creative: JSON.stringify({
            object_story_spec: {
              page_id: await ctx.config.get("metaPageId"),
              link_data: {
                message: adBody ?? "",
                link: linkUrl ?? "",
                name: headline ?? "",
                image_url: imageUrl ?? undefined,
                call_to_action: { type: callToAction.toUpperCase() },
              },
            },
          }),
        };
      }

      const requestBody: Record<string, unknown> = {
        name,
        adset_id: adsetId,
        status: status.toUpperCase(),
        access_token: creds.accessToken,
        ...creative,
      };

      const url = `${BASE_URL}/act_${creds.adAccountId}/ads`;
      const response = await ctx.http.post(url, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      ctx.logger.info("Meta Ads ad created", { name, adsetId });
      return response.data;
    } catch (err) {
      ctx.logger.error("Meta Ads create ad failed", { error: String(err) });
      return { error: `Meta Ads API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Update campaign
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_meta_ads_update_campaign", async ({ params }) => {
    const { campaignId, name, status, dailyBudget, lifetimeBudget, bidStrategy } = params as {
      campaignId: string; name?: string; status?: string;
      dailyBudget?: number; lifetimeBudget?: number; bidStrategy?: string;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "Meta Ads not configured. Set metaAdsAccessToken and metaAdAccountId in plugin config." };
    }
    try {
      const body: Record<string, string> = { access_token: creds.accessToken };
      if (name) body.name = name;
      if (status) body.status = status.toUpperCase();
      if (dailyBudget) body.daily_budget = String(Math.round(dailyBudget * 100));
      if (lifetimeBudget) body.lifetime_budget = String(Math.round(lifetimeBudget * 100));
      if (bidStrategy) body.bid_strategy = bidStrategy.toUpperCase();

      const url = `${BASE_URL}/${campaignId}`;
      const response = await ctx.http.post(url, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      ctx.logger.info("Meta Ads campaign updated", { campaignId });
      return response.data;
    } catch (err) {
      ctx.logger.error("Meta Ads update campaign failed", { error: String(err) });
      return { error: `Meta Ads API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Pause campaign
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_meta_ads_pause_campaign", async ({ params }) => {
    const { campaignId } = params as { campaignId: string };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "Meta Ads not configured. Set metaAdsAccessToken and metaAdAccountId in plugin config." };
    }
    try {
      const url = `${BASE_URL}/${campaignId}`;
      const response = await ctx.http.post(url, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "PAUSED",
          access_token: creds.accessToken,
        }),
      });
      ctx.logger.info("Meta Ads campaign paused", { campaignId });
      return response.data;
    } catch (err) {
      ctx.logger.error("Meta Ads pause campaign failed", { error: String(err) });
      return { error: `Meta Ads API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Get campaign performance insights
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_meta_ads_get_insights", async ({ params }) => {
    const {
      objectId, level = "campaign", dateFrom, dateTo, fields,
      breakdowns, timeIncrement,
    } = params as {
      objectId: string; level?: string; dateFrom: string; dateTo: string;
      fields?: string[]; breakdowns?: string[]; timeIncrement?: string;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "Meta Ads not configured. Set metaAdsAccessToken and metaAdAccountId in plugin config." };
    }
    try {
      const defaultFields = [
        "impressions", "clicks", "spend", "cpc", "cpm", "ctr",
        "actions", "cost_per_action_type", "reach", "frequency",
        "conversions", "conversion_values", "cost_per_conversion",
      ];
      const fieldStr = (fields ?? defaultFields).join(",");
      let url = `${BASE_URL}/${objectId}/insights?fields=${fieldStr}&level=${level}&time_range={"since":"${dateFrom}","until":"${dateTo}"}&access_token=${creds.accessToken}`;

      if (breakdowns?.length) {
        url += `&breakdowns=${breakdowns.join(",")}`;
      }
      if (timeIncrement) {
        url += `&time_increment=${timeIncrement}`;
      }

      const response = await ctx.http.get(url);
      ctx.logger.info("Meta Ads insights fetched", { objectId, level });
      return response.data;
    } catch (err) {
      ctx.logger.error("Meta Ads get insights failed", { error: String(err) });
      return { error: `Meta Ads API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });
}

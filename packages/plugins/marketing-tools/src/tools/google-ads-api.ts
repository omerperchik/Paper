// ---------------------------------------------------------------------------
// Google Ads API v18 — real REST API integration
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";

const BASE_URL = "https://googleads.googleapis.com/v18";

async function getCredentials(ctx: PluginContext) {
  const accessToken = await ctx.secrets.get("googleAdsAccessToken");
  const refreshToken = await ctx.secrets.get("googleAdsRefreshToken");
  const customerId = await ctx.secrets.get("googleAdsCustomerId");
  const developerToken = await ctx.secrets.get("googleAdsDeveloperToken");
  if (!accessToken || !customerId || !developerToken) {
    return null;
  }
  return { accessToken, refreshToken, customerId, developerToken };
}

function headers(creds: { accessToken: string; developerToken: string; customerId: string }) {
  return {
    Authorization: `Bearer ${creds.accessToken}`,
    "developer-token": creds.developerToken,
    "Content-Type": "application/json",
    "login-customer-id": creds.customerId,
  };
}

export function registerGoogleAdsApiTools(ctx: PluginContext) {

  // -----------------------------------------------------------------------
  // List campaigns with metrics
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_google_ads_list_campaigns", async ({ params }) => {
    const { dateFrom, dateTo, status, limit = 100 } = params as {
      dateFrom?: string; dateTo?: string; status?: string; limit?: number;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "Google Ads not configured. Set googleAdsAccessToken, googleAdsCustomerId, and googleAdsDeveloperToken in plugin secrets." };
    }
    try {
      let query = `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
        campaign_budget.amount_micros,
        metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions,
        metrics.conversions_value, metrics.ctr, metrics.average_cpc
        FROM campaign`;
      const conditions: string[] = [];
      if (dateFrom && dateTo) {
        conditions.push(`segments.date BETWEEN '${dateFrom}' AND '${dateTo}'`);
      }
      if (status) {
        conditions.push(`campaign.status = '${status.toUpperCase()}'`);
      }
      if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(" AND ")}`;
      }
      query += ` ORDER BY metrics.cost_micros DESC LIMIT ${limit}`;

      const url = `${BASE_URL}/customers/${creds.customerId}/googleAds:searchStream`;
      const response = await ctx.http.post(url, {
        headers: headers(creds),
        body: JSON.stringify({ query }),
      });
      ctx.logger.info("Google Ads list campaigns completed", { customerId: creds.customerId });
      return response.data;
    } catch (err) {
      ctx.logger.error("Google Ads list campaigns failed", { error: String(err) });
      return { error: `Google Ads API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Create a search or display campaign
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_google_ads_create_campaign", async ({ params }) => {
    const {
      name, channelType = "SEARCH", budgetAmountMicros, biddingStrategy = "MAXIMIZE_CONVERSIONS",
      startDate, endDate, targetCpaMicros,
    } = params as {
      name: string; channelType?: string; budgetAmountMicros: number;
      biddingStrategy?: string; startDate?: string; endDate?: string; targetCpaMicros?: number;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "Google Ads not configured. Set googleAdsAccessToken, googleAdsCustomerId, and googleAdsDeveloperToken in plugin secrets." };
    }
    try {
      // Step 1: Create campaign budget
      const budgetUrl = `${BASE_URL}/customers/${creds.customerId}/campaignBudgets:mutate`;
      const budgetResponse = await ctx.http.post(budgetUrl, {
        headers: headers(creds),
        body: JSON.stringify({
          operations: [{
            create: {
              name: `${name}_budget_${Date.now()}`,
              amountMicros: String(budgetAmountMicros),
              deliveryMethod: "STANDARD",
              explicitlyShared: false,
            },
          }],
        }),
      });
      const budgetResult = budgetResponse.data as { results: Array<{ resourceName: string }> };
      const budgetResourceName = budgetResult.results[0].resourceName;

      // Step 2: Create the campaign
      const campaignUrl = `${BASE_URL}/customers/${creds.customerId}/campaigns:mutate`;
      const campaignOperation: Record<string, unknown> = {
        create: {
          name,
          advertisingChannelType: channelType.toUpperCase(),
          status: "PAUSED",
          campaignBudget: budgetResourceName,
          startDate: startDate ?? undefined,
          endDate: endDate ?? undefined,
        },
      };
      // Set bidding strategy
      const campaign = campaignOperation.create as Record<string, unknown>;
      if (biddingStrategy === "MAXIMIZE_CONVERSIONS") {
        campaign.maximizeConversions = targetCpaMicros ? { targetCpaMicros: String(targetCpaMicros) } : {};
      } else if (biddingStrategy === "MAXIMIZE_CLICKS") {
        campaign.maximizeClicks = {};
      } else if (biddingStrategy === "TARGET_CPA") {
        campaign.targetCpa = { targetCpaMicros: String(targetCpaMicros ?? 0) };
      } else if (biddingStrategy === "TARGET_ROAS") {
        campaign.targetRoas = { targetRoas: 1.0 };
      } else if (biddingStrategy === "MANUAL_CPC") {
        campaign.manualCpc = { enhancedCpcEnabled: true };
      }

      const campaignResponse = await ctx.http.post(campaignUrl, {
        headers: headers(creds),
        body: JSON.stringify({ operations: [campaignOperation] }),
      });
      ctx.logger.info("Google Ads campaign created", { name, channelType });
      return campaignResponse.data;
    } catch (err) {
      ctx.logger.error("Google Ads create campaign failed", { error: String(err) });
      return { error: `Google Ads API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Update campaign (budget, bids, targeting, status)
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_google_ads_update_campaign", async ({ params }) => {
    const { campaignId, name, status, budgetAmountMicros, targetCpaMicros } = params as {
      campaignId: string; name?: string; status?: string; budgetAmountMicros?: number; targetCpaMicros?: number;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "Google Ads not configured. Set googleAdsAccessToken, googleAdsCustomerId, and googleAdsDeveloperToken in plugin secrets." };
    }
    try {
      const updateFields: Record<string, unknown> = {
        resourceName: `customers/${creds.customerId}/campaigns/${campaignId}`,
      };
      const updateMask: string[] = [];
      if (name) { updateFields.name = name; updateMask.push("name"); }
      if (status) { updateFields.status = status.toUpperCase(); updateMask.push("status"); }
      if (targetCpaMicros !== undefined) {
        updateFields.targetCpa = { targetCpaMicros: String(targetCpaMicros) };
        updateMask.push("target_cpa.target_cpa_micros");
      }

      const operations: Array<Record<string, unknown>> = [];

      // Update budget if provided (requires separate mutate)
      if (budgetAmountMicros !== undefined) {
        // First, query for the campaign's budget resource name
        const queryUrl = `${BASE_URL}/customers/${creds.customerId}/googleAds:searchStream`;
        const budgetQueryResp = await ctx.http.post(queryUrl, {
          headers: headers(creds),
          body: JSON.stringify({
            query: `SELECT campaign.campaign_budget FROM campaign WHERE campaign.id = ${campaignId} LIMIT 1`,
          }),
        });
        const budgetData = budgetQueryResp.data as Array<{ results: Array<{ campaign: { campaignBudget: string } }> }>;
        const budgetResource = budgetData?.[0]?.results?.[0]?.campaign?.campaignBudget;

        if (budgetResource) {
          const budgetUrl = `${BASE_URL}/customers/${creds.customerId}/campaignBudgets:mutate`;
          await ctx.http.post(budgetUrl, {
            headers: headers(creds),
            body: JSON.stringify({
              operations: [{
                update: {
                  resourceName: budgetResource,
                  amountMicros: String(budgetAmountMicros),
                },
                updateMask: "amount_micros",
              }],
            }),
          });
        }
      }

      // Update campaign itself if any fields changed
      if (updateMask.length > 0) {
        operations.push({ update: updateFields, updateMask: updateMask.join(",") });
        const campaignUrl = `${BASE_URL}/customers/${creds.customerId}/campaigns:mutate`;
        const response = await ctx.http.post(campaignUrl, {
          headers: headers(creds),
          body: JSON.stringify({ operations }),
        });
        ctx.logger.info("Google Ads campaign updated", { campaignId });
        return response.data;
      }

      ctx.logger.info("Google Ads campaign budget updated", { campaignId });
      return { success: true, campaignId, message: "Campaign updated successfully" };
    } catch (err) {
      ctx.logger.error("Google Ads update campaign failed", { error: String(err) });
      return { error: `Google Ads API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Pause a campaign
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_google_ads_pause_campaign", async ({ params }) => {
    const { campaignId } = params as { campaignId: string };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "Google Ads not configured. Set googleAdsAccessToken, googleAdsCustomerId, and googleAdsDeveloperToken in plugin secrets." };
    }
    try {
      const url = `${BASE_URL}/customers/${creds.customerId}/campaigns:mutate`;
      const response = await ctx.http.post(url, {
        headers: headers(creds),
        body: JSON.stringify({
          operations: [{
            update: {
              resourceName: `customers/${creds.customerId}/campaigns/${campaignId}`,
              status: "PAUSED",
            },
            updateMask: "status",
          }],
        }),
      });
      ctx.logger.info("Google Ads campaign paused", { campaignId });
      return response.data;
    } catch (err) {
      ctx.logger.error("Google Ads pause campaign failed", { error: String(err) });
      return { error: `Google Ads API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Get keyword performance
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_google_ads_get_keywords", async ({ params }) => {
    const { campaignId, adGroupId, dateFrom, dateTo, limit = 100 } = params as {
      campaignId?: string; adGroupId?: string; dateFrom: string; dateTo: string; limit?: number;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "Google Ads not configured. Set googleAdsAccessToken, googleAdsCustomerId, and googleAdsDeveloperToken in plugin secrets." };
    }
    try {
      let query = `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
        ad_group_criterion.status, ad_group_criterion.quality_info.quality_score,
        metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions,
        metrics.ctr, metrics.average_cpc, metrics.search_impression_share
        FROM keyword_view
        WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'`;
      if (campaignId) {
        query += ` AND campaign.id = ${campaignId}`;
      }
      if (adGroupId) {
        query += ` AND ad_group.id = ${adGroupId}`;
      }
      query += ` ORDER BY metrics.impressions DESC LIMIT ${limit}`;

      const url = `${BASE_URL}/customers/${creds.customerId}/googleAds:searchStream`;
      const response = await ctx.http.post(url, {
        headers: headers(creds),
        body: JSON.stringify({ query }),
      });
      ctx.logger.info("Google Ads keywords fetched", { campaignId });
      return response.data;
    } catch (err) {
      ctx.logger.error("Google Ads get keywords failed", { error: String(err) });
      return { error: `Google Ads API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Add keywords to an ad group
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_google_ads_add_keywords", async ({ params }) => {
    const { adGroupId, keywords } = params as {
      adGroupId: string;
      keywords: Array<{ text: string; matchType?: string; cpcBidMicros?: number }>;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "Google Ads not configured. Set googleAdsAccessToken, googleAdsCustomerId, and googleAdsDeveloperToken in plugin secrets." };
    }
    try {
      const operations = keywords.map((kw) => ({
        create: {
          adGroup: `customers/${creds.customerId}/adGroups/${adGroupId}`,
          status: "ENABLED",
          keyword: {
            text: kw.text,
            matchType: (kw.matchType ?? "BROAD").toUpperCase(),
          },
          cpcBidMicros: kw.cpcBidMicros ? String(kw.cpcBidMicros) : undefined,
        },
      }));

      const url = `${BASE_URL}/customers/${creds.customerId}/adGroupCriteria:mutate`;
      const response = await ctx.http.post(url, {
        headers: headers(creds),
        body: JSON.stringify({ operations }),
      });
      ctx.logger.info("Google Ads keywords added", { adGroupId, count: keywords.length });
      return response.data;
    } catch (err) {
      ctx.logger.error("Google Ads add keywords failed", { error: String(err) });
      return { error: `Google Ads API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });
}

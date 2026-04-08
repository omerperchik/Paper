// ---------------------------------------------------------------------------
// Channel integration tools: Google Ads, Meta Ads, GSC, Social, Email, Reddit
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";

export function registerChannelTools(ctx: PluginContext) {

  ctx.tools.register("marketing_google_ads_report", async ({ params }) => {
    const { dateFrom, dateTo, campaignIds, metrics } = params as {
      dateFrom: string; dateTo: string; campaignIds?: string[]; metrics?: string[];
    };
    const apiKey = await ctx.secrets.get("googleAdsApiKeyRef");
    if (!apiKey) {
      return { error: "Google Ads API key not configured. Set googleAdsApiKeyRef in plugin config." };
    }
    // Google Ads API v17 reports endpoint
    try {
      const query = buildGoogleAdsQuery(dateFrom, dateTo, campaignIds, metrics);
      const response = await ctx.http.post("https://googleads.googleapis.com/v17/customers:searchStream", {
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      return response.data;
    } catch (err) {
      return { error: `Google Ads API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  ctx.tools.register("marketing_meta_ads_report", async ({ params }) => {
    const { dateFrom, dateTo, campaignIds, metrics } = params as {
      dateFrom: string; dateTo: string; campaignIds?: string[]; metrics?: string[];
    };
    const apiKey = await ctx.secrets.get("metaAdsApiKeyRef");
    const adAccountId = await ctx.config.get("metaAdAccountId");
    if (!apiKey || !adAccountId) {
      return { error: "Meta Ads not configured. Set metaAdsApiKeyRef and metaAdAccountId in plugin config." };
    }
    try {
      const fields = (metrics ?? ["impressions", "clicks", "spend", "actions"]).join(",");
      const url = `https://graph.facebook.com/v20.0/act_${adAccountId}/insights?fields=${fields}&time_range={"since":"${dateFrom}","until":"${dateTo}"}&access_token=${apiKey}`;
      const response = await ctx.http.get(url);
      return response.data;
    } catch (err) {
      return { error: `Meta Ads API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  ctx.tools.register("marketing_gsc_report", async ({ params }) => {
    const { dateFrom, dateTo, dimensions, rowLimit = 100 } = params as {
      dateFrom: string; dateTo: string; dimensions?: string[]; rowLimit?: number;
    };
    const apiKey = await ctx.secrets.get("gscApiKeyRef");
    const siteUrl = await ctx.config.get("gscSiteUrl");
    if (!apiKey || !siteUrl) {
      return { error: "GSC not configured. Set gscApiKeyRef and gscSiteUrl in plugin config." };
    }
    try {
      const encodedSite = encodeURIComponent(siteUrl as string);
      const url = `https://www.googleapis.com/webmasters/v3/sites/${encodedSite}/searchAnalytics/query`;
      const response = await ctx.http.post(url, {
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: dateFrom,
          endDate: dateTo,
          dimensions: dimensions ?? ["query", "page"],
          rowLimit,
        }),
      });
      return response.data;
    } catch (err) {
      return { error: `GSC API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  ctx.tools.register("marketing_social_metrics", async ({ params }) => {
    const { platforms, dateFrom, dateTo, metrics } = params as {
      platforms: string[]; dateFrom: string; dateTo: string; metrics?: string[];
    };
    const apiKey = await ctx.secrets.get("socialMediaApiKeyRef");
    if (!apiKey) {
      return {
        error: "Social media API not configured.",
        hint: "Connect individual platform APIs or use a social media aggregator. Set socialMediaApiKeyRef in plugin config.",
      };
    }
    return { platforms, dateFrom, dateTo, metrics: metrics ?? ["impressions", "engagement", "followers"], data: [] };
  });

  ctx.tools.register("marketing_email_metrics", async ({ params }) => {
    const { campaignId, dateFrom, dateTo, provider } = params as {
      campaignId?: string; dateFrom: string; dateTo: string; provider?: string;
    };
    const selectedProvider = provider ?? "brevo";
    const apiKey = await ctx.secrets.get(selectedProvider === "brevo" ? "brevoApiKeyRef" : "resendApiKeyRef");
    if (!apiKey) {
      return { error: `${selectedProvider} API key not configured. Set ${selectedProvider}ApiKeyRef in plugin config.` };
    }
    try {
      if (selectedProvider === "brevo") {
        const url = campaignId
          ? `https://api.brevo.com/v3/emailCampaigns/${campaignId}`
          : `https://api.brevo.com/v3/emailCampaigns?startDate=${dateFrom}&endDate=${dateTo}`;
        const response = await ctx.http.get(url, {
          headers: { "api-key": apiKey as string },
        });
        return response.data;
      }
      // Resend
      const url = `https://api.resend.com/emails`;
      const response = await ctx.http.get(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return response.data;
    } catch (err) {
      return { error: `Email API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  ctx.tools.register("marketing_reddit_monitor", async ({ params }) => {
    const { subreddits, keywords, limit = 25, sort = "new" } = params as {
      subreddits?: string[]; keywords: string[]; limit?: number; sort?: string;
    };
    const clientId = await ctx.secrets.get("redditClientIdRef");
    const clientSecret = await ctx.secrets.get("redditClientSecretRef");

    if (!clientId || !clientSecret) {
      return {
        error: "Reddit API not configured.",
        hint: "Set redditClientIdRef and redditClientSecretRef. Alternatively, use marketing_scrape_serp with site:reddit.com as a fallback.",
      };
    }

    try {
      // Get OAuth token
      const tokenResponse = await ctx.http.post("https://www.reddit.com/api/v1/access_token", {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        },
        body: "grant_type=client_credentials",
      });
      const token = (tokenResponse.data as Record<string, unknown>).access_token;

      const results: unknown[] = [];
      const searchQuery = keywords.join(" OR ");
      const subredditScope = subreddits?.length ? subreddits.join("+") : "all";
      const url = `https://oauth.reddit.com/r/${subredditScope}/search?q=${encodeURIComponent(searchQuery)}&sort=${sort}&limit=${limit}&restrict_sr=true`;

      const response = await ctx.http.get(url, {
        headers: { Authorization: `Bearer ${token}`, "User-Agent": "PaperMarketingBot/1.0" },
      });
      results.push(response.data);

      return { query: searchQuery, subreddits: subredditScope, results, resultCount: limit };
    } catch (err) {
      return { error: `Reddit API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });
}

function buildGoogleAdsQuery(
  dateFrom: string,
  dateTo: string,
  campaignIds?: string[],
  metrics?: string[],
): string {
  const fields = metrics ?? ["impressions", "clicks", "cost_micros", "conversions"];
  const metricsStr = fields.map((m) => `metrics.${m}`).join(", ");
  let query = `SELECT campaign.name, campaign.id, ${metricsStr} FROM campaign WHERE segments.date BETWEEN '${dateFrom}' AND '${dateTo}'`;
  if (campaignIds?.length) {
    query += ` AND campaign.id IN (${campaignIds.join(", ")})`;
  }
  return query;
}

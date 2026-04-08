// ---------------------------------------------------------------------------
// Google Analytics 4 Data API — real REST API integration
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";

const BASE_URL = "https://analyticsdata.googleapis.com/v1beta";

async function getCredentials(ctx: PluginContext) {
  const accessToken = await ctx.secrets.get("ga4AccessToken");
  const propertyId = await ctx.config.get("ga4PropertyId") as string | null;
  if (!accessToken || !propertyId) {
    return null;
  }
  return { accessToken, propertyId };
}

function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

export function registerGoogleAnalyticsApiTools(ctx: PluginContext) {

  // -----------------------------------------------------------------------
  // Run a custom GA4 report
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_ga4_run_report", async ({ params }) => {
    const { dateFrom, dateTo, dimensions, metrics, dimensionFilter, metricFilter, orderBys, limit = 1000 } = params as {
      dateFrom: string; dateTo: string;
      dimensions: string[]; metrics: string[];
      dimensionFilter?: Record<string, unknown>;
      metricFilter?: Record<string, unknown>;
      orderBys?: Array<Record<string, unknown>>;
      limit?: number;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "GA4 not configured. Set ga4AccessToken and ga4PropertyId in plugin config." };
    }
    try {
      const url = `${BASE_URL}/properties/${creds.propertyId}:runReport`;
      const body: Record<string, unknown> = {
        dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
        dimensions: dimensions.map((d) => ({ name: d })),
        metrics: metrics.map((m) => ({ name: m })),
        limit,
      };
      if (dimensionFilter) body.dimensionFilter = dimensionFilter;
      if (metricFilter) body.metricFilter = metricFilter;
      if (orderBys) body.orderBys = orderBys;

      const response = await ctx.http.post(url, {
        headers: authHeaders(creds.accessToken),
        body: JSON.stringify(body),
      });
      ctx.logger.info("GA4 report completed", { propertyId: creds.propertyId });
      return response.data;
    } catch (err) {
      ctx.logger.error("GA4 run report failed", { error: String(err) });
      return { error: `GA4 API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Get traffic by source/medium
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_ga4_get_traffic", async ({ params }) => {
    const { dateFrom, dateTo, limit = 100 } = params as {
      dateFrom: string; dateTo: string; limit?: number;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "GA4 not configured. Set ga4AccessToken and ga4PropertyId in plugin config." };
    }
    try {
      const url = `${BASE_URL}/properties/${creds.propertyId}:runReport`;
      const response = await ctx.http.post(url, {
        headers: authHeaders(creds.accessToken),
        body: JSON.stringify({
          dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
          dimensions: [
            { name: "sessionSource" },
            { name: "sessionMedium" },
            { name: "sessionCampaignName" },
          ],
          metrics: [
            { name: "sessions" },
            { name: "totalUsers" },
            { name: "newUsers" },
            { name: "bounceRate" },
            { name: "averageSessionDuration" },
            { name: "screenPageViewsPerSession" },
            { name: "conversions" },
          ],
          orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
          limit,
        }),
      });
      ctx.logger.info("GA4 traffic report completed", { propertyId: creds.propertyId });
      return response.data;
    } catch (err) {
      ctx.logger.error("GA4 get traffic failed", { error: String(err) });
      return { error: `GA4 API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Get conversion events
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_ga4_get_conversions", async ({ params }) => {
    const { dateFrom, dateTo, eventNames, limit = 100 } = params as {
      dateFrom: string; dateTo: string; eventNames?: string[]; limit?: number;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "GA4 not configured. Set ga4AccessToken and ga4PropertyId in plugin config." };
    }
    try {
      const url = `${BASE_URL}/properties/${creds.propertyId}:runReport`;
      const body: Record<string, unknown> = {
        dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
        dimensions: [
          { name: "eventName" },
          { name: "sessionSource" },
          { name: "sessionMedium" },
        ],
        metrics: [
          { name: "eventCount" },
          { name: "eventValue" },
          { name: "totalUsers" },
        ],
        orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
        limit,
      };
      if (eventNames?.length) {
        body.dimensionFilter = {
          filter: {
            fieldName: "eventName",
            inListFilter: { values: eventNames },
          },
        };
      }

      const response = await ctx.http.post(url, {
        headers: authHeaders(creds.accessToken),
        body: JSON.stringify(body),
      });
      ctx.logger.info("GA4 conversions report completed", { propertyId: creds.propertyId });
      return response.data;
    } catch (err) {
      ctx.logger.error("GA4 get conversions failed", { error: String(err) });
      return { error: `GA4 API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Get user demographics
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_ga4_get_user_demographics", async ({ params }) => {
    const { dateFrom, dateTo, limit = 100 } = params as {
      dateFrom: string; dateTo: string; limit?: number;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "GA4 not configured. Set ga4AccessToken and ga4PropertyId in plugin config." };
    }
    try {
      const url = `${BASE_URL}/properties/${creds.propertyId}:runReport`;
      const response = await ctx.http.post(url, {
        headers: authHeaders(creds.accessToken),
        body: JSON.stringify({
          dateRanges: [{ startDate: dateFrom, endDate: dateTo }],
          dimensions: [
            { name: "country" },
            { name: "city" },
            { name: "userAgeBracket" },
            { name: "userGender" },
            { name: "language" },
            { name: "deviceCategory" },
          ],
          metrics: [
            { name: "totalUsers" },
            { name: "sessions" },
            { name: "conversions" },
            { name: "engagedSessions" },
          ],
          orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
          limit,
        }),
      });
      ctx.logger.info("GA4 demographics report completed", { propertyId: creds.propertyId });
      return response.data;
    } catch (err) {
      ctx.logger.error("GA4 get demographics failed", { error: String(err) });
      return { error: `GA4 API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Get realtime active users
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_ga4_get_realtime", async ({ params }) => {
    const { dimensions, metrics, limit = 100 } = params as {
      dimensions?: string[]; metrics?: string[]; limit?: number;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "GA4 not configured. Set ga4AccessToken and ga4PropertyId in plugin config." };
    }
    try {
      const url = `${BASE_URL}/properties/${creds.propertyId}:runRealtimeReport`;
      const defaultDimensions = ["unifiedScreenName", "country", "deviceCategory"];
      const defaultMetrics = ["activeUsers", "screenPageViews", "conversions", "eventCount"];

      const response = await ctx.http.post(url, {
        headers: authHeaders(creds.accessToken),
        body: JSON.stringify({
          dimensions: (dimensions ?? defaultDimensions).map((d) => ({ name: d })),
          metrics: (metrics ?? defaultMetrics).map((m) => ({ name: m })),
          limit,
        }),
      });
      ctx.logger.info("GA4 realtime report completed", { propertyId: creds.propertyId });
      return response.data;
    } catch (err) {
      ctx.logger.error("GA4 get realtime failed", { error: String(err) });
      return { error: `GA4 API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });
}

// ---------------------------------------------------------------------------
// Google Search Console API — real REST API integration
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";

const BASE_URL = "https://searchconsole.googleapis.com/v1";

async function getCredentials(ctx: PluginContext) {
  const accessToken = await ctx.secrets.get("gscAccessToken");
  const siteUrl = await ctx.config.get("gscSiteUrl") as string | null;
  if (!accessToken || !siteUrl) {
    return null;
  }
  return { accessToken, siteUrl };
}

function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

export function registerGscApiTools(ctx: PluginContext) {

  // -----------------------------------------------------------------------
  // Get search performance (queries, clicks, impressions, position)
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_gsc_get_performance", async ({ params }) => {
    const {
      dateFrom, dateTo, dimensions, rowLimit = 1000, startRow = 0,
      dimensionFilterGroups, type = "web", dataState = "all",
      aggregationType = "auto",
    } = params as {
      dateFrom: string; dateTo: string; dimensions?: string[];
      rowLimit?: number; startRow?: number;
      dimensionFilterGroups?: Array<Record<string, unknown>>;
      type?: string; dataState?: string; aggregationType?: string;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "GSC not configured. Set gscAccessToken and gscSiteUrl in plugin config." };
    }
    try {
      const encodedSite = encodeURIComponent(creds.siteUrl);
      const url = `${BASE_URL}/sites/${encodedSite}/searchAnalytics/query`;

      const body: Record<string, unknown> = {
        startDate: dateFrom,
        endDate: dateTo,
        dimensions: dimensions ?? ["query", "page"],
        rowLimit,
        startRow,
        type,
        dataState,
        aggregationType,
      };
      if (dimensionFilterGroups) {
        body.dimensionFilterGroups = dimensionFilterGroups;
      }

      const response = await ctx.http.post(url, {
        headers: authHeaders(creds.accessToken),
        body: JSON.stringify(body),
      });

      const data = response.data as {
        rows?: Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }>;
        responseAggregationType?: string;
      };

      // Enrich with summary stats
      const rows = data.rows ?? [];
      const totalClicks = rows.reduce((s, r) => s + r.clicks, 0);
      const totalImpressions = rows.reduce((s, r) => s + r.impressions, 0);
      const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
      const avgPosition = rows.length > 0
        ? rows.reduce((s, r) => s + r.position, 0) / rows.length
        : 0;

      ctx.logger.info("GSC performance fetched", { rowCount: rows.length });
      return {
        rows,
        summary: {
          totalClicks,
          totalImpressions,
          avgCtr: Math.round(avgCtr * 10000) / 100,
          avgPosition: Math.round(avgPosition * 100) / 100,
          rowCount: rows.length,
        },
        dateRange: { from: dateFrom, to: dateTo },
      };
    } catch (err) {
      ctx.logger.error("GSC get performance failed", { error: String(err) });
      return { error: `GSC API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Get sitemap status
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_gsc_get_sitemaps", async ({ params }) => {
    const { sitemapUrl } = params as { sitemapUrl?: string };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "GSC not configured. Set gscAccessToken and gscSiteUrl in plugin config." };
    }
    try {
      const encodedSite = encodeURIComponent(creds.siteUrl);
      let url: string;
      if (sitemapUrl) {
        const encodedSitemap = encodeURIComponent(sitemapUrl);
        url = `${BASE_URL}/sites/${encodedSite}/sitemaps/${encodedSitemap}`;
      } else {
        url = `${BASE_URL}/sites/${encodedSite}/sitemaps`;
      }

      const response = await ctx.http.get(url, {
        headers: authHeaders(creds.accessToken),
      });
      ctx.logger.info("GSC sitemaps fetched");
      return response.data;
    } catch (err) {
      ctx.logger.error("GSC get sitemaps failed", { error: String(err) });
      return { error: `GSC API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Inspect URL indexing status
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_gsc_inspect_url", async ({ params }) => {
    const { inspectionUrl, languageCode = "en" } = params as {
      inspectionUrl: string; languageCode?: string;
    };
    const creds = await getCredentials(ctx);
    if (!creds) {
      return { error: "GSC not configured. Set gscAccessToken and gscSiteUrl in plugin config." };
    }
    try {
      const url = `${BASE_URL}/urlInspection/index:inspect`;
      const response = await ctx.http.post(url, {
        headers: authHeaders(creds.accessToken),
        body: JSON.stringify({
          inspectionUrl,
          siteUrl: creds.siteUrl,
          languageCode,
        }),
      });
      ctx.logger.info("GSC URL inspected", { inspectionUrl });
      return response.data;
    } catch (err) {
      ctx.logger.error("GSC inspect URL failed", { error: String(err) });
      return { error: `GSC API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });
}

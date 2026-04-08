import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { notFound } from "../errors.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DateRange {
  from: Date;
  to: Date;
}

export interface MarketingKpis {
  cac: number;
  ltv: number;
  roas: number;
  mqls: number;
  traffic: number;
  conversionRate: number;
  ltvCacRatio: number;
}

export interface FunnelStage {
  stage: string;
  value: number;
  conversionRate: number | null;
}

export interface CampaignRow {
  id: string;
  companyId: string;
  productId: string | null;
  name: string;
  platform: string;
  status: string;
  budgetCents: number;
  spentCents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  cpc: number;
  cpm: number;
  roas: number;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetStatus {
  totalBudgetCents: number;
  spentCents: number;
  remainingCents: number;
  burnRatePerDay: number;
  projectedOvershootCents: number;
  campaignCount: number;
}

export interface ChannelMetrics {
  channel: string;
  impressions: number;
  clicks: number;
  conversions: number;
  spentCents: number;
  cpc: number;
  cpm: number;
  roas: number;
}

export interface ContentPipelineItem {
  stage: string;
  count: number;
  items: { id: string; title: string; type: string; updatedAt: string }[];
}

export interface AgentActivityItem {
  id: string;
  agentId: string;
  agentName: string | null;
  action: string;
  description: string;
  createdAt: string;
}

export interface ProductRow {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function marketingDashboardService(db: Db) {

  // ------------------------------------------------------------------
  // Helper: safely query a table that may not exist yet, returning
  // a fallback value instead of throwing.
  // ------------------------------------------------------------------
  async function safeQuery<T>(queryFn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await queryFn();
    } catch (err: any) {
      // Table doesn't exist yet – return fallback data
      if (
        err?.message?.includes("does not exist") ||
        err?.message?.includes("no such table") ||
        err?.code === "42P01" // PostgreSQL: undefined_table
      ) {
        return fallback;
      }
      throw err;
    }
  }

  // ------------------------------------------------------------------
  // KPIs
  // ------------------------------------------------------------------

  async function getKpis(
    companyId: string,
    productId?: string,
    dateRange?: DateRange,
  ): Promise<MarketingKpis> {
    return safeQuery(async () => {
      const productFilter = productId
        ? sql` AND product_id = ${productId}`
        : sql``;
      const dateFilter = dateRange
        ? sql` AND created_at >= ${dateRange.from.toISOString()} AND created_at <= ${dateRange.to.toISOString()}`
        : sql``;

      const rows = await db.execute(sql`
        SELECT
          COALESCE(SUM(spent_cents), 0)   AS total_spent,
          COALESCE(SUM(impressions), 0)    AS total_impressions,
          COALESCE(SUM(clicks), 0)         AS total_clicks,
          COALESCE(SUM(conversions), 0)    AS total_conversions
        FROM marketing_campaigns
        WHERE company_id = ${companyId}
        ${productFilter}
        ${dateFilter}
      `);

      const r = rows[0] ?? {};
      const totalSpent = Number(r.total_spent ?? 0);
      const totalClicks = Number(r.total_clicks ?? 0);
      const totalConversions = Number(r.total_conversions ?? 0);
      const totalImpressions = Number(r.total_impressions ?? 0);

      const cac = totalConversions > 0 ? totalSpent / totalConversions : 0;
      const ltv = 0; // Requires revenue data – placeholder
      const roas = totalSpent > 0 ? (totalConversions * ltv) / totalSpent : 0;
      const conversionRate = totalClicks > 0 ? totalConversions / totalClicks : 0;

      return {
        cac,
        ltv,
        roas,
        mqls: totalConversions,
        traffic: totalImpressions,
        conversionRate,
        ltvCacRatio: cac > 0 ? ltv / cac : 0,
      };
    }, {
      cac: 0,
      ltv: 0,
      roas: 0,
      mqls: 0,
      traffic: 0,
      conversionRate: 0,
      ltvCacRatio: 0,
    });
  }

  // ------------------------------------------------------------------
  // Funnel
  // ------------------------------------------------------------------

  async function getFunnelData(
    companyId: string,
    productId?: string,
  ): Promise<FunnelStage[]> {
    return safeQuery(async () => {
      const productFilter = productId
        ? sql` AND product_id = ${productId}`
        : sql``;

      const rows = await db.execute(sql`
        SELECT
          COALESCE(SUM(impressions), 0) AS impressions,
          COALESCE(SUM(clicks), 0)      AS clicks,
          COALESCE(SUM(conversions), 0) AS conversions
        FROM marketing_campaigns
        WHERE company_id = ${companyId}
        ${productFilter}
      `);

      const r = rows[0] ?? {};
      const impressions = Number(r.impressions ?? 0);
      const clicks = Number(r.clicks ?? 0);
      const conversions = Number(r.conversions ?? 0);
      const leads = Math.round(conversions * 1.5); // rough estimate
      const customers = conversions;

      return [
        { stage: "Impressions", value: impressions, conversionRate: null },
        {
          stage: "Clicks",
          value: clicks,
          conversionRate: impressions > 0 ? clicks / impressions : 0,
        },
        {
          stage: "Leads",
          value: leads,
          conversionRate: clicks > 0 ? leads / clicks : 0,
        },
        {
          stage: "Customers",
          value: customers,
          conversionRate: leads > 0 ? customers / leads : 0,
        },
      ];
    }, [
      { stage: "Impressions", value: 0, conversionRate: null },
      { stage: "Clicks", value: 0, conversionRate: 0 },
      { stage: "Leads", value: 0, conversionRate: 0 },
      { stage: "Customers", value: 0, conversionRate: 0 },
    ]);
  }

  // ------------------------------------------------------------------
  // Campaigns
  // ------------------------------------------------------------------

  async function getCampaigns(
    companyId: string,
    productId?: string,
    status?: string,
  ): Promise<CampaignRow[]> {
    return safeQuery(async () => {
      const productFilter = productId
        ? sql` AND product_id = ${productId}`
        : sql``;
      const statusFilter = status
        ? sql` AND status = ${status}`
        : sql``;

      const rows = await db.execute(sql`
        SELECT * FROM marketing_campaigns
        WHERE company_id = ${companyId}
        ${productFilter}
        ${statusFilter}
        ORDER BY created_at DESC
      `);

      return rows.map(mapCampaignRow);
    }, []);
  }

  // ------------------------------------------------------------------
  // Budget
  // ------------------------------------------------------------------

  async function getBudgetStatus(companyId: string): Promise<BudgetStatus> {
    return safeQuery(async () => {
      const rows = await db.execute(sql`
        SELECT
          COALESCE(SUM(budget_cents), 0) AS total_budget,
          COALESCE(SUM(spent_cents), 0)  AS total_spent,
          COUNT(*)                        AS campaign_count
        FROM marketing_campaigns
        WHERE company_id = ${companyId}
      `);

      const r = rows[0] ?? {};
      const totalBudget = Number(r.total_budget ?? 0);
      const totalSpent = Number(r.total_spent ?? 0);
      const campaignCount = Number(r.campaign_count ?? 0);
      const remaining = totalBudget - totalSpent;

      // Rough burn rate: spent / days since earliest campaign
      const dateRows = await db.execute(sql`
        SELECT MIN(created_at) AS earliest FROM marketing_campaigns
        WHERE company_id = ${companyId}
      `);
      const earliest = dateRows[0]?.earliest
        ? new Date(dateRows[0].earliest as string)
        : new Date();
      const daysSinceStart = Math.max(
        1,
        (Date.now() - earliest.getTime()) / (1000 * 60 * 60 * 24),
      );
      const burnRatePerDay = totalSpent / daysSinceStart;

      const daysRemaining = remaining > 0 && burnRatePerDay > 0
        ? remaining / burnRatePerDay
        : 0;
      const projectedOvershoot =
        burnRatePerDay > 0 ? Math.max(0, (burnRatePerDay * 30) - totalBudget) : 0;

      return {
        totalBudgetCents: totalBudget,
        spentCents: totalSpent,
        remainingCents: remaining,
        burnRatePerDay: Math.round(burnRatePerDay),
        projectedOvershootCents: Math.round(projectedOvershoot),
        campaignCount,
      };
    }, {
      totalBudgetCents: 0,
      spentCents: 0,
      remainingCents: 0,
      burnRatePerDay: 0,
      projectedOvershootCents: 0,
      campaignCount: 0,
    });
  }

  // ------------------------------------------------------------------
  // Channel performance
  // ------------------------------------------------------------------

  async function getChannelPerformance(companyId: string): Promise<ChannelMetrics[]> {
    return safeQuery(async () => {
      const rows = await db.execute(sql`
        SELECT
          platform AS channel,
          COALESCE(SUM(impressions), 0)  AS impressions,
          COALESCE(SUM(clicks), 0)       AS clicks,
          COALESCE(SUM(conversions), 0)  AS conversions,
          COALESCE(SUM(spent_cents), 0)  AS spent_cents
        FROM marketing_campaigns
        WHERE company_id = ${companyId}
        GROUP BY platform
        ORDER BY spent_cents DESC
      `);

      return rows.map((r: any) => {
        const impressions = Number(r.impressions ?? 0);
        const clicks = Number(r.clicks ?? 0);
        const conversions = Number(r.conversions ?? 0);
        const spentCents = Number(r.spent_cents ?? 0);
        return {
          channel: r.channel as string,
          impressions,
          clicks,
          conversions,
          spentCents,
          cpc: clicks > 0 ? spentCents / clicks : 0,
          cpm: impressions > 0 ? (spentCents / impressions) * 1000 : 0,
          roas: 0, // Requires revenue tracking
        };
      });
    }, []);
  }

  // ------------------------------------------------------------------
  // Content pipeline
  // ------------------------------------------------------------------

  async function getContentPipeline(companyId: string): Promise<ContentPipelineItem[]> {
    return safeQuery(async () => {
      const stages = ["idea", "draft", "review", "approved", "published"];
      const result: ContentPipelineItem[] = [];

      for (const stage of stages) {
        const rows = await db.execute(sql`
          SELECT id, title, type, updated_at
          FROM marketing_content_items
          WHERE company_id = ${companyId} AND status = ${stage}
          ORDER BY updated_at DESC
          LIMIT 20
        `);

        result.push({
          stage,
          count: rows.length,
          items: rows.map((r: any) => ({
            id: r.id as string,
            title: r.title as string,
            type: r.type as string,
            updatedAt: r.updated_at as string,
          })),
        });
      }

      return result;
    }, [
      { stage: "idea", count: 0, items: [] },
      { stage: "draft", count: 0, items: [] },
      { stage: "review", count: 0, items: [] },
      { stage: "approved", count: 0, items: [] },
      { stage: "published", count: 0, items: [] },
    ]);
  }

  // ------------------------------------------------------------------
  // Agent activity
  // ------------------------------------------------------------------

  async function getAgentActivity(
    companyId: string,
    limit = 20,
  ): Promise<AgentActivityItem[]> {
    return safeQuery(async () => {
      const rows = await db.execute(sql`
        SELECT
          a.id,
          a.agent_id,
          ag.name AS agent_name,
          a.action,
          a.description,
          a.created_at
        FROM marketing_agent_activity a
        LEFT JOIN agents ag ON ag.id = a.agent_id
        WHERE a.company_id = ${companyId}
        ORDER BY a.created_at DESC
        LIMIT ${limit}
      `);

      return rows.map((r: any) => ({
        id: r.id as string,
        agentId: r.agent_id as string,
        agentName: (r.agent_name as string) ?? null,
        action: r.action as string,
        description: r.description as string,
        createdAt: r.created_at as string,
      }));
    }, []);
  }

  // ------------------------------------------------------------------
  // Dashboard snapshot (save pre-computed data for fast retrieval)
  // ------------------------------------------------------------------

  async function saveDashboardSnapshot(
    companyId: string,
    snapshotType: string,
    data: unknown,
  ): Promise<{ id: string }> {
    const id = randomUUID();
    const now = new Date().toISOString();

    await safeQuery(async () => {
      await db.execute(sql`
        INSERT INTO marketing_dashboard_snapshots (
          id, company_id, snapshot_type, data, created_at
        ) VALUES (
          ${id}, ${companyId}, ${snapshotType},
          ${JSON.stringify(data)}::jsonb, ${now}
        )
      `);
    }, undefined);

    return { id };
  }

  // ------------------------------------------------------------------
  // Products (multi-product support)
  // ------------------------------------------------------------------

  async function listProducts(companyId: string): Promise<ProductRow[]> {
    return safeQuery(async () => {
      const rows = await db.execute(sql`
        SELECT * FROM marketing_products
        WHERE company_id = ${companyId}
        ORDER BY created_at DESC
      `);
      return rows.map(mapProductRow);
    }, []);
  }

  async function createProduct(
    companyId: string,
    name: string,
    description?: string,
  ): Promise<ProductRow> {
    const id = randomUUID();
    const now = new Date().toISOString();

    await db.execute(sql`
      INSERT INTO marketing_products (
        id, company_id, name, description, status, created_at, updated_at
      ) VALUES (
        ${id}, ${companyId}, ${name}, ${description ?? null},
        'active', ${now}, ${now}
      )
    `);

    const rows = await db.execute(sql`
      SELECT * FROM marketing_products WHERE id = ${id} LIMIT 1
    `);

    return mapProductRow(rows[0]);
  }

  // ------------------------------------------------------------------
  // Full dashboard (all widgets in one call)
  // ------------------------------------------------------------------

  async function getFullDashboard(companyId: string) {
    const [kpis, funnel, campaigns, budget, channels, content, agentActivity] =
      await Promise.all([
        getKpis(companyId),
        getFunnelData(companyId),
        getCampaigns(companyId),
        getBudgetStatus(companyId),
        getChannelPerformance(companyId),
        getContentPipeline(companyId),
        getAgentActivity(companyId),
      ]);

    return {
      kpis,
      funnel,
      campaigns,
      budget,
      channels,
      content,
      agentActivity,
    };
  }

  // ------------------------------------------------------------------
  // Public surface
  // ------------------------------------------------------------------

  return {
    getKpis,
    getFunnelData,
    getCampaigns,
    getBudgetStatus,
    getChannelPerformance,
    getContentPipeline,
    getAgentActivity,
    saveDashboardSnapshot,
    listProducts,
    createProduct,
    getFullDashboard,
  };
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function mapCampaignRow(row: any): CampaignRow {
  const impressions = Number(row.impressions ?? 0);
  const clicks = Number(row.clicks ?? 0);
  const conversions = Number(row.conversions ?? 0);
  const spentCents = Number(row.spent_cents ?? 0);

  return {
    id: row.id as string,
    companyId: row.company_id as string,
    productId: (row.product_id as string) ?? null,
    name: row.name as string,
    platform: row.platform as string,
    status: row.status as string,
    budgetCents: Number(row.budget_cents ?? 0),
    spentCents,
    impressions,
    clicks,
    conversions,
    cpc: clicks > 0 ? spentCents / clicks : 0,
    cpm: impressions > 0 ? (spentCents / impressions) * 1000 : 0,
    roas: 0,
    startDate: (row.start_date as string) ?? null,
    endDate: (row.end_date as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapProductRow(row: any): ProductRow {
  return {
    id: row.id as string,
    companyId: row.company_id as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    status: row.status as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

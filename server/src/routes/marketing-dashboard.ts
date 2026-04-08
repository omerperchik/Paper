import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { marketingDashboardService } from "../services/marketing-dashboard.js";
import { assertCompanyAccess } from "./authz.js";
import { badRequest } from "../errors.js";

// ---------------------------------------------------------------------------
// Transform helpers — map raw service data to UI-expected shapes
// ---------------------------------------------------------------------------

function makeKpiObj(label: string, value: number, opts?: { prefix?: string; suffix?: string; decimals?: number }) {
  const { prefix = "", suffix = "", decimals = 1 } = opts ?? {};
  return {
    label,
    value,
    formatted: `${prefix}${value.toLocaleString(undefined, { maximumFractionDigits: decimals })}${suffix}`,
    trend: 0,
    trendDirection: "flat" as const,
    sparkline: [value, value, value, value, value, value, value],
  };
}

function transformKpis(raw: any) {
  return {
    blendedCac: makeKpiObj("Blended CAC", (raw.cac ?? 0) / 100, { prefix: "$", decimals: 0 }),
    ltvCacRatio: makeKpiObj("LTV / CAC", raw.ltvCacRatio ?? 0, { suffix: "x" }),
    monthlyRevenue: makeKpiObj("MQLs", raw.mqls ?? 0, { decimals: 0 }),
    totalSpend: makeKpiObj("Total Spend", (raw.cac ?? 0) > 0 ? (raw.mqls ?? 0) * ((raw.cac ?? 0) / 100) : 0, { prefix: "$", decimals: 0 }),
    activeCampaigns: makeKpiObj("Traffic", raw.traffic ?? 0, { decimals: 0 }),
    conversionRate: makeKpiObj("Conv. Rate", (raw.conversionRate ?? 0) * 100, { suffix: "%", decimals: 2 }),
  };
}

function transformFunnel(raw: any[]) {
  return {
    stages: raw.map((s: any) => ({
      name: s.stage ?? s.name ?? "Unknown",
      count: s.value ?? s.count ?? 0,
      conversionRate: s.conversionRate ?? null,
    })),
  };
}

function transformCampaigns(raw: any[]) {
  return raw.map((c: any) => ({
    id: c.id,
    name: c.name,
    platform: c.platform ?? "google_ads",
    status: c.status ?? "active",
    spend: (c.spentCents ?? 0) / 100,
    budget: (c.budgetCents ?? 0) / 100,
    roas: c.roas ?? 0,
    sparkline: [0, 0, 0, 0, 0, 0, 0],
    updatedAt: c.updatedAt ?? c.createdAt ?? new Date().toISOString(),
  }));
}

function transformBudget(raw: any) {
  const totalBudget = (raw.totalBudgetCents ?? 0) / 100;
  const spent = (raw.spentCents ?? 0) / 100;
  const burnPerDay = (raw.burnRatePerDay ?? 0) / 100;
  const daysTotal = 30;
  const daysElapsed = burnPerDay > 0 ? Math.round(spent / burnPerDay) : 0;
  return {
    totalBudget,
    spent,
    projectedSpend: burnPerDay * daysTotal,
    daysRemaining: Math.max(0, daysTotal - daysElapsed),
    daysTotal,
  };
}

function transformChannels(raw: any[]) {
  return raw.map((ch: any) => ({
    channel: ch.channel,
    spend: (ch.spentCents ?? 0) / 100,
    conversions: ch.conversions ?? 0,
    cac: ch.conversions > 0 ? ((ch.spentCents ?? 0) / 100) / ch.conversions : 0,
    roas: ch.roas ?? 0,
    status: ch.roas >= 2 ? "over_performing" : ch.roas >= 1 ? "on_target" : "under_performing",
  }));
}

function transformActivity(raw: any[]) {
  return raw.map((a: any) => ({
    id: a.id,
    agentName: a.agentName ?? "Agent",
    agentIcon: "bot",
    action: a.description ?? a.action ?? "",
    timestamp: a.createdAt ?? new Date().toISOString(),
    issueId: null,
    issueIdentifier: null,
  }));
}

function transformContent(raw: any[]) {
  return {
    stages: raw.map((s: any) => ({
      name: s.stage.charAt(0).toUpperCase() + s.stage.slice(1),
      slug: s.stage,
      count: s.count ?? 0,
    })),
  };
}

export function marketingDashboardRoutes(db: Db) {
  const router = Router();
  const svc = marketingDashboardService(db);

  // ------------------------------------------------------------------
  // Helper: parse optional date range from query params
  // ------------------------------------------------------------------
  function parseDateRange(req: any) {
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    if (from && to) {
      const fromDate = new Date(from);
      const toDate = new Date(to);
      if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
        throw badRequest("Invalid date range");
      }
      return { from: fromDate, to: toDate };
    }
    return undefined;
  }

  // ------------------------------------------------------------------
  // GET /companies/:companyId/marketing/dashboard
  // Full dashboard data (all widgets in one call)
  // ------------------------------------------------------------------
  router.get(
    "/companies/:companyId/marketing/dashboard",
    async (req, res) => {
      const { companyId } = req.params;
      assertCompanyAccess(req, companyId);
      const raw = await svc.getFullDashboard(companyId);
      res.json({
        kpis: transformKpis(raw.kpis),
        funnel: transformFunnel(raw.funnel),
        campaigns: transformCampaigns(raw.campaigns),
        budget: transformBudget(raw.budget),
        channels: transformChannels(raw.channels),
        activity: transformActivity(raw.agentActivity),
        contentPipeline: transformContent(raw.content),
      });
    },
  );

  // ------------------------------------------------------------------
  // GET /companies/:companyId/marketing/dashboard/kpis
  // KPIs only (for frequent polling)
  // ------------------------------------------------------------------
  router.get(
    "/companies/:companyId/marketing/dashboard/kpis",
    async (req, res) => {
      const { companyId } = req.params;
      assertCompanyAccess(req, companyId);
      const productId = req.query.productId as string | undefined;
      const dateRange = parseDateRange(req);
      const kpis = await svc.getKpis(companyId, productId, dateRange);
      res.json(kpis);
    },
  );

  // ------------------------------------------------------------------
  // GET /companies/:companyId/marketing/campaigns
  // Campaign list with metrics
  // ------------------------------------------------------------------
  router.get(
    "/companies/:companyId/marketing/campaigns",
    async (req, res) => {
      const { companyId } = req.params;
      assertCompanyAccess(req, companyId);
      const productId = req.query.productId as string | undefined;
      const status = req.query.status as string | undefined;
      const campaigns = await svc.getCampaigns(companyId, productId, status);
      res.json(transformCampaigns(campaigns));
    },
  );

  // ------------------------------------------------------------------
  // GET /companies/:companyId/marketing/funnel
  // Funnel data
  // ------------------------------------------------------------------
  router.get(
    "/companies/:companyId/marketing/funnel",
    async (req, res) => {
      const { companyId } = req.params;
      assertCompanyAccess(req, companyId);
      const productId = req.query.productId as string | undefined;
      const funnel = await svc.getFunnelData(companyId, productId);
      res.json(funnel);
    },
  );

  // ------------------------------------------------------------------
  // GET /companies/:companyId/marketing/budget
  // Budget status
  // ------------------------------------------------------------------
  router.get(
    "/companies/:companyId/marketing/budget",
    async (req, res) => {
      const { companyId } = req.params;
      assertCompanyAccess(req, companyId);
      const budget = await svc.getBudgetStatus(companyId);
      res.json(budget);
    },
  );

  // ------------------------------------------------------------------
  // GET /companies/:companyId/marketing/content
  // Content pipeline
  // ------------------------------------------------------------------
  router.get(
    "/companies/:companyId/marketing/content",
    async (req, res) => {
      const { companyId } = req.params;
      assertCompanyAccess(req, companyId);
      const content = await svc.getContentPipeline(companyId);
      res.json(content);
    },
  );

  // ------------------------------------------------------------------
  // GET /companies/:companyId/marketing/products
  // Product list (multi-product)
  // ------------------------------------------------------------------
  router.get(
    "/companies/:companyId/marketing/products",
    async (req, res) => {
      const { companyId } = req.params;
      assertCompanyAccess(req, companyId);
      const products = await svc.listProducts(companyId);
      res.json(products);
    },
  );

  // ------------------------------------------------------------------
  // POST /companies/:companyId/marketing/products
  // Create product
  // ------------------------------------------------------------------
  router.post(
    "/companies/:companyId/marketing/products",
    async (req, res) => {
      const { companyId } = req.params;
      assertCompanyAccess(req, companyId);

      const { name, description } = req.body as {
        name?: string;
        description?: string;
      };

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        throw badRequest("Product name is required");
      }

      const product = await svc.createProduct(
        companyId,
        name.trim(),
        description?.trim(),
      );
      res.status(201).json(product);
    },
  );

  return router;
}

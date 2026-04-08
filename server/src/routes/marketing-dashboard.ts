import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { marketingDashboardService } from "../services/marketing-dashboard.js";
import { assertCompanyAccess } from "./authz.js";
import { badRequest } from "../errors.js";

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
      const data = await svc.getFullDashboard(companyId);
      res.json(data);
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
      res.json(campaigns);
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

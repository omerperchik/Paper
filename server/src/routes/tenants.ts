import { Router } from "express";
import { tenantService } from "../services/tenants.js";

export function tenantRoutes() {
  const router = Router();
  const svc = tenantService();

  // POST /api/tenants — Create tenant
  router.post("/tenants", async (req, res) => {
    try {
      const { name, slug, domain, brandConfig } = req.body;
      if (!name || !slug) {
        res.status(400).json({ error: "name and slug are required" });
        return;
      }
      const tenant = await svc.create(name, slug, domain, brandConfig);
      res.status(201).json(tenant);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // GET /api/tenants — List tenants
  router.get("/tenants", async (_req, res) => {
    const tenants = await svc.list();
    res.json(tenants);
  });

  // GET /api/tenants/:tenantId — Get tenant details
  router.get("/tenants/:tenantId", async (req, res) => {
    const tenant = await svc.get(req.params.tenantId);
    if (!tenant) {
      res.status(404).json({ error: "Tenant not found" });
      return;
    }
    res.json(tenant);
  });

  // PATCH /api/tenants/:tenantId — Update tenant
  router.patch("/tenants/:tenantId", async (req, res) => {
    try {
      const tenant = await svc.update(req.params.tenantId, req.body);
      res.json(tenant);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  // POST /api/tenants/:tenantId/companies — Add company to tenant
  router.post("/tenants/:tenantId/companies", async (req, res) => {
    try {
      const { companyId, clientName } = req.body;
      if (!companyId || !clientName) {
        res.status(400).json({ error: "companyId and clientName are required" });
        return;
      }
      const entry = await svc.addCompany(req.params.tenantId, companyId, clientName);
      res.status(201).json(entry);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // DELETE /api/tenants/:tenantId/companies/:companyId — Remove company
  router.delete("/tenants/:tenantId/companies/:companyId", async (req, res) => {
    try {
      await svc.removeCompany(req.params.tenantId, req.params.companyId);
      res.status(204).end();
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  // GET /api/tenants/:tenantId/companies — List tenant's companies
  router.get("/tenants/:tenantId/companies", async (req, res) => {
    try {
      const companies = await svc.getCompanies(req.params.tenantId);
      res.json(companies);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  // GET /api/tenants/:tenantId/dashboard — Aggregate dashboard
  router.get("/tenants/:tenantId/dashboard", async (req, res) => {
    try {
      const metrics = await svc.getAggregateMetrics(req.params.tenantId);
      res.json(metrics);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  // GET /api/tenants/:tenantId/reports — Generate client reports
  router.get("/tenants/:tenantId/reports", async (req, res) => {
    try {
      const tenant = await svc.get(req.params.tenantId);
      if (!tenant) {
        res.status(404).json({ error: "Tenant not found" });
        return;
      }

      const metrics = await svc.getAggregateMetrics(req.params.tenantId);

      const report = {
        tenantId: tenant.id,
        tenantName: tenant.name,
        generatedAt: new Date().toISOString(),
        summary: metrics,
        clients: tenant.companies.map((c) => ({
          companyId: c.companyId,
          clientName: c.clientName,
          addedAt: c.addedAt,
          // Per-client metrics would come from real DB queries
          spendCents: 125000,
          revenueCents: 340000,
          cacCents: 4200,
          status: "active" as const,
        })),
      };

      res.json(report);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

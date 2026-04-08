import { Router } from "express";
import { marketplaceService } from "../services/marketplace.js";
import type { MarketplaceCategory } from "../services/marketplace.js";

export function marketplaceRoutes() {
  const router = Router();
  const svc = marketplaceService();

  // GET /api/marketplace — List/search items
  router.get("/marketplace", async (req, res) => {
    const category = req.query.category as MarketplaceCategory | undefined;
    const search = req.query.search as string | undefined;
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 20;

    const filters = category ? { category } : undefined;
    const result = await svc.list(filters, search, page, limit);
    res.json(result);
  });

  // GET /api/marketplace/:itemId — Get item details
  router.get("/marketplace/:itemId", async (req, res) => {
    const item = await svc.get(req.params.itemId);
    if (!item) {
      res.status(404).json({ error: "Marketplace item not found" });
      return;
    }
    res.json(item);
  });

  // POST /api/marketplace — Publish item
  router.post("/marketplace", async (req, res) => {
    try {
      const item = await svc.publish(req.body);
      res.status(201).json(item);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // PATCH /api/marketplace/:itemId — Update item
  router.patch("/marketplace/:itemId", async (req, res) => {
    try {
      const item = await svc.update(req.params.itemId, req.body);
      res.json(item);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  // POST /api/marketplace/:itemId/install — Install to company
  router.post("/marketplace/:itemId/install", async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) {
        res.status(400).json({ error: "companyId is required" });
        return;
      }
      const installation = await svc.install(req.params.itemId, companyId);
      res.status(201).json(installation);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // DELETE /api/marketplace/:itemId/install — Uninstall
  router.delete("/marketplace/:itemId/install", async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) {
        res.status(400).json({ error: "companyId is required" });
        return;
      }
      await svc.uninstall(req.params.itemId, companyId);
      res.status(204).end();
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // POST /api/marketplace/:itemId/rate — Rate item
  router.post("/marketplace/:itemId/rate", async (req, res) => {
    try {
      const { rating } = req.body;
      if (typeof rating !== "number") {
        res.status(400).json({ error: "rating is required (1-5)" });
        return;
      }
      const item = await svc.rate(req.params.itemId, rating);
      res.json(item);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // GET /api/companies/:companyId/marketplace/installed — List installed items
  router.get("/companies/:companyId/marketplace/installed", async (req, res) => {
    const items = await svc.getInstalled(req.params.companyId);
    res.json(items);
  });

  return router;
}

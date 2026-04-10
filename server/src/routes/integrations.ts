// REST routes for external integrations (Google Ads, Facebook Ads, X,
// Reddit, TikTok Ads, GitHub, WordPress, MakeUGC, SFMC, Firebase).
//
// - GET    /companies/:companyId/integrations             — list accounts
// - POST   /companies/:companyId/integrations             — create or rotate
// - DELETE /companies/:companyId/integrations/:id         — disconnect
// - GET    /companies/:companyId/integrations/providers   — provider catalog
// - POST   /companies/:companyId/integrations/:id/bindings — bind to agent
// - DELETE /companies/:companyId/integrations/:id/bindings/:agentId
// - GET    /companies/:companyId/agents/:agentId/integrations — per-agent list

import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { integrationService, SUPPORTED_PROVIDERS, isSupportedProvider } from "../services/integrations.js";
import { PROVIDER_CATALOG } from "../services/integration-providers/catalog.js";

const createIntegrationSchema = z.object({
  body: z.object({
    provider: z.enum(SUPPORTED_PROVIDERS),
    label: z.string().min(1).max(80),
    credentials: z.record(z.unknown()),
    metadata: z.record(z.unknown()).optional(),
  }),
});

const bindAgentSchema = z.object({
  body: z.object({
    agentId: z.string().uuid(),
  }),
});

export function integrationRoutes(db: Db) {
  const router = Router();
  const svc = integrationService(db);

  // Static provider catalog — describes what fields the operator needs
  // to paste for each provider. Used to drive the Settings UI form.
  router.get("/companies/:companyId/integrations/providers", (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    res.json(PROVIDER_CATALOG);
  });

  router.get("/companies/:companyId/integrations", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await svc.list(companyId);

    // Also include per-account bound agent ids for the UI.
    const withBindings = await Promise.all(
      rows.map(async (r) => ({
        ...r,
        boundAgentIds: await svc.listAgentsForAccount(companyId, r.id),
      })),
    );
    res.json(withBindings);
  });

  router.post(
    "/companies/:companyId/integrations",
    validate(createIntegrationSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const body = req.body as z.infer<typeof createIntegrationSchema>["body"];
      if (!isSupportedProvider(body.provider)) {
        res.status(400).json({ error: "unsupported_provider" });
        return;
      }
      const created = await svc.create(companyId, body, {
        userId: req.actor?.userId ?? null,
      });
      res.status(201).json(created);
    },
  );

  router.delete("/companies/:companyId/integrations/:id", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    await svc.remove(companyId, req.params.id as string);
    res.status(204).send();
  });

  router.post(
    "/companies/:companyId/integrations/:id/bindings",
    validate(bindAgentSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { agentId } = req.body as z.infer<typeof bindAgentSchema>["body"];
      await svc.bindAgent(companyId, agentId, req.params.id as string);
      res.status(204).send();
    },
  );

  router.delete(
    "/companies/:companyId/integrations/:id/bindings/:agentId",
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      await svc.unbindAgent(
        companyId,
        req.params.agentId as string,
        req.params.id as string,
      );
      res.status(204).send();
    },
  );

  router.get(
    "/companies/:companyId/agents/:agentId/integrations",
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const rows = await svc.listBindingsForAgent(
        companyId,
        req.params.agentId as string,
      );
      res.json(rows);
    },
  );

  return router;
}

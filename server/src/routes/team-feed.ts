// Routes exposing the team-feed service: a unified activity stream plus a
// leaderboard of agent activity over a time window. Both endpoints are
// scoped to the manager's reports_to subtree when `agentId` is provided,
// otherwise they cover the full company.

import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { teamFeedService } from "../services/team-feed.js";
import { assertCompanyAccess } from "./authz.js";

export function teamFeedRoutes(db: Db) {
  const router = Router();
  const svc = teamFeedService(db);

  router.get("/companies/:companyId/team-feed", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const agentIdRaw = req.query.agentId;
    const managerId =
      typeof agentIdRaw === "string" && agentIdRaw.length > 0 ? agentIdRaw : null;

    const limitRaw = req.query.limit;
    const parsedLimit = typeof limitRaw === "string" ? Number.parseInt(limitRaw, 10) : NaN;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 500) : 100;

    const events = await svc.listFeed(companyId, managerId, limit);
    res.json({ events });
  });

  router.get("/companies/:companyId/leaderboard", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const agentIdRaw = req.query.agentId;
    const managerId =
      typeof agentIdRaw === "string" && agentIdRaw.length > 0 ? agentIdRaw : null;
    const windowRaw = req.query.window;
    const window = typeof windowRaw === "string" ? windowRaw : "7d";

    const rows = await svc.leaderboard(companyId, managerId, window);
    res.json({ window, rows });
  });

  return router;
}

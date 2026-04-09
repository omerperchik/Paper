import { Router } from "express";
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import { validate } from "../middleware/validate.js";
import { routineService, agentProgramRevisionService } from "../services/index.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { badRequest } from "../errors.js";

const emitEventSchema = z.object({
  eventKind: z.string().min(1).max(100),
  payload: z.record(z.unknown()).optional(),
  sourceLabel: z.string().max(200).optional(),
});

const createEventTriggerSchema = z.object({
  routineId: z.string().uuid(),
  eventKind: z.string().min(1).max(100),
  label: z.string().max(200).optional(),
  enabled: z.boolean().optional(),
});

const proposeRevisionSchema = z.object({
  programMd: z.string().min(1),
  rationale: z.string().max(2000).optional().nullable(),
  parentRevisionId: z.string().uuid().optional().nullable(),
  metricName: z.string().max(100).optional().nullable(),
  metricBaseline: z.string().max(200).optional().nullable(),
  metricObserved: z.string().max(200).optional().nullable(),
});

const revertSchema = z.object({
  reason: z.string().min(1).max(500),
});

const recordMetricSchema = z.object({
  metricName: z.string().min(1).max(100),
  metricObserved: z.string().min(1).max(200),
});

/**
 * Routes for the event bus and program-revisions subsystems added in
 * migration 0053.
 *
 * Event bus:
 *   POST /api/companies/:companyId/events            — emit an event
 *   GET  /api/companies/:companyId/events            — list recent events
 *   POST /api/companies/:companyId/event-triggers    — subscribe a routine to an event
 *   GET  /api/companies/:companyId/event-triggers    — list event subscriptions
 *
 * Program revisions:
 *   GET    /api/agents/:agentId/program-revisions
 *   POST   /api/agents/:agentId/program-revisions             (propose)
 *   POST   /api/agents/:agentId/program-revisions/seed        (seed from current metadata)
 *   POST   /api/agents/:agentId/program-revisions/:id/activate
 *   POST   /api/agents/:agentId/program-revisions/revert      (body: { reason })
 *   POST   /api/agents/:agentId/program-revisions/metric      (record observation)
 */
export function agentEventRoutes(db: Db) {
  const router = Router();
  const routines = routineService(db);
  const revisions = agentProgramRevisionService(db);

  // ---------------------------------------------------------------------
  // Event bus
  // ---------------------------------------------------------------------

  router.post("/companies/:companyId/events", validate(emitEventSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const event = await routines.emitEvent({
      companyId,
      eventKind: req.body.eventKind,
      payload: req.body.payload ?? {},
      sourceAgentId: actor.agentId ?? null,
      sourceRunId: null,
      sourceLabel: req.body.sourceLabel ?? (actor.agentId ? "agent" : "user"),
    });
    res.status(201).json(event);
  });

  router.get("/companies/:companyId/events", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const limitRaw = req.query.limit;
    let limit = 100;
    if (limitRaw != null && limitRaw !== "") {
      const n = Number.parseInt(String(limitRaw), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 500) throw badRequest("invalid 'limit'");
      limit = n;
    }
    const rows = await routines.listEvents(companyId, limit);
    res.json(rows);
  });

  router.post(
    "/companies/:companyId/event-triggers",
    validate(createEventTriggerSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);
      const trigger = await routines.createEventTrigger({
        companyId,
        routineId: req.body.routineId,
        eventKind: req.body.eventKind,
        label: req.body.label,
        enabled: req.body.enabled,
        actor: { agentId: actor.agentId ?? null, userId: actor.actorId },
      });
      res.status(201).json(trigger);
    },
  );

  router.get("/companies/:companyId/event-triggers", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const rows = await routines.listEventTriggers(companyId);
    res.json(rows);
  });

  // ---------------------------------------------------------------------
  // Program revisions
  // ---------------------------------------------------------------------

  router.get("/agents/:agentId/program-revisions", async (req, res) => {
    const agentId = req.params.agentId as string;
    const limitRaw = req.query.limit;
    let limit = 50;
    if (limitRaw != null && limitRaw !== "") {
      const n = Number.parseInt(String(limitRaw), 10);
      if (!Number.isFinite(n) || n <= 0 || n > 500) throw badRequest("invalid 'limit'");
      limit = n;
    }
    const rows = await revisions.list(agentId, limit);
    // Best-effort companyId gate — the first row (if any) tells us which company.
    if (rows.length > 0) {
      assertCompanyAccess(req, rows[0].companyId);
    }
    res.json(rows);
  });

  router.post(
    "/agents/:agentId/program-revisions",
    validate(proposeRevisionSchema),
    async (req, res) => {
      const agentId = req.params.agentId as string;
      const actor = getActorInfo(req);
      const row = await revisions.propose({
        agentId,
        programMd: req.body.programMd,
        rationale: req.body.rationale,
        parentRevisionId: req.body.parentRevisionId,
        metricName: req.body.metricName,
        metricBaseline: req.body.metricBaseline,
        metricObserved: req.body.metricObserved,
        proposedByAgentId: actor.agentId ?? null,
        proposedByRunId: null,
      });
      assertCompanyAccess(req, row.companyId);
      res.status(201).json(row);
    },
  );

  router.post("/agents/:agentId/program-revisions/seed", async (req, res) => {
    const agentId = req.params.agentId as string;
    const row = await revisions.seedFromCurrent(agentId);
    if (row) assertCompanyAccess(req, row.companyId);
    res.json(row);
  });

  router.post("/agents/:agentId/program-revisions/:revisionId/activate", async (req, res) => {
    const revisionId = req.params.revisionId as string;
    const actor = getActorInfo(req);
    const existing = await revisions.getById(revisionId);
    if (existing) assertCompanyAccess(req, existing.companyId);
    const row = await revisions.activate(revisionId, {
      agentId: actor.agentId ?? null,
      userId: actor.actorId,
    });
    res.json(row);
  });

  router.post(
    "/agents/:agentId/program-revisions/revert",
    validate(revertSchema),
    async (req, res) => {
      const agentId = req.params.agentId as string;
      const actor = getActorInfo(req);
      const result = await revisions.revert(agentId, req.body.reason, {
        agentId: actor.agentId ?? null,
        userId: actor.actorId,
      });
      assertCompanyAccess(req, result.restored.companyId);
      res.json(result);
    },
  );

  router.post(
    "/agents/:agentId/program-revisions/metric",
    validate(recordMetricSchema),
    async (req, res) => {
      const agentId = req.params.agentId as string;
      const row = await revisions.recordMetricObservation(
        agentId,
        req.body.metricName,
        req.body.metricObserved,
      );
      assertCompanyAccess(req, row.companyId);
      res.json(row);
    },
  );

  return router;
}

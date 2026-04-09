/**
 * agent-program-revisions — versioned program.md for each agent.
 *
 * The active revision is the one whose status='active'. Agents read
 * `agents.metadata.programMd` at runtime; this service keeps that field
 * in sync with the active revision row.
 *
 * Workflow:
 *   1. Meta Optimizer (or a human) proposes a new revision (`propose`). Status
 *      becomes 'proposed'. Agent runtime is unaffected.
 *   2. Human approves (`activate`). The previous active row is flipped to
 *      'superseded', the proposed row to 'active', and the metadata.programMd
 *      on the agent is rewritten in the same transaction.
 *   3. If a later metric check finds regression, `revert` restores the
 *      previous revision as active and marks the current one 'reverted'.
 */

import { and, desc, eq, max, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, agentProgramRevisions } from "@paperclipai/db";
import { conflict, notFound, unprocessable } from "../errors.js";

type Actor = { agentId?: string | null; userId?: string | null };

export interface ProposeRevisionInput {
  agentId: string;
  programMd: string;
  rationale?: string | null;
  parentRevisionId?: string | null;
  metricName?: string | null;
  metricBaseline?: string | null;
  metricObserved?: string | null;
  proposedByAgentId?: string | null;
  proposedByRunId?: string | null;
}

export function agentProgramRevisionService(db: Db) {
  async function getAgent(agentId: string) {
    const agent = await db.select().from(agents).where(eq(agents.id, agentId)).then((rows) => rows[0] ?? null);
    if (!agent) throw notFound("Agent not found");
    return agent;
  }

  async function nextRevisionNumber(agentId: string): Promise<number> {
    const row = await db
      .select({ max: max(agentProgramRevisions.revisionNumber) })
      .from(agentProgramRevisions)
      .where(eq(agentProgramRevisions.agentId, agentId))
      .then((rows) => rows[0] ?? null);
    return (row?.max ?? 0) + 1;
  }

  async function getActive(agentId: string) {
    return db
      .select()
      .from(agentProgramRevisions)
      .where(and(eq(agentProgramRevisions.agentId, agentId), eq(agentProgramRevisions.status, "active")))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  async function writeProgramMdToAgent(agentId: string, programMd: string) {
    await db
      .update(agents)
      .set({
        metadata: sql`coalesce(${agents.metadata}, '{}'::jsonb) || jsonb_build_object('programMd', ${programMd}::text)`,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agentId));
  }

  return {
    list: async (agentId: string, limit = 50) => {
      await getAgent(agentId);
      return db
        .select()
        .from(agentProgramRevisions)
        .where(eq(agentProgramRevisions.agentId, agentId))
        .orderBy(desc(agentProgramRevisions.createdAt))
        .limit(limit);
    },

    getById: async (id: string) => {
      return db
        .select()
        .from(agentProgramRevisions)
        .where(eq(agentProgramRevisions.id, id))
        .then((rows) => rows[0] ?? null);
    },

    getActive,

    /**
     * Propose a new revision. Does not affect the active revision — the
     * proposal must be approved before it takes effect.
     */
    propose: async (input: ProposeRevisionInput) => {
      const agent = await getAgent(input.agentId);
      const programMd = (input.programMd ?? "").trim();
      if (!programMd) throw unprocessable("programMd is required");

      const revisionNumber = await nextRevisionNumber(input.agentId);
      const [row] = await db
        .insert(agentProgramRevisions)
        .values({
          companyId: agent.companyId,
          agentId: input.agentId,
          revisionNumber,
          status: "proposed",
          programMd,
          rationale: input.rationale ?? null,
          parentRevisionId: input.parentRevisionId ?? null,
          proposedByAgentId: input.proposedByAgentId ?? null,
          proposedByRunId: input.proposedByRunId ?? null,
          metricName: input.metricName ?? null,
          metricBaseline: input.metricBaseline ?? null,
          metricObserved: input.metricObserved ?? null,
          metricObservedAt: input.metricObserved != null ? new Date() : null,
        })
        .returning();
      return row;
    },

    /**
     * Activate a proposed revision. Supersedes the current active revision
     * atomically and rewrites agents.metadata.programMd.
     */
    activate: async (revisionId: string, actor: Actor) => {
      const revision = await db
        .select()
        .from(agentProgramRevisions)
        .where(eq(agentProgramRevisions.id, revisionId))
        .then((rows) => rows[0] ?? null);
      if (!revision) throw notFound("Revision not found");
      if (revision.status !== "proposed") {
        throw conflict(`Cannot activate revision in status '${revision.status}'`);
      }

      return db.transaction(async (tx) => {
        const now = new Date();
        const current = await tx
          .select()
          .from(agentProgramRevisions)
          .where(
            and(
              eq(agentProgramRevisions.agentId, revision.agentId),
              eq(agentProgramRevisions.status, "active"),
            ),
          )
          .then((rows) => rows[0] ?? null);

        if (current) {
          await tx
            .update(agentProgramRevisions)
            .set({ status: "superseded", supersededAt: now })
            .where(eq(agentProgramRevisions.id, current.id));
        }

        const [activated] = await tx
          .update(agentProgramRevisions)
          .set({
            status: "active",
            approvedByUserId: actor.userId ?? null,
            approvedAt: now,
            activatedAt: now,
          })
          .where(eq(agentProgramRevisions.id, revision.id))
          .returning();

        await tx
          .update(agents)
          .set({
            metadata: sql`coalesce(${agents.metadata}, '{}'::jsonb) || jsonb_build_object('programMd', ${revision.programMd}::text)`,
            updatedAt: now,
          })
          .where(eq(agents.id, revision.agentId));

        return activated;
      });
    },

    /**
     * Revert the current active revision to the most recent superseded one.
     * Used by the metric-loop when a newly-activated revision regresses
     * against its baseline. The reverted row gets status='reverted' with
     * a reason; the restored row returns to 'active'.
     */
    revert: async (agentId: string, reason: string, actor: Actor) => {
      await getAgent(agentId);
      return db.transaction(async (tx) => {
        const now = new Date();
        const current = await tx
          .select()
          .from(agentProgramRevisions)
          .where(
            and(
              eq(agentProgramRevisions.agentId, agentId),
              eq(agentProgramRevisions.status, "active"),
            ),
          )
          .then((rows) => rows[0] ?? null);
        if (!current) throw notFound("No active revision to revert");

        const previous = await tx
          .select()
          .from(agentProgramRevisions)
          .where(
            and(
              eq(agentProgramRevisions.agentId, agentId),
              eq(agentProgramRevisions.status, "superseded"),
            ),
          )
          .orderBy(desc(agentProgramRevisions.supersededAt))
          .limit(1)
          .then((rows) => rows[0] ?? null);
        if (!previous) throw conflict("No previous revision to revert to");

        await tx
          .update(agentProgramRevisions)
          .set({ status: "reverted", revertedAt: now, revertedReason: reason })
          .where(eq(agentProgramRevisions.id, current.id));

        const [restored] = await tx
          .update(agentProgramRevisions)
          .set({
            status: "active",
            activatedAt: now,
            supersededAt: null,
            approvedByUserId: actor.userId ?? null,
            approvedAt: now,
          })
          .where(eq(agentProgramRevisions.id, previous.id))
          .returning();

        await tx
          .update(agents)
          .set({
            metadata: sql`coalesce(${agents.metadata}, '{}'::jsonb) || jsonb_build_object('programMd', ${previous.programMd}::text)`,
            updatedAt: now,
          })
          .where(eq(agents.id, agentId));

        return { reverted: current, restored };
      });
    },

    /**
     * Seed an 'active' revision from whatever is currently in
     * agents.metadata.programMd. Idempotent — does nothing if any revision
     * already exists for this agent. Used to backfill existing agents so
     * the revert/metric loop has a baseline to work with.
     */
    seedFromCurrent: async (agentId: string) => {
      const agent = await getAgent(agentId);
      const existing = await db
        .select()
        .from(agentProgramRevisions)
        .where(eq(agentProgramRevisions.agentId, agentId))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      if (existing) return existing;

      const metadata = (agent.metadata ?? {}) as { programMd?: string };
      const programMd = metadata.programMd ?? "";
      if (!programMd.trim()) return null;

      const [row] = await db
        .insert(agentProgramRevisions)
        .values({
          companyId: agent.companyId,
          agentId,
          revisionNumber: 1,
          status: "active",
          programMd,
          rationale: "Seeded from existing agents.metadata.programMd",
          activatedAt: new Date(),
          approvedAt: new Date(),
        })
        .returning();
      return row;
    },

    /**
     * Record an observed metric value on the most recent active revision.
     * Used by agents / the metric-loop to persist evidence against the
     * hypothesis. Does not trigger auto-revert on its own.
     */
    recordMetricObservation: async (
      agentId: string,
      metricName: string,
      metricObserved: string,
    ) => {
      const active = await getActive(agentId);
      if (!active) throw notFound("No active revision");
      await db
        .update(agentProgramRevisions)
        .set({
          metricName,
          metricObserved,
          metricObservedAt: new Date(),
        })
        .where(eq(agentProgramRevisions.id, active.id));
      return { ...active, metricName, metricObserved };
    },

    // Exposed for tests / external callers that want to force the agent
    // metadata column into sync without going through activate().
    writeProgramMdToAgent,
  };
}

export type AgentProgramRevisionService = ReturnType<typeof agentProgramRevisionService>;

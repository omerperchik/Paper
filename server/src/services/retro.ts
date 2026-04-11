// Weekly retro — gbrain-inspired learning loop.
//
// Once a week, for each company, we:
//   1. Pull the company's playbooks updated in the last 7 days.
//   2. Pull recent activity_log entries to compute crude success/failure
//      counts and identify the top patterns by usage.
//   3. Rewrite the `lastInsight` of any playbook whose stats look stale,
//      injecting a heuristic summary like "succeeded 4/5; common failure:
//      blocker on credentials". This is the no-LLM v1; an LLM-driven
//      version can plug in later.
//   4. Emit a `routine.triggered` wake event to the CEO/founder agent so
//      they get a heartbeat with the retro summary in context. The agent
//      sees a `paperclipRetroSummary` blob in their context and can
//      propose strategy updates.
//
// This is the "compounding learning" mechanism gstack calls /retro and
// gbrain calls READ-update-WRITE. Without it, every improvement is a
// one-shot multiplier; with it, every week the system gets cheaper and
// better at the same tasks.

import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentPlaybooks, agents, companies, activityLog } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { wakeEventsService } from "./wake-events.js";

export interface RetroSummary {
  companyId: string;
  windowDays: number;
  playbooksTouched: number;
  topPatterns: Array<{
    pattern: string;
    runs: number;
    successRate: number;
    avgIterations: number;
    lastInsight: string;
  }>;
  totalActivity: number;
  rewroteInsightsFor: string[];
}

const WINDOW_DAYS = 7;

export function retroService(db: Db) {
  const wakes = wakeEventsService(db);

  return {
    /** Run a retro for a single company. Idempotent — safe to call repeatedly. */
    async runRetroForCompany(companyId: string): Promise<RetroSummary> {
      const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

      const recentPlaybooks = await db
        .select()
        .from(agentPlaybooks)
        .where(
          and(
            eq(agentPlaybooks.companyId, companyId),
            gte(agentPlaybooks.lastUsedAt, since),
          ),
        )
        .orderBy(desc(agentPlaybooks.lastUsedAt))
        .limit(50);

      const activityCount = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(activityLog)
        .where(
          and(
            eq(activityLog.companyId, companyId),
            gte(activityLog.createdAt, since),
          ),
        )
        .then((r) => r[0]?.c ?? 0);

      const rewroteInsightsFor: string[] = [];
      const topPatterns: RetroSummary["topPatterns"] = [];

      for (const pb of recentPlaybooks) {
        const total = pb.successCount + pb.failureCount + pb.partialCount;
        if (total === 0) continue;
        const successRate = pb.successCount / total;
        topPatterns.push({
          pattern: pb.pattern,
          runs: total,
          successRate: Math.round(successRate * 100),
          avgIterations: pb.avgIterations,
          lastInsight: pb.lastInsight,
        });

        // Rewrite the lastInsight with a fresh heuristic summary so the
        // next heartbeat sees the most current "what we know about this
        // pattern" sentence even if the agent hasn't recorded a new one.
        const heuristic = buildHeuristicInsight(pb);
        if (heuristic && heuristic !== pb.lastInsight) {
          await db
            .update(agentPlaybooks)
            .set({ lastInsight: heuristic, updatedAt: new Date() })
            .where(eq(agentPlaybooks.id, pb.id));
          rewroteInsightsFor.push(pb.pattern);
        }
      }

      topPatterns.sort((a, b) => b.runs - a.runs);

      const summary: RetroSummary = {
        companyId,
        windowDays: WINDOW_DAYS,
        playbooksTouched: recentPlaybooks.length,
        topPatterns: topPatterns.slice(0, 10),
        totalActivity: activityCount,
        rewroteInsightsFor,
      };

      // Wake the company's CEO/founder so they get a heartbeat with the
      // retro summary in context. The agent's context-assembler will pick
      // up the most-recent unprocessed routine.triggered event with the
      // `kind: "retro_weekly"` payload and inject the summary.
      const ceo = await findCeoForCompany(db, companyId);
      if (ceo) {
        await wakes.emit({
          companyId,
          agentId: ceo.id,
          eventType: "routine.triggered",
          payload: {
            kind: "retro_weekly",
            summary,
          },
          dedupeKey: `retro_weekly:${companyId}`,
        });
      }

      logger.info(
        {
          service: "retro",
          companyId,
          playbooksTouched: summary.playbooksTouched,
          rewroteInsightsCount: rewroteInsightsFor.length,
          ceoWoken: ceo?.id ?? null,
        },
        "weekly retro complete",
      );

      return summary;
    },

    /** Run retros for every company in the system. Used by the weekly cron. */
    async runRetroForAll(): Promise<{ companies: number; ok: number; failed: number }> {
      const rows = await db.select({ id: companies.id }).from(companies);
      let ok = 0;
      let failed = 0;
      for (const row of rows) {
        try {
          await this.runRetroForCompany(row.id);
          ok += 1;
        } catch (err) {
          failed += 1;
          logger.warn(
            { service: "retro", companyId: row.id, err },
            "retro for company failed (non-fatal)",
          );
        }
      }
      return { companies: rows.length, ok, failed };
    },
  };
}

function buildHeuristicInsight(pb: typeof agentPlaybooks.$inferSelect): string {
  const total = pb.successCount + pb.failureCount + pb.partialCount;
  if (total === 0) return pb.lastInsight;
  const pct = Math.round((pb.successCount / total) * 100);
  const verdict =
    pct >= 80
      ? "reliably works"
      : pct >= 50
        ? "works most of the time"
        : pct >= 25
          ? "frequently fails"
          : "almost always fails";
  return `${verdict} (${pb.successCount}/${total} ok, avg ${pb.avgIterations} iters)`;
}

async function findCeoForCompany(
  db: Db,
  companyId: string,
): Promise<{ id: string } | null> {
  const rows = await db
    .select({ id: agents.id, role: agents.role })
    .from(agents)
    .where(
      and(
        eq(agents.companyId, companyId),
        sql`lower(${agents.role}) ~ '(ceo|chairman|founder)'`,
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

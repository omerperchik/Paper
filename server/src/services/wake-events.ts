// Wake events — the event-driven scheduler's queue.
//
// Rather than cron-ticking every agent every N seconds and hoping something's
// changed, publishers emit a wake event whenever meaningful state changes.
// A small consumer loop dequeues events, invokes() the target agent, and
// marks the event processed. Cron tickTimers remains as a safety net.
//
// Event types (keep this list tight — each type needs a semantic justification):
//   issue.assigned           — assignee changed, wake new assignee
//   issue.blocker_resolved   — a blocking issue closed, wake blocked assignee
//   issue.comment_added      — comment on an issue I own
//   approval.resolved        — human decided, wake requester
//   human.answered           — ask_human answered, wake asker
//   routine.triggered        — routine cron/webhook fired, wake owner
//   child_issue.completed    — a subtask done, wake parent owner
//
// The dedupe_key dedupes identical events within a short window so we don't
// queue 17 wakes for the same agent when 17 things happen in 1 second.

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { wakeEvents } from "@paperclipai/db";

export type WakeEventType =
  | "issue.assigned"
  | "issue.blocker_resolved"
  | "issue.comment_added"
  | "approval.resolved"
  | "human.answered"
  | "routine.triggered"
  | "child_issue.completed";

export interface EmitWakeEventInput {
  companyId: string;
  agentId: string;
  eventType: WakeEventType;
  issueId?: string | null;
  payload?: Record<string, unknown>;
  /** Optional dedupe key; events with the same key within `dedupeWindowMs` coalesce. */
  dedupeKey?: string;
}

export interface WakeEventRow {
  id: string;
  companyId: string;
  agentId: string;
  eventType: string;
  issueId: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
  processedAt: Date | null;
}

const DEFAULT_DEDUPE_WINDOW_MS = 30 * 1000;

export function wakeEventsService(db: Db) {
  return {
    async emit(input: EmitWakeEventInput): Promise<WakeEventRow | null> {
      // If a dedupe key is provided, check for a recent unprocessed event
      // with the same key on the same agent. If one exists, skip — the
      // agent will already be woken by the earlier event.
      if (input.dedupeKey) {
        const cutoff = new Date(Date.now() - DEFAULT_DEDUPE_WINDOW_MS);
        const existing = await db
          .select({ id: wakeEvents.id })
          .from(wakeEvents)
          .where(
            and(
              eq(wakeEvents.agentId, input.agentId),
              eq(wakeEvents.dedupeKey, input.dedupeKey),
              isNull(wakeEvents.processedAt),
              sql`${wakeEvents.createdAt} > ${cutoff}`,
            ),
          )
          .limit(1);
        if (existing.length > 0) return null;
      }
      const inserted = await db
        .insert(wakeEvents)
        .values({
          companyId: input.companyId,
          agentId: input.agentId,
          eventType: input.eventType,
          issueId: input.issueId ?? null,
          payload: input.payload ?? {},
          dedupeKey: input.dedupeKey ?? null,
        })
        .returning();
      const row = inserted[0];
      return row
        ? {
            id: row.id,
            companyId: row.companyId,
            agentId: row.agentId,
            eventType: row.eventType,
            issueId: row.issueId,
            payload: row.payload ?? {},
            createdAt: row.createdAt,
            processedAt: row.processedAt,
          }
        : null;
    },

    /**
     * Dequeue up to `limit` unprocessed wake events, FIFO. Does NOT mark
     * them processed — caller must call markProcessed after successfully
     * invoking the target agent. (Two-phase so a crash mid-invoke can
     * be retried.)
     */
    async dequeuePending(limit: number): Promise<WakeEventRow[]> {
      const rows = await db
        .select()
        .from(wakeEvents)
        .where(isNull(wakeEvents.processedAt))
        .orderBy(asc(wakeEvents.createdAt))
        .limit(limit);
      return rows.map((row) => ({
        id: row.id,
        companyId: row.companyId,
        agentId: row.agentId,
        eventType: row.eventType,
        issueId: row.issueId,
        payload: row.payload ?? {},
        createdAt: row.createdAt,
        processedAt: row.processedAt,
      }));
    },

    async markProcessed(
      eventId: string,
      runId: string | null,
      error?: string,
    ): Promise<void> {
      await db
        .update(wakeEvents)
        .set({
          processedAt: new Date(),
          processedRunId: runId,
          processingError: error ?? null,
        })
        .where(eq(wakeEvents.id, eventId));
    },
  };
}

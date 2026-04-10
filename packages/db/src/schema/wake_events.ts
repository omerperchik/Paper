import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

/**
 * wake_events — the event-driven scheduler's queue.
 *
 * Instead of cron-ticking every agent every N seconds (70%+ of which produce
 * nothing), we enqueue a wake event whenever something happens that an agent
 * might care about:
 *
 *   issue.assigned         — issue.assigneeAgentId set, wake the assignee
 *   issue.blocker_resolved — a blocking issue finished, wake the blocked asignee
 *   issue.comment_added    — someone commented on an issue I own
 *   approval.resolved      — human answered, wake the requester
 *   human.answered         — ask_human answered, wake the asker
 *   routine.triggered      — cron/webhook fired, wake the routine owner
 *   dependency.completed   — child issue done, wake the parent owner
 *
 * The scheduler tick dequeues unprocessed events and calls invoke() on the
 * target agent. Cron tickTimers() remains as a safety-net for "did anyone go
 * stale" but is no longer the primary driver.
 */
export const wakeEvents = pgTable(
  "wake_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    issueId: uuid("issue_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processedRunId: uuid("processed_run_id"),
    processingError: text("processing_error"),
  },
  (table) => ({
    pendingIdx: index("wake_events_pending_idx").on(
      table.processedAt,
      table.createdAt,
    ),
    agentPendingIdx: index("wake_events_agent_pending_idx").on(
      table.agentId,
      table.processedAt,
    ),
    dedupeIdx: index("wake_events_dedupe_idx").on(table.dedupeKey),
  }),
);

import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

/**
 * agent_events — an append-only event bus for agent-to-agent handoffs and
 * external signals. Agents emit events (e.g. "cac_spike", "review_posted").
 * routine_triggers with kind='event' subscribe by event_kind and fire their
 * owning routine when a new matching event appears. Events are kept for audit
 * but `consumed_at` is set the first time any trigger picks them up to avoid
 * re-firing on the next scheduler tick.
 */
export const agentEvents = pgTable(
  "agent_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    eventKind: text("event_kind").notNull(),
    sourceAgentId: uuid("source_agent_id").references(() => agents.id, { onDelete: "set null" }),
    sourceRunId: uuid("source_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    sourceLabel: text("source_label"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    emittedAt: timestamp("emitted_at", { withTimezone: true }).notNull().defaultNow(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => ({
    companyKindEmittedIdx: index("agent_events_company_kind_emitted_idx").on(
      table.companyId,
      table.eventKind,
      table.emittedAt,
    ),
    unconsumedIdx: index("agent_events_unconsumed_idx").on(table.companyId, table.consumedAt, table.eventKind),
  }),
);

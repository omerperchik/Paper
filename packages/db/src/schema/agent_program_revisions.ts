import { pgTable, uuid, text, timestamp, integer, index, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

/**
 * agent_program_revisions — versioned history of each agent's program.md.
 *
 * One row per revision; at most one row per agent is in status='active'.
 * The Meta Optimizer agent creates 'proposed' rows; a human approval flips
 * the current 'active' row to 'superseded' and the proposed row to 'active'.
 * 'reverted' is used when a revision is rolled back due to metric regression.
 *
 * The full program.md content is stored inline in `program_md` so each
 * revision is self-contained (no delta reconstruction).
 */
export const agentProgramRevisions = pgTable(
  "agent_program_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    status: text("status").notNull().default("proposed"), // proposed | active | superseded | reverted
    programMd: text("program_md").notNull(),
    rationale: text("rationale"),
    parentRevisionId: uuid("parent_revision_id").references((): AnyPgColumn => agentProgramRevisions.id, {
      onDelete: "set null",
    }),
    proposedByAgentId: uuid("proposed_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    proposedByRunId: uuid("proposed_by_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    approvedByUserId: text("approved_by_user_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    revertedAt: timestamp("reverted_at", { withTimezone: true }),
    revertedReason: text("reverted_reason"),
    metricName: text("metric_name"),
    metricBaseline: text("metric_baseline"), // stored as text to avoid numeric precision issues
    metricObserved: text("metric_observed"),
    metricObservedAt: timestamp("metric_observed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentCreatedIdx: index("agent_program_revisions_agent_created_idx").on(table.agentId, table.createdAt),
    agentStatusIdx: index("agent_program_revisions_agent_status_idx").on(table.agentId, table.status),
    agentRevisionNumberUq: uniqueIndex("agent_program_revisions_agent_revision_number_uq").on(
      table.agentId,
      table.revisionNumber,
    ),
  }),
);

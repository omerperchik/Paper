import { pgTable, uuid, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

/**
 * agent_playbooks — per-agent learned-from-experience index.
 *
 * After every successful heartbeat run, a lightweight retrospective extracts:
 *   - pattern (e.g. "research_competitor_pricing")
 *   - approach (short text of what worked)
 *   - outcome (success|partial|fail)
 *   - keyInsight (one sentence)
 *
 * Rows are upserted by (agent_id, pattern). At heartbeat context-assembly
 * time, the top-N matching playbook rows for the current task are injected
 * into the prompt as "last time you tried this, here's what worked/failed."
 *
 * This is the ONE intervention that gives Paperclip a compounding learning
 * loop without touching model weights. Without it, every improvement is a
 * one-shot multiplier. With it, every week the system gets cheaper and
 * better at the same tasks.
 */
export const agentPlaybooks = pgTable(
  "agent_playbooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    agentRole: text("agent_role"),
    pattern: text("pattern").notNull(),
    approach: text("approach").notNull().default(""),
    lastInsight: text("last_insight").notNull().default(""),
    successCount: integer("success_count").notNull().default(0),
    failureCount: integer("failure_count").notNull().default(0),
    partialCount: integer("partial_count").notNull().default(0),
    avgIterations: integer("avg_iterations").notNull().default(0),
    avgCostCents: integer("avg_cost_cents").notNull().default(0),
    lastRunId: uuid("last_run_id"),
    lastOutcome: text("last_outcome"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentPatternUniq: uniqueIndex("agent_playbooks_agent_pattern_uniq").on(
      table.agentId,
      table.pattern,
    ),
    companyRoleIdx: index("agent_playbooks_company_role_idx").on(
      table.companyId,
      table.agentRole,
      table.lastUsedAt,
    ),
  }),
);

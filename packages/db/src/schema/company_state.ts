import { pgTable, uuid, text, timestamp, jsonb, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

/**
 * company_state — the shared world model every agent in the company reads at
 * every heartbeat. One row per company.
 *
 * This is the "context waterfall": when the CEO changes strategy, every
 * subordinate agent sees the change in its next heartbeat automatically,
 * without needing to walk a chain of issue comments.
 *
 * Only CEO-role agents can update (enforced in service layer). Every update
 * bumps `version` for optimistic-concurrency and auditing.
 */
export const companyState = pgTable(
  "company_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    strategy: jsonb("strategy").$type<StrategyBlock>().notNull().default({}),
    okrs: jsonb("okrs").$type<OkrEntry[]>().notNull().default([]),
    constraints: jsonb("constraints").$type<ConstraintsBlock>().notNull().default({}),
    recentPivots: jsonb("recent_pivots").$type<PivotEntry[]>().notNull().default([]),
    knownTruths: jsonb("known_truths").$type<TruthEntry[]>().notNull().default([]),
    openDecisions: jsonb("open_decisions").$type<OpenDecisionEntry[]>().notNull().default([]),
    updatedByAgentId: uuid("updated_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUniq: uniqueIndex("company_state_company_uniq").on(table.companyId),
  }),
);

export interface StrategyBlock {
  currentFocus?: string;
  northStar?: string;
  activeBets?: string[];
  killedBets?: string[];
}

export interface OkrEntry {
  objective: string;
  keyResults: string[];
  quarter?: string;
}

export interface ConstraintsBlock {
  runwayMonths?: number;
  monthlyBudgetCents?: number;
  hardDeadlines?: string[];
}

export interface PivotEntry {
  when: string;
  from: string;
  to: string;
  why: string;
}

export interface TruthEntry {
  fact: string;
  source?: string;
  at?: string;
}

export interface OpenDecisionEntry {
  question: string;
  options?: string[];
  blockedWork?: string;
}

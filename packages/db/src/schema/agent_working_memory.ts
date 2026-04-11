import { pgTable, uuid, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

/**
 * agent_working_memory — the agent's live cursor. Survives across heartbeats.
 *
 * Unlike agent_memories (which is a grab-bag log), this is a single-row
 * structured scratchpad per agent. The heartbeat context-assembler reads it
 * and prepends it to the prompt as the FIRST thing the model sees, so the
 * agent resumes work instead of rebuilding the world every tick.
 *
 * Fields:
 *   currentFocus      — one-line "what am I working on right now"
 *   openThreads       — list of concurrent tasks with nextStep + blockedBy
 *   recentDecisions   — last 10 commitments the agent made
 *   expectedResponses — questions the agent asked, who it's waiting on
 *
 * The agent updates this via paperclipUpdateWorkingMemory; a full overwrite
 * each time (structured JSON), not a diff.
 */
export const agentWorkingMemory = pgTable(
  "agent_working_memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    currentFocus: text("current_focus").notNull().default(""),
    openThreads: jsonb("open_threads").$type<OpenThread[]>().notNull().default([]),
    recentDecisions: jsonb("recent_decisions").$type<RecentDecision[]>().notNull().default([]),
    expectedResponses: jsonb("expected_responses").$type<ExpectedResponse[]>().notNull().default([]),
    /**
     * Compiled best-current-understanding. The agent rewrites this whenever
     * its mental model of the current focus changes. It's the "answer" — a
     * mutable, terse paragraph the next heartbeat reads first.
     */
    compiled: text("compiled").notNull().default(""),
    /**
     * Append-only evidence timeline. Each entry is a small object with at
     * minimum {at, kind, text}. Bounded at MAX_TIMELINE entries by the
     * service layer; older entries are dropped on append.
     */
    timeline: jsonb("timeline").$type<MemoryTimelineEntry[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentUniq: uniqueIndex("agent_working_memory_agent_uniq").on(table.agentId),
    companyIdx: index("agent_working_memory_company_idx").on(table.companyId, table.updatedAt),
  }),
);

export interface OpenThread {
  topic: string;
  nextStep: string;
  blockedBy?: string;
  lastTouchedAt?: string;
}

export interface RecentDecision {
  decision: string;
  rationale?: string;
  at?: string;
}

export interface ExpectedResponse {
  question: string;
  waitingOn: string;
  askedAt?: string;
}

export interface MemoryTimelineEntry {
  at: string;
  kind: "observation" | "decision" | "result" | "blocker" | "note";
  text: string;
  runId?: string;
}

import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

/**
 * agent_memories — persistent memories that survive across heartbeats.
 *
 * Agents write memories via the paperclipMemoryWrite tool and read via
 * paperclipMemorySearch. Memories are scoped:
 *   - scope='self'    → visible only to the agent that wrote it
 *   - scope='team'    → visible to the writer's manager and direct reports
 *   - scope='company' → visible to every agent in the company
 *
 * v1 uses plain ILIKE text search. We'll upgrade to pgvector when it
 * becomes the bottleneck.
 *
 * (agent_id, scope, key) is unique so writes with the same key overwrite
 * rather than pile up. Pass a new key to create a new memory.
 */
export const agentMemories = pgTable(
  "agent_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    key: text("key").notNull().default(""),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyScopeIdx: index("agent_memories_company_scope_idx").on(
      table.companyId,
      table.scope,
      table.updatedAt,
    ),
    agentScopeIdx: index("agent_memories_agent_scope_idx").on(
      table.agentId,
      table.scope,
      table.updatedAt,
    ),
    agentKeyScopeUniq: uniqueIndex("agent_memories_agent_key_scope_uniq").on(
      table.agentId,
      table.scope,
      table.key,
    ),
  }),
);

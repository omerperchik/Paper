import { pgTable, uuid, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { integrationAccounts } from "./integration_accounts.js";

// Per-agent binding to a specific integration account. An agent can be
// bound to multiple accounts across multiple providers. When an agent
// calls a provider tool, the route looks up the binding for (agentId,
// provider), falls back to the first company-wide account for that
// provider, and fails if neither exists.

export const integrationBindings = pgTable(
  "integration_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => integrationAccounts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentAccountUq: uniqueIndex("integration_bindings_agent_account_uq").on(
      table.agentId,
      table.accountId,
    ),
    agentIdx: index("integration_bindings_agent_idx").on(table.agentId),
  }),
);

export type IntegrationBinding = typeof integrationBindings.$inferSelect;
export type NewIntegrationBinding = typeof integrationBindings.$inferInsert;

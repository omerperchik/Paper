import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

// Integration requests: an agent can ask the operator to connect a new
// integration (or a different account for an existing provider) while
// it's mid-task. The Settings → Integrations UI surfaces pending
// requests at the top of the section with a one-click "Connect now" CTA
// that opens the paste-token form pre-selected for the requested provider.
//
// Status transitions:
//   pending → fulfilled   (operator connected the integration)
//   pending → declined    (operator rejected the request)
//
// Fulfillment is soft — we just mark the row resolved. The actual
// integration_accounts row is created through the normal create flow.

export const integrationRequests = pgTable(
  "integration_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"), // pending | fulfilled | declined
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: uuid("resolved_by"),
  },
  (table) => ({
    companyStatusIdx: index("integration_requests_company_status_idx").on(
      table.companyId,
      table.status,
    ),
    agentIdx: index("integration_requests_agent_idx").on(table.agentId),
  }),
);

export type IntegrationRequest = typeof integrationRequests.$inferSelect;
export type NewIntegrationRequest = typeof integrationRequests.$inferInsert;

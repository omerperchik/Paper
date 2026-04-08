import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { companies } from "./companies.js";

export const tenantCompanies = pgTable(
  "tenant_companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    clientName: text("client_name"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index("tenant_companies_tenant_idx").on(table.tenantId),
    companyIdx: index("tenant_companies_company_idx").on(table.companyId),
  }),
);

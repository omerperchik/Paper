import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { marketingProducts } from "./marketing_products.js";

export const marketingDashboardSnapshots = pgTable(
  "marketing_dashboard_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    productId: uuid("product_id").references(() => marketingProducts.id),
    snapshotType: text("snapshot_type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyTypeIdx: index("marketing_dashboard_snapshots_company_type_idx").on(table.companyId, table.snapshotType),
    companyPeriodIdx: index("marketing_dashboard_snapshots_company_period_idx").on(table.companyId, table.periodStart, table.periodEnd),
  }),
);

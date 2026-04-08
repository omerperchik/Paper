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

export const marketingCompetitors = pgTable(
  "marketing_competitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    productId: uuid("product_id").references(() => marketingProducts.id),
    name: text("name").notNull(),
    domain: text("domain"),
    monitorConfig: jsonb("monitor_config").$type<Record<string, unknown>>(),
    latestSnapshot: jsonb("latest_snapshot").$type<Record<string, unknown>>(),
    lastScannedAt: timestamp("last_scanned_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("marketing_competitors_company_idx").on(table.companyId),
    companyProductIdx: index("marketing_competitors_company_product_idx").on(table.companyId, table.productId),
  }),
);

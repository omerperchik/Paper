import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { marketingProducts } from "./marketing_products.js";

export const marketingCampaigns = pgTable(
  "marketing_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    productId: uuid("product_id").references(() => marketingProducts.id),
    platform: text("platform").notNull(),
    externalCampaignId: text("external_campaign_id"),
    name: text("name").notNull(),
    campaignType: text("campaign_type").notNull(),
    status: text("status").notNull().default("draft"),
    dailyBudgetCents: integer("daily_budget_cents"),
    totalSpentCents: integer("total_spent_cents").notNull().default(0),
    metrics: jsonb("metrics").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("marketing_campaigns_company_status_idx").on(table.companyId, table.status),
    companyPlatformIdx: index("marketing_campaigns_company_platform_idx").on(table.companyId, table.platform),
    companyProductIdx: index("marketing_campaigns_company_product_idx").on(table.companyId, table.productId),
  }),
);

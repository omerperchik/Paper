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

export const marketingContentItems = pgTable(
  "marketing_content_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    productId: uuid("product_id").references(() => marketingProducts.id),
    contentType: text("content_type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    status: text("status").notNull().default("draft"),
    humanScore: integer("human_score"),
    expertScore: integer("expert_score"),
    seoScore: integer("seo_score"),
    publishUrl: text("publish_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("marketing_content_items_company_status_idx").on(table.companyId, table.status),
    companyContentTypeIdx: index("marketing_content_items_company_type_idx").on(table.companyId, table.contentType),
    companyProductIdx: index("marketing_content_items_company_product_idx").on(table.companyId, table.productId),
  }),
);

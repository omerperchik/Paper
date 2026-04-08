import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const marketplaceItems = pgTable(
  "marketplace_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemType: text("item_type").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    author: text("author"),
    version: text("version"),
    manifest: jsonb("manifest").$type<Record<string, unknown>>(),
    downloads: integer("downloads").notNull().default(0),
    rating: integer("rating"),
    status: text("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    slugUniqueIdx: uniqueIndex("marketplace_items_slug_idx").on(table.slug),
    itemTypeStatusIdx: index("marketplace_items_type_status_idx").on(table.itemType, table.status),
  }),
);

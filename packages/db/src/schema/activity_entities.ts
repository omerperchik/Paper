import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { activityLog } from "./activity_log.js";

/**
 * activity_entities — extracted entity back-links from activity_log rows.
 *
 * After every activity_log row is created, a lightweight extractor scans the
 * `details` JSON for things worth tracking — campaign IDs, ad account labels,
 * URLs, mentions, integration providers — and inserts one row per entity
 * here. The UI surfaces these as clickable pills next to each feed event,
 * and a back-link API returns "everything we know about X".
 *
 * Inspired by gbrain's per-message entity detect → back-link pattern.
 */
export const activityEntities = pgTable(
  "activity_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    activityId: uuid("activity_id").notNull().references(() => activityLog.id, { onDelete: "cascade" }),
    /** e.g. "campaign", "ad_account", "url", "provider", "mention", "issue", "agent" */
    entityType: text("entity_type").notNull(),
    /** Stable key for grouping (lowercased; e.g. campaign id, lowercase domain). */
    entityKey: text("entity_key").notNull(),
    /** Optional display label for the UI (original casing). */
    entityLabel: text("entity_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    entityIdx: index("activity_entities_entity_idx").on(
      table.companyId,
      table.entityType,
      table.entityKey,
      table.createdAt,
    ),
    activityIdx: index("activity_entities_activity_idx").on(table.activityId),
  }),
);

export type ActivityEntity = typeof activityEntities.$inferSelect;
export type NewActivityEntity = typeof activityEntities.$inferInsert;

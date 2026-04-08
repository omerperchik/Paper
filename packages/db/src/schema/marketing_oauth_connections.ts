import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const marketingOauthConnections = pgTable(
  "marketing_oauth_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    platform: text("platform").notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    accountId: text("account_id"),
    accountName: text("account_name"),
    scopes: text("scopes"),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyPlatformIdx: index("marketing_oauth_connections_company_platform_idx").on(table.companyId, table.platform),
    companyStatusIdx: index("marketing_oauth_connections_company_status_idx").on(table.companyId, table.status),
  }),
);

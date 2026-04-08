import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const marketingWhatsappSessions = pgTable(
  "marketing_whatsapp_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    phoneNumber: text("phone_number").notNull(),
    userId: text("user_id"),
    sessionState: jsonb("session_state").$type<Record<string, unknown>>(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyPhoneIdx: index("marketing_whatsapp_sessions_company_phone_idx").on(table.companyId, table.phoneNumber),
  }),
);

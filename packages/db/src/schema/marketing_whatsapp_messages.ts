import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { marketingWhatsappSessions } from "./marketing_whatsapp_sessions.js";

export const marketingWhatsappMessages = pgTable(
  "marketing_whatsapp_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull().references(() => marketingWhatsappSessions.id),
    direction: text("direction").notNull(),
    messageType: text("message_type").notNull(),
    content: text("content"),
    whatsappMessageId: text("whatsapp_message_id"),
    status: text("status").notNull().default("sent"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sessionIdx: index("marketing_whatsapp_messages_session_idx").on(table.sessionId),
    sessionDirectionIdx: index("marketing_whatsapp_messages_session_direction_idx").on(table.sessionId, table.direction),
  }),
);

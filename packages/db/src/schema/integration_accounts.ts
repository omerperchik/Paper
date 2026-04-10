import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { companySecrets } from "./company_secrets.js";

// Integration account: one per (company, provider, label). Holds
// non-secret metadata (account ids, site URLs, etc.) and points at an
// encrypted company_secret row for the sensitive credential blob.
//
// Providers supported at launch:
//   google_ads | facebook_ads | x | reddit | tiktok_ads |
//   github | wordpress | make_ugc | sfmc | firebase
//
// The same provider can be connected multiple times (e.g., two ad
// accounts) — the `label` field disambiguates.

export const integrationAccounts = pgTable(
  "integration_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    provider: text("provider").notNull(),
    label: text("label").notNull(),
    status: text("status").notNull().default("connected"),
    // Points at a company_secrets row whose latest version stores the
    // encrypted credential JSON blob. Nullable so an account row can
    // exist in "disconnected" state without credentials.
    credentialSecretId: uuid("credential_secret_id").references(() => companySecrets.id, {
      onDelete: "set null",
    }),
    // Non-secret metadata the tools need (customerId, adAccountId, siteUrl, projectId, etc.)
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyProviderIdx: index("integration_accounts_company_provider_idx").on(
      table.companyId,
      table.provider,
    ),
    companyProviderLabelUq: uniqueIndex("integration_accounts_company_provider_label_uq").on(
      table.companyId,
      table.provider,
      table.label,
    ),
  }),
);

export type IntegrationAccount = typeof integrationAccounts.$inferSelect;
export type NewIntegrationAccount = typeof integrationAccounts.$inferInsert;

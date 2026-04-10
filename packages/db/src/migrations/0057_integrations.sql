-- 0057: integrations (Google Ads, Facebook Ads, X, Reddit, TikTok Ads,
-- GitHub, WordPress, MakeUGC, Salesforce Marketing Cloud, Firebase).
--
-- Two tables:
-- * integration_accounts — one per (company, provider, label). Holds
--   non-secret metadata. Encrypted credential blob lives in
--   company_secrets (referenced via credential_secret_id).
-- * integration_bindings — per-agent binding to a specific account so
--   different agents can use different ad accounts / repos / sites.

CREATE TABLE "integration_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "label" text NOT NULL,
  "status" text DEFAULT 'connected' NOT NULL,
  "credential_secret_id" uuid,
  "metadata_json" jsonb,
  "last_verified_at" timestamp with time zone,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "integration_accounts"
  ADD CONSTRAINT "integration_accounts_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id");

ALTER TABLE "integration_accounts"
  ADD CONSTRAINT "integration_accounts_credential_secret_id_fk"
  FOREIGN KEY ("credential_secret_id") REFERENCES "company_secrets"("id")
  ON DELETE SET NULL;

CREATE INDEX "integration_accounts_company_provider_idx"
  ON "integration_accounts" ("company_id", "provider");

CREATE UNIQUE INDEX "integration_accounts_company_provider_label_uq"
  ON "integration_accounts" ("company_id", "provider", "label");

CREATE TABLE "integration_bindings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_id" uuid NOT NULL,
  "account_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "integration_bindings"
  ADD CONSTRAINT "integration_bindings_agent_id_fk"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE;

ALTER TABLE "integration_bindings"
  ADD CONSTRAINT "integration_bindings_account_id_fk"
  FOREIGN KEY ("account_id") REFERENCES "integration_accounts"("id") ON DELETE CASCADE;

CREATE UNIQUE INDEX "integration_bindings_agent_account_uq"
  ON "integration_bindings" ("agent_id", "account_id");

CREATE INDEX "integration_bindings_agent_idx"
  ON "integration_bindings" ("agent_id");

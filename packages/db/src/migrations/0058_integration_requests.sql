-- 0058: integration_requests — lets an agent request a new integration
-- during a task. Operators see the request in the Settings → Integrations
-- panel and fulfill it with one click.

CREATE TABLE "integration_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "reason" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid
);

ALTER TABLE "integration_requests"
  ADD CONSTRAINT "integration_requests_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;

ALTER TABLE "integration_requests"
  ADD CONSTRAINT "integration_requests_agent_id_fk"
  FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE;

CREATE INDEX "integration_requests_company_status_idx"
  ON "integration_requests" ("company_id", "status");

CREATE INDEX "integration_requests_agent_idx"
  ON "integration_requests" ("agent_id");

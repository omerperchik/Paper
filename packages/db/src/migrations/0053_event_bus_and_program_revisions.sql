-- 0053: event bus + program.md revision history
--
-- Adds three schema pieces:
--   1. agent_events — append-only event log for agent-to-agent handoffs
--   2. agent_program_revisions — versioned program.md history with proposals + metrics
--   3. routine_triggers.event_kind — new column so triggers can subscribe to events

CREATE TABLE "agent_events" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id" uuid NOT NULL,
    "event_kind" text NOT NULL,
    "source_agent_id" uuid,
    "source_run_id" uuid,
    "source_label" text,
    "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "emitted_at" timestamp with time zone DEFAULT now() NOT NULL,
    "consumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_source_agent_id_agents_id_fk" FOREIGN KEY ("source_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_source_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_events_company_kind_emitted_idx" ON "agent_events" USING btree ("company_id","event_kind","emitted_at");--> statement-breakpoint
CREATE INDEX "agent_events_unconsumed_idx" ON "agent_events" USING btree ("company_id","consumed_at","event_kind");--> statement-breakpoint

CREATE TABLE "agent_program_revisions" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "company_id" uuid NOT NULL,
    "agent_id" uuid NOT NULL,
    "revision_number" integer NOT NULL,
    "status" text DEFAULT 'proposed' NOT NULL,
    "program_md" text NOT NULL,
    "rationale" text,
    "parent_revision_id" uuid,
    "proposed_by_agent_id" uuid,
    "proposed_by_run_id" uuid,
    "approved_by_user_id" text,
    "approved_at" timestamp with time zone,
    "activated_at" timestamp with time zone,
    "superseded_at" timestamp with time zone,
    "reverted_at" timestamp with time zone,
    "reverted_reason" text,
    "metric_name" text,
    "metric_baseline" text,
    "metric_observed" text,
    "metric_observed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_program_revisions" ADD CONSTRAINT "agent_program_revisions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_program_revisions" ADD CONSTRAINT "agent_program_revisions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_program_revisions" ADD CONSTRAINT "agent_program_revisions_parent_revision_id_agent_program_revisions_id_fk" FOREIGN KEY ("parent_revision_id") REFERENCES "public"."agent_program_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_program_revisions" ADD CONSTRAINT "agent_program_revisions_proposed_by_agent_id_agents_id_fk" FOREIGN KEY ("proposed_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_program_revisions" ADD CONSTRAINT "agent_program_revisions_proposed_by_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("proposed_by_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_program_revisions_agent_created_idx" ON "agent_program_revisions" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_program_revisions_agent_status_idx" ON "agent_program_revisions" USING btree ("agent_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_program_revisions_agent_revision_number_uq" ON "agent_program_revisions" USING btree ("agent_id","revision_number");--> statement-breakpoint

ALTER TABLE "routine_triggers" ADD COLUMN "event_kind" text;--> statement-breakpoint
CREATE INDEX "routine_triggers_company_event_kind_idx" ON "routine_triggers" USING btree ("company_id","event_kind");

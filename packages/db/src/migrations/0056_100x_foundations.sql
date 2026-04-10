-- 0056: foundations for the 100x refactor
--
-- Four new tables powering: working memory (live cursor), company state
-- (shared world model), playbooks (learning loop), and wake events
-- (event-driven scheduler). See schema/agent_working_memory.ts,
-- company_state.ts, agent_playbooks.ts, wake_events.ts for the design.

-- agent_working_memory: one row per agent, structured scratchpad
CREATE TABLE "agent_working_memory" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "current_focus" text DEFAULT '' NOT NULL,
  "open_threads" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "recent_decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "expected_responses" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_working_memory" ADD CONSTRAINT "agent_working_memory_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_working_memory" ADD CONSTRAINT "agent_working_memory_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_working_memory_agent_uniq" ON "agent_working_memory" ("agent_id");
--> statement-breakpoint
CREATE INDEX "agent_working_memory_company_idx" ON "agent_working_memory" ("company_id","updated_at");
--> statement-breakpoint

-- company_state: one row per company, shared world model
CREATE TABLE "company_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "strategy" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "okrs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "recent_pivots" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "known_truths" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "open_decisions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "updated_by_agent_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_state" ADD CONSTRAINT "company_state_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company_state" ADD CONSTRAINT "company_state_updated_by_agent_id_agents_id_fk" FOREIGN KEY ("updated_by_agent_id") REFERENCES "agents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "company_state_company_uniq" ON "company_state" ("company_id");
--> statement-breakpoint

-- agent_playbooks: learned-from-experience index
CREATE TABLE "agent_playbooks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "agent_role" text,
  "pattern" text NOT NULL,
  "approach" text DEFAULT '' NOT NULL,
  "last_insight" text DEFAULT '' NOT NULL,
  "success_count" integer DEFAULT 0 NOT NULL,
  "failure_count" integer DEFAULT 0 NOT NULL,
  "partial_count" integer DEFAULT 0 NOT NULL,
  "avg_iterations" integer DEFAULT 0 NOT NULL,
  "avg_cost_cents" integer DEFAULT 0 NOT NULL,
  "last_run_id" uuid,
  "last_outcome" text,
  "last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_playbooks" ADD CONSTRAINT "agent_playbooks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_playbooks" ADD CONSTRAINT "agent_playbooks_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_playbooks_agent_pattern_uniq" ON "agent_playbooks" ("agent_id","pattern");
--> statement-breakpoint
CREATE INDEX "agent_playbooks_company_role_idx" ON "agent_playbooks" ("company_id","agent_role","last_used_at");
--> statement-breakpoint

-- wake_events: event-driven scheduler queue
CREATE TABLE "wake_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "event_type" text NOT NULL,
  "issue_id" uuid,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "dedupe_key" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  "processed_run_id" uuid,
  "processing_error" text
);
--> statement-breakpoint
ALTER TABLE "wake_events" ADD CONSTRAINT "wake_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "wake_events" ADD CONSTRAINT "wake_events_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "wake_events_pending_idx" ON "wake_events" ("processed_at","created_at");
--> statement-breakpoint
CREATE INDEX "wake_events_agent_pending_idx" ON "wake_events" ("agent_id","processed_at");
--> statement-breakpoint
CREATE INDEX "wake_events_dedupe_idx" ON "wake_events" ("dedupe_key");

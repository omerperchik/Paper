-- 0055: persistent memories for agents
--
-- Agents write memories via paperclipMemoryWrite and read them via
-- paperclipMemorySearch. Scoped self/team/company. v1 is plain text (ILIKE)
-- search; pgvector upgrade happens when this becomes the bottleneck.

CREATE TABLE "agent_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "agent_id" uuid NOT NULL,
  "scope" text NOT NULL,
  "key" text DEFAULT '' NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "agent_memories_company_scope_idx" ON "agent_memories" ("company_id","scope","updated_at");
--> statement-breakpoint
CREATE INDEX "agent_memories_agent_scope_idx" ON "agent_memories" ("agent_id","scope","updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_memories_agent_key_scope_uniq" ON "agent_memories" ("agent_id","scope","key");

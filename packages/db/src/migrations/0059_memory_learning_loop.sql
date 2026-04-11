-- 0059: memory + learning loop — gbrain-inspired upgrades.
--
-- Three things in one migration because they share a release:
--
-- 1. working_memory gains `compiled` (mutable best-current-understanding)
--    and `timeline` (append-only evidence log). Gives agents "the answer +
--    the proof" and makes chairman audits trivial.
--
-- 2. pgvector extension + `embedding` column on agent_playbooks. Enables
--    hybrid RRF (keyword + vector) recall. Populated lazily — nullable
--    and queries fall back to keyword-only when absent.
--
-- 3. activity_entities — extracted entities (campaigns, accounts, urls,
--    people) linked back to the activity_log row they came from. Powers
--    "everything we know about X" back-links in the UI.

-- === 1. working memory: compiled + timeline ===
ALTER TABLE "agent_working_memory"
  ADD COLUMN "compiled" text DEFAULT '' NOT NULL;

ALTER TABLE "agent_working_memory"
  ADD COLUMN "timeline" jsonb DEFAULT '[]'::jsonb NOT NULL;

-- === 2. pgvector extension + playbook embeddings ===
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "agent_playbooks"
  ADD COLUMN "embedding" vector(1536);

-- IVFFlat index for approximate nearest neighbor. Created empty; will
-- start returning meaningful results once we populate the column.
-- Small list count since the table is small in v1; tune later.
CREATE INDEX IF NOT EXISTS "agent_playbooks_embedding_idx"
  ON "agent_playbooks"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 50);

-- === 3. activity_entities: extracted entity back-links ===
CREATE TABLE "activity_entities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "activity_id" uuid NOT NULL,
  "entity_type" text NOT NULL,
  "entity_key" text NOT NULL,
  "entity_label" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "activity_entities"
  ADD CONSTRAINT "activity_entities_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;

ALTER TABLE "activity_entities"
  ADD CONSTRAINT "activity_entities_activity_id_fk"
  FOREIGN KEY ("activity_id") REFERENCES "activity_log"("id") ON DELETE CASCADE;

CREATE INDEX "activity_entities_entity_idx"
  ON "activity_entities" ("company_id", "entity_type", "entity_key", "created_at");

CREATE INDEX "activity_entities_activity_idx"
  ON "activity_entities" ("activity_id");

-- 0054: add failure_class column to heartbeat_runs for structured failure taxonomy
--
-- errorCode is a coarse bucket set at a single call site (mostly "adapter_failed"),
-- which hides the actual failure mode. failure_class is a standardized taxonomy
-- populated by a pure classifier function so we can finally answer "where are the
-- failures coming from" without psql archaeology.

ALTER TABLE "heartbeat_runs" ADD COLUMN "failure_class" text;
--> statement-breakpoint
CREATE INDEX "heartbeat_runs_company_failure_class_idx" ON "heartbeat_runs" ("company_id","failure_class","started_at");

-- seed-autoresearch-and-program-md.sql
--
-- Adds two new agents to the 'ACME' company:
--   1. "AutoResearch Director" — daily review of /opt/autoresearch/results.tsv
--   2. "Meta Optimizer"        — weekly review of every marketing agent's program.md
--
-- Also seeds a baseline program.md payload into agents.metadata for every
-- existing gemma_local marketing agent, under metadata.programMd (a string).
--
-- Idempotent: safe to re-run. Uses ON CONFLICT / DO NOTHING where possible.

\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Anchors: company, project, adapter_config template
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_company_id uuid;
  v_project_id uuid;
  v_adapter_config jsonb;
  v_director_id uuid := 'c0000001-d000-4000-8000-000000000001'::uuid;
  v_optimizer_id uuid := 'c0000001-d000-4000-8000-000000000002'::uuid;
  v_director_routine uuid;
  v_optimizer_routine uuid;
BEGIN
  SELECT id INTO v_company_id FROM companies WHERE name = 'ACME' LIMIT 1;
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'ACME company not found';
  END IF;

  SELECT id INTO v_project_id FROM projects WHERE company_id = v_company_id AND name = 'Any.do' LIMIT 1;
  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Any.do project not found';
  END IF;

  -- Reuse the adapter_config from an existing working agent (AD Growth Orchestrator)
  SELECT adapter_config INTO v_adapter_config FROM agents WHERE name = 'AD Growth Orchestrator' LIMIT 1;
  IF v_adapter_config IS NULL THEN
    RAISE EXCEPTION 'AD Growth Orchestrator adapter_config not found (cannot clone)';
  END IF;

  -- -------------------------------------------------------------------------
  -- 1. AutoResearch Director
  -- -------------------------------------------------------------------------
  INSERT INTO agents (id, company_id, name, role, title, status, adapter_type, adapter_config, runtime_config, metadata, capabilities)
  VALUES (
    v_director_id,
    v_company_id,
    'AutoResearch Director',
    'research',
    'AutoResearch Director',
    'active',
    'gemma_local',
    v_adapter_config,
    '{}'::jsonb,
    jsonb_build_object(
      'programMd',
      '# AutoResearch Director

## Identity
- Name: AutoResearch Director
- Role: Review /opt/autoresearch/results.tsv daily, identify winners, update program.md with next-night hypotheses.
- Reports to: Omer Perchik (human operator)
- North-star metric: val_bpb (lower is better) on the MLX training loop. Secondary: number of "keep" outcomes per week.

## Protocol
1. Read /opt/autoresearch/results.tsv (append-only log of every experiment).
2. Diff the tail vs what was read yesterday — report new experiments and their outcomes.
3. For any row with a val_bpb improvement ≥ 1% vs the current best: mark as a notable win, describe the change (read the commit diff on train.py at the relevant hash), open an issue in the Any.do project titled "AutoResearch win: <hash>".
4. Update /opt/autoresearch/program.md — append any new backlog items or adjust priorities.
5. Never modify /opt/autoresearch/train.py directly. The Mac-side agent owns that file.
6. WhatsApp notify the operator with a one-paragraph digest: X experiments run, Y kept, best val_bpb = Z.

## Hard rules
- Do not ssh to the Mac. The bridge is one-way (Mac pushes results → VPS).
- Do not delete rows from results.tsv.
- If results.tsv is empty or unchanged from yesterday, report "no activity" and exit cleanly.'
    ),
    'Reads autoresearch results.tsv, plans next experiments, notifies operator'
  )
  ON CONFLICT (id) DO UPDATE SET
    adapter_config = EXCLUDED.adapter_config,
    metadata = EXCLUDED.metadata,
    status = 'active';

  -- Routine for the Director — daily at 07:00 UTC
  INSERT INTO routines (
    company_id, project_id, title, description, assignee_agent_id, status,
    concurrency_policy, catch_up_policy, priority, variables
  )
  VALUES (
    v_company_id,
    v_project_id,
    'Daily AutoResearch Review',
    'Read results.tsv, identify winners, update program.md, notify operator.',
    v_director_id,
    'active',
    'skip_if_active',
    'skip_missed',
    'medium',
    '[]'::jsonb
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_director_routine;

  IF v_director_routine IS NULL THEN
    SELECT id INTO v_director_routine FROM routines
      WHERE company_id = v_company_id AND assignee_agent_id = v_director_id AND title = 'Daily AutoResearch Review'
      LIMIT 1;
  END IF;

  INSERT INTO routine_triggers (company_id, routine_id, kind, label, enabled, cron_expression, timezone, next_run_at)
  VALUES (
    v_company_id,
    v_director_routine,
    'cron',
    'daily 07:00 UTC',
    true,
    '0 7 * * *',
    'UTC',
    (date_trunc('day', NOW() AT TIME ZONE 'UTC') + interval '1 day' + interval '7 hours') AT TIME ZONE 'UTC'
  )
  ON CONFLICT DO NOTHING;

  -- -------------------------------------------------------------------------
  -- 2. Meta Optimizer
  -- -------------------------------------------------------------------------
  INSERT INTO agents (id, company_id, name, role, title, status, adapter_type, adapter_config, runtime_config, metadata, capabilities)
  VALUES (
    v_optimizer_id,
    v_company_id,
    'Meta Optimizer',
    'research',
    'Meta Optimizer',
    'active',
    'gemma_local',
    v_adapter_config,
    '{}'::jsonb,
    jsonb_build_object(
      'programMd',
      '# Meta Optimizer

## Identity
- Name: Meta Optimizer
- Role: Weekly review of every marketing agent''s program.md. Propose hypothesis updates based on observed run performance.
- Reports to: Omer Perchik (human operator)
- North-star metric: weekly count of shipped hypothesis improvements that stick (i.e., kept across two successive weekly reviews).

## Protocol
1. For each agent with a metadata.programMd field, read that agent''s:
   - current programMd
   - last 7 days of heartbeat_runs (count, success rate, latency, output summaries)
   - any metric history embedded in the programMd
2. Decide per agent: keep | revise_hypothesis | promote_backlog_item.
3. For each agent needing an update, draft a new programMd and open an issue in the Any.do project titled "Meta Optimizer proposal: <agent name>".
4. Never write directly to agents.metadata.programMd. Only propose via issues.
5. After drafting all proposals, WhatsApp-notify the operator: "N proposals this week, review at /issues".

## Hard rules
- Only propose changes; the human approves via comment "approve" on the issue, at which point a separate approval flow writes the new programMd.
- If an agent has no metadata.programMd yet, create an empty baseline one and flag it for first-time review.
- Do not modify programs for agents whose status is not active.'
    ),
    'Weekly review of every marketing agent program.md — proposes updates'
  )
  ON CONFLICT (id) DO UPDATE SET
    adapter_config = EXCLUDED.adapter_config,
    metadata = EXCLUDED.metadata,
    status = 'active';

  -- Routine for Meta Optimizer — Mondays at 09:00 UTC
  INSERT INTO routines (
    company_id, project_id, title, description, assignee_agent_id, status,
    concurrency_policy, catch_up_policy, priority, variables
  )
  VALUES (
    v_company_id,
    v_project_id,
    'Weekly Meta Optimizer Review',
    'Review every marketing agent program.md, propose updates, open issues for approval.',
    v_optimizer_id,
    'active',
    'skip_if_active',
    'skip_missed',
    'medium',
    '[]'::jsonb
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_optimizer_routine;

  IF v_optimizer_routine IS NULL THEN
    SELECT id INTO v_optimizer_routine FROM routines
      WHERE company_id = v_company_id AND assignee_agent_id = v_optimizer_id AND title = 'Weekly Meta Optimizer Review'
      LIMIT 1;
  END IF;

  INSERT INTO routine_triggers (company_id, routine_id, kind, label, enabled, cron_expression, timezone, next_run_at)
  VALUES (
    v_company_id,
    v_optimizer_routine,
    'cron',
    'weekly Mon 09:00 UTC',
    true,
    '0 9 * * 1',
    'UTC',
    -- next Monday at 09:00 UTC
    ((date_trunc('week', NOW() AT TIME ZONE 'UTC') + interval '7 days' + interval '9 hours') AT TIME ZONE 'UTC')
  )
  ON CONFLICT DO NOTHING;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Baseline program.md for every existing gemma_local marketing agent
-- ---------------------------------------------------------------------------
UPDATE agents
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
  'programMd',
  '# ' || name || '

## Identity
- Name: ' || name || '
- Role: (seed — please fill in)
- Reports to: Omer Perchik (human operator)
- North-star metric: (seed — please fill in the ONE metric this agent optimizes)

## Hypothesis
- Current: (none — baseline)
- Started: ' || to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD') || '
- Evidence so far:
  - (none yet — first week of tracking)

## Protocol
- Follow the existing system prompt and skill configuration.
- On every run, append a one-line summary to this program.md metric history if you observed any numeric change to the north-star metric.

## Metric history
| Date | Value | Δ vs last | Change | Kept? |
|---|---:|---|---|---|
| ' || to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD') || ' | — | — | baseline (first seed) | — |

## Known-bad ideas
- (none yet)

## Backlog
- (Meta Optimizer will propose items here starting next Monday)
'
)
WHERE adapter_type = 'gemma_local'
  AND name NOT IN ('AutoResearch Director', 'Meta Optimizer')
  AND (metadata IS NULL OR NOT (metadata ? 'programMd'));

-- Summary of what was seeded
SELECT name, role, status,
  (metadata ? 'programMd') AS has_program_md,
  LENGTH(metadata->>'programMd') AS program_md_len
FROM agents
WHERE adapter_type = 'gemma_local'
ORDER BY name;

COMMIT;

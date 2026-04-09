# Paperclip agent `program.md` template

This is the Karpathy-style "research org code" for a single Paperclip marketing agent. The human (operator) edits this file. The agent reads it as part of its runtime context. The Meta Optimizer agent proposes edits to it weekly based on observed performance, gated behind human approval.

The goal: turn each agent from a static prompt into an iterative experimenter. One mutable Markdown file per agent, version-controlled via Paperclip's audit log (`agents.metadata.programMdHistory`), with an explicit hypothesis-metric-result loop.

---

## Sections (every agent `program.md` must include these)

### 1. Identity
- **Name:** `<agent name>`
- **Role:** one sentence. What single outcome this agent is responsible for.
- **Reports to:** which orchestrator or which human.
- **North-star metric:** the ONE metric this agent optimizes. Must be numeric and measurable from available data sources.

### 2. Hypothesis
- The **current** active hypothesis. One sentence: "If we do X, then Y will improve by Z%".
- **Started:** YYYY-MM-DD
- **Evidence so far:** bullet list of what has been observed during this hypothesis window.

### 3. Protocol
- What the agent actually does on each run. Step-by-step. Paperclip routines should map 1:1 to protocol steps.
- Approved tool calls (whitelisted WhatsApp notifications, plugin tools, etc.).
- Hard rules ("NEVER auto-publish content without approval", "MUST log every metric change to `results.tsv` equivalent").

### 4. Metric history
- Append-only table of `{date, metric_value, delta_vs_last_week, change_description, kept_or_reverted}` rows.
- This is the equivalent of `results.tsv` in autoresearch.

### 5. Known-bad ideas
- Things the agent (or a previous hypothesis iteration) has tried and found to hurt the metric. Prevents regression loops.

### 6. Backlog (hypothesis queue)
- Ordered list of candidate next hypotheses to try after the current one concludes.
- Meta Optimizer proposes additions here. Human approves before they move into `Hypothesis`.

---

## Example: FB Growth Orchestrator

```markdown
### 1. Identity
- Name: FB Growth Orchestrator
- Role: Increase Facebook paid-social CAC efficiency for Any.do Consumer segment.
- Reports to: Omer Perchik (human operator)
- North-star metric: CAC (USD per first-week-retained user) on Meta paid channels.

### 2. Hypothesis
- Current: "If we shift 30% of the Meta spend from prospecting to lookalike-of-D30-retained, then blended CAC will drop ≥8% within 10 days."
- Started: 2026-04-05
- Evidence so far:
  - Day 1–3: CAC flat, installs -12% (expected, narrower audience)
  - Day 4: D7 retention on the lookalike cohort is 18% vs 11% control

### 3. Protocol
- Every 2 hours: pull Meta spend + installs + D1 retention from the data source.
- Daily at 09:00 UTC: compute CAC, write to metric history.
- If CAC alert threshold breached → WhatsApp notification to operator, pause spend.
- NEVER launch new ad sets without approval.

### 4. Metric history
| Date | CAC (USD) | Δ vs last week | Change | Kept? |
|---|---:|---|---|---|
| 2026-04-02 | 3.80 | — | baseline | — |
| 2026-04-05 | 3.91 | +2.9% | shift 30% to lookalike | pending |
| 2026-04-08 | 3.52 | -7.4% | (same) | keep — crossed 7-day significance |

### 5. Known-bad ideas
- Broad interest targeting on Meta (tried 2026-03-15, CAC +22%).
- UGC-only creative on Google UAC (tried 2026-03-20, install volume collapsed).

### 6. Backlog
1. Test D7 retention as the sole optimization goal (not just CAC proxy).
2. Add a creative-freshness decay penalty to the bid model.
3. Cross-test Apple Search Ads as a secondary paid channel.
```

---

## How Meta Optimizer proposes edits

The Meta Optimizer agent runs weekly (cron: `0 9 * * 1`, Mondays at 09:00 UTC). For each marketing agent:

1. Read `agents.metadata.programMd` (the current `program.md`).
2. Read the last 7 days of `heartbeat_runs` for that agent (success rate, avg latency, output summaries).
3. Read the agent's north-star metric from the relevant data source.
4. Decide: **keep**, **revise hypothesis**, or **promote a backlog item**.
5. Write the proposed new `program.md` into an issue in the `Meta-Optimizer` project, tagged with the agent's name.
6. Notify via WhatsApp: "Meta Optimizer has proposals for N agents this week, review at /issues?project=meta-optimizer".
7. Human reviews + approves. On approval, the new `program.md` is written to `agents.metadata.programMd` and the old one is appended to `agents.metadata.programMdHistory`.

No code changes to the agent are required — the `program.md` lives in the `metadata` JSONB column and the agent's system prompt loader reads it at every run.

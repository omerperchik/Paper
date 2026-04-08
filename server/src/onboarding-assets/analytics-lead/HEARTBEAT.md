# HEARTBEAT.md -- Analytics Lead Heartbeat Checklist

Run this checklist on every heartbeat. This covers both your local planning/memory work and your organizational coordination via the Paperclip skill.

## 1. Identity and Context

- `GET /api/agents/me` -- confirm your id, role, budget, chainOfCommand.
- Check wake context: `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`.

## 2. Local Planning Check

1. Read today's plan from `./memory/YYYY-MM-DD.md` under "## Today's Plan".
2. Review each planned item: what's completed, what's blocked, what's next.
3. For any blockers, resolve them yourself or escalate to the CMO.
4. Record progress updates in the daily notes.

## 3. Pull All Marketing Data Sources

1. Connect to all active data sources: GA4, Amplitude, ad platform APIs, email platform metrics, CRM pipeline data.
2. Validate data freshness. If any source is stale by more than 24 hours, flag it and note the gap.
3. Reconcile cross-platform discrepancies. Ad platform numbers rarely match analytics numbers -- document the delta.
4. Store raw pulls in `./data/YYYY-MM-DD/` for auditability.

## 4. Calculate Daily CAC by Channel

1. Pull spend data from each paid channel (Meta, Google, LinkedIn, etc.).
2. Pull conversion data from the attribution model.
3. Calculate channel-specific CAC: total channel spend / attributed conversions.
4. Calculate blended CAC: total marketing spend / total new customers.
5. Compare to trailing 7-day and 30-day averages. Flag any channel where CAC increased more than 15%.
6. Update the CAC tracking dashboard.

## 5. Run Anomaly Detection on Key Metrics

1. Pull current values for: conversion rate, CPA, CTR, bounce rate, revenue per session, signup rate, activation rate.
2. Compare each metric against its rolling 14-day average and standard deviation.
3. Flag any metric outside 2 standard deviations as an anomaly.
4. For each anomaly: identify the likely cause (channel shift, creative fatigue, technical issue, seasonal pattern).
5. If the anomaly is real and actionable, create an issue for the responsible agent.

## 6. Score Ongoing Experiments

1. Pull current data for all running A/B tests and experiments.
2. Calculate current effect size, confidence interval, and statistical significance for each.
3. For experiments that have reached significance: mark as winner/loser, draft a summary, recommend next steps.
4. For experiments still running: estimate days remaining to reach minimum sample size.
5. Flag any experiment that has been running longer than its planned duration without reaching significance.
6. Update the experiment playbook.

## 7. Generate Daily Analytics Brief

1. Compile: top-line KPIs (CAC, LTV, ROAS, MRR), channel performance table, experiment status, anomaly alerts.
2. Write a 3-5 sentence executive summary: what changed, why, and what to do about it.
3. Post the brief as a comment on the daily marketing standup issue.

## 8. Flag Concerning Trends to CMO

1. Review week-over-week and month-over-month trends for CAC, LTV:CAC ratio, payback period, and ROAS.
2. If any trend is negative for 3+ consecutive days, escalate to the CMO with data and a recommended investigation.
3. If LTV:CAC drops below 3:1 on any channel, flag for immediate review.

## 9. Approval Follow-Up

If `PAPERCLIP_APPROVAL_ID` is set:

- Review the approval and its linked issues.
- Close resolved issues or comment on what remains open.

## 10. Get Assignments

- `GET /api/companies/{companyId}/issues?assigneeAgentId={your-id}&status=todo,in_progress,in_review,blocked`
- Prioritize: `in_progress` first, then `in_review` when woken by a comment, then `todo`.
- If there is already an active run on an `in_progress` task, move to the next thing.
- If `PAPERCLIP_TASK_ID` is set and assigned to you, prioritize that task.

## 11. Checkout and Work

- Always checkout before working: `POST /api/issues/{id}/checkout`.
- Never retry a 409 -- that task belongs to someone else.
- Do the work. Update status and comment when done.

## 12. Fact Extraction

1. Check for new conversations since last extraction.
2. Extract durable facts to the relevant entity in `./life/` (PARA).
3. Update `./memory/YYYY-MM-DD.md` with timeline entries.
4. Update access metadata (timestamp, access_count) for any referenced facts.

## 13. Exit

- Comment on any in_progress work before exiting.
- If no assignments and no valid mention-handoff, exit cleanly.

---

## Analytics Lead Responsibilities

- Marketing measurement: Own dashboards, attribution, and KPI tracking for all channels.
- Experimentation: Run statistical tests, maintain the experiment playbook, promote winners.
- Anomaly detection: Monitor key metrics daily, alert the team on deviations.
- Daily briefs: Deliver daily performance summaries to the CMO and marketing team.
- Data integrity: Validate tracking, reconcile sources, audit data quality.
- Never speculate without data. If the data is insufficient, say so and propose how to get better data.

## Rules

- Always use the Paperclip skill for coordination.
- Always include `X-Paperclip-Run-Id` header on mutating API calls.
- Comment in concise markdown: status line + bullets + links.
- Self-assign via checkout only when explicitly @-mentioned.

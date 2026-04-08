# HEARTBEAT.md -- Paid Acquisition Specialist Heartbeat Checklist

Run this checklist on every heartbeat. This covers both your local planning/memory work and your organizational coordination via the Paperclip skill.

## 1. Identity and Context

- `GET /api/agents/me` -- confirm your id, role, budget, chainOfCommand.
- Check wake context: `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`.

## 2. Local Planning Check

1. Read today's plan from `./memory/YYYY-MM-DD.md` under "## Today's Plan".
2. Review each planned item: what's completed, what's blocked, what's next.
3. Pull campaign performance data from all active platforms (Google, Meta, TikTok, LinkedIn).
4. Flag any campaigns where CPA exceeds target by more than 20% or spend pacing is off.
5. Record performance snapshots and optimization actions in the daily notes.

## 3. Approval Follow-Up

If `PAPERCLIP_APPROVAL_ID` is set:

- Review the approval and its linked issues.
- Close resolved issues or comment on what remains open.

## 4. Get Assignments

- `GET /api/companies/{companyId}/issues?assigneeAgentId={your-id}&status=todo,in_progress,in_review,blocked`
- Prioritize: `in_progress` first, then `in_review` when you were woken by a comment on it, then `todo`. Skip `blocked` unless you can unblock it.
- If there is already an active run on an `in_progress` task, just move on to the next thing.
- If `PAPERCLIP_TASK_ID` is set and assigned to you, prioritize that task.

## 5. Checkout and Work

- Always checkout before working: `POST /api/issues/{id}/checkout`.
- Never retry a 409 -- that task belongs to someone else.
- Do the work. Types of paid acquisition work:
  - **Performance Review**: Pull metrics, identify overspending/underspending campaigns, recommend pauses or scaling.
  - **Campaign Optimization**: Adjust bids, budgets, audiences, or placements based on performance data.
  - **Creative Refresh**: Generate new ad copy variations, recommend creative concepts for testing, retire fatigued assets.
  - **Budget Reallocation**: Submit proposals to shift spend between channels or campaigns based on CAC/ROAS trends.
  - **New Campaign Launch**: Structure campaigns, define audiences, set bid strategies, prepare tracking.
  - **Reporting**: Compile channel-level and campaign-level metrics with actionable recommendations.
- Update status and comment when done.

## 6. Delegation

- Create subtasks with `POST /api/companies/{companyId}/issues`. Always set `parentId` and `goalId`. For non-child follow-ups that must stay on the same checkout/worktree, set `inheritExecutionWorkspaceFromIssueId` to the source issue.
- Delegate creative production to the content team when new ad assets are needed.
- Delegate landing page changes to the conversion optimizer.
- Assign analytics deep-dives to the analytics lead when attribution questions arise.

## 7. Fact Extraction

1. Check for new conversations since last extraction.
2. Extract durable facts to the relevant entity in `./life/` (PARA).
3. Update `./memory/YYYY-MM-DD.md` with timeline entries.
4. Update access metadata (timestamp, access_count) for any referenced facts.
5. Record CAC trend data points by channel for longitudinal tracking.

## 8. Exit

- Comment on any in_progress work before exiting.
- If no assignments and no valid mention-handoff, exit cleanly.

---

## Paid Acquisition Responsibilities

- Daily budget optimization: Shift spend to best-performing campaigns and channels.
- Campaign health monitoring: Pause underperformers, scale winners, flag anomalies.
- Creative testing: Maintain active A/B tests across platforms; always have a next test queued.
- CAC tracking: Report daily CAC by channel; escalate when trends move in the wrong direction.
- Budget proposals: Submit reallocation recommendations to the CMO with supporting data.
- Platform hygiene: Maintain negative keyword lists, exclusion audiences, UTM consistency.
- Never spend without measurement. If tracking breaks, pause and fix before resuming spend.

## Rules

- Always use the Paperclip skill for coordination.
- Always include `X-Paperclip-Run-Id` header on mutating API calls.
- Comment in concise markdown: metric summary + bullets + recommended actions.
- Self-assign via checkout only when explicitly @-mentioned.

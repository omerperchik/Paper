# HEARTBEAT.md -- CEO Heartbeat Checklist

Run this checklist on every heartbeat.

## 0. First-Run Detection

Before anything else, check if this is a first run:

1. `GET /api/agents/me` — get your agent id and company id.
2. `GET /api/companies/{companyId}/agents` — list all agents in the company.
3. If you are the ONLY agent, this is a first run. **Go directly to the Product Discovery Protocol in AGENTS.md Phase 1.** Start by posting your FIRST question (just one!) as a comment on your onboarding task, then exit.
4. If you previously posted a question (check your task comments), check if the Chairman has replied:
   - **If the Chairman replied:** Acknowledge briefly, then either ask the next question OR (if you just got the product URL) run Phase 1b online research. Then exit and wait.
   - **If no reply yet:** Exit cleanly. Do not re-ask or nag.
5. If you posted a strategy proposal, check comments for "approved" or feedback. If approved → Phase 3. If feedback → revise.
6. If the team is provisioned, proceed with normal heartbeat below.

## 1. Identity and Context

- `GET /api/agents/me` -- confirm your id, role, budget, chainOfCommand.
- Check wake context: `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`.

## 2. Local Planning Check

1. Read today's plan from `./memory/YYYY-MM-DD.md` under "## Today's Plan".
2. Review each planned item: what's completed, what's blocked, what's next.
3. For any blockers, resolve them yourself or escalate to the Chairman.
4. Record progress updates in daily notes.

## 3. Approval Follow-Up

If `PAPERCLIP_APPROVAL_ID` is set:

- Review the approval and its linked issues.
- Close resolved issues or comment on what remains open.

## 4. Get Assignments

- `GET /api/companies/{companyId}/issues?assigneeAgentId={your-id}&status=todo,in_progress,in_review,blocked`
- Prioritize: `in_progress` first, then `in_review` when woken by comment, then `todo`.
- If there is already an active run on an `in_progress` task, move on.
- If `PAPERCLIP_TASK_ID` is set and assigned to you, prioritize that task.

## 5. Checkout and Work

- Always checkout before working: `POST /api/issues/{id}/checkout`.
- Never retry a 409.
- Do the work. Update status and comment when done.

## 6. Delegation

- Create subtasks with `POST /api/companies/{companyId}/issues`. Set `parentId` and `goalId`.
- Use `paperclip-create-agent` skill when hiring new agents.
- Assign work to the right agent for the job.

## 7. Fact Extraction

1. Extract durable facts to `./life/` (PARA).
2. Update `./memory/YYYY-MM-DD.md` with timeline entries.

## 8. Exit

- Comment on any in_progress work before exiting.
- If no assignments and no valid mention-handoff, exit cleanly.

---

## CEO Responsibilities

- Product Discovery: interview the Chairman, research the product online
- Marketing Strategy: design the plan based on real data and Chairman input
- Hiring: create and fully define new agents on demand
- Delegation: route work to the right specialist
- Unblocking: resolve blockers for reports
- Budget: above 80% spend, focus only on critical tasks
- Never look for unassigned work
- Never cancel cross-team tasks — reassign with a comment

## Rules

- Always use the Paperclip skill for coordination.
- Always include `X-Paperclip-Run-Id` header on mutating API calls.
- Post ONE question per comment. Never batch questions.
- Be conversational and direct. No corporate fluff.
- NEVER skip the discovery interview.
- NEVER provision agents before the strategy is approved.
- NEVER assume anything about the product — research it and ask.

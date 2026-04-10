// team-feed service — unified view of what agents in a team (a manager's
// reports_to subtree) have been doing. Unions several existing tables into a
// single chronological stream and also produces per-agent leaderboard
// counts. No new tables — reads heartbeat_runs, issues, issue_comments,
// approvals, and agent_memories.
//
// This is the visibility layer Geoff described: "If you're not making it
// visible, you're leaving the most powerful adoption lever on the table."

import { and, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agentMemories,
  agents,
  approvals,
  heartbeatRuns,
  issueComments,
  issues,
} from "@paperclipai/db";

export type FeedEventType =
  | "heartbeat_run"
  | "issue_created"
  | "issue_updated"
  | "comment"
  | "memory_written"
  | "human_question"
  | "human_answer";

export interface FeedEvent {
  id: string;
  type: FeedEventType;
  ts: string; // ISO
  agentId: string | null;
  agentName: string | null;
  summary: string;
  link: string | null; // optional UI path
  payload: Record<string, unknown>;
}

export interface LeaderboardRow {
  agentId: string;
  agentName: string;
  role: string | null;
  reportsTo: string | null;
  heartbeatRunsOk: number;
  heartbeatRunsFailed: number;
  issuesCreated: number;
  commentsPosted: number;
  memoriesWritten: number;
  humanQuestionsAsked: number;
}

function parseWindow(window: string | undefined): Date {
  const now = Date.now();
  if (!window) return new Date(now - 7 * 24 * 60 * 60 * 1000);
  const match = /^(\d+)([hdw])$/.exec(window);
  if (!match) return new Date(now - 7 * 24 * 60 * 60 * 1000);
  const n = Number(match[1]);
  const unit = match[2];
  const ms = unit === "h" ? 3_600_000 : unit === "d" ? 86_400_000 : 604_800_000;
  return new Date(now - n * ms);
}

export function teamFeedService(db: Db) {
  /**
   * Resolve the set of agent ids in a manager's subtree (the manager + all
   * transitively reporting agents). If managerId is null, returns every
   * agent in the company.
   */
  async function resolveSubtree(companyId: string, managerId: string | null): Promise<{
    ids: string[];
    nameById: Map<string, string>;
    agentsById: Map<string, { id: string; name: string; role: string | null; reportsTo: string | null }>;
  }> {
    const all = await db
      .select({
        id: agents.id,
        name: agents.name,
        role: agents.role,
        reportsTo: agents.reportsTo,
      })
      .from(agents)
      .where(eq(agents.companyId, companyId));

    const agentsById = new Map<string, { id: string; name: string; role: string | null; reportsTo: string | null }>();
    const nameById = new Map<string, string>();
    for (const a of all) {
      agentsById.set(a.id, { id: a.id, name: a.name, role: a.role ?? null, reportsTo: a.reportsTo ?? null });
      nameById.set(a.id, a.name);
    }

    if (!managerId) {
      return { ids: all.map((a) => a.id), nameById, agentsById };
    }

    const result = new Set<string>();
    const stack = [managerId];
    while (stack.length > 0) {
      const next = stack.pop();
      if (!next || result.has(next)) continue;
      if (!agentsById.has(next)) continue;
      result.add(next);
      for (const a of all) {
        if (a.reportsTo === next) stack.push(a.id);
      }
    }
    return { ids: Array.from(result), nameById, agentsById };
  }

  return {
    /**
     * Returns the last N events across the agent subtree, newest first.
     * Events are pulled from each source table (heartbeat_runs, issues,
     * issue_comments, approvals, agent_memories), normalized, merged, and
     * sorted in-memory. Fine for small to mid-sized teams; upgrade to a
     * materialized view if it gets slow.
     */
    async listFeed(
      companyId: string,
      managerId: string | null,
      limit: number,
    ): Promise<FeedEvent[]> {
      const { ids: agentIds, nameById } = await resolveSubtree(companyId, managerId);
      if (agentIds.length === 0) return [];

      const pullLimit = Math.max(limit, 50);
      const events: FeedEvent[] = [];

      // Heartbeat runs (succeeded or failed)
      const runs = await db
        .select({
          id: heartbeatRuns.id,
          agentId: heartbeatRuns.agentId,
          status: heartbeatRuns.status,
          startedAt: heartbeatRuns.startedAt,
          finishedAt: heartbeatRuns.finishedAt,
          error: heartbeatRuns.error,
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.agentId, agentIds),
            isNotNull(heartbeatRuns.startedAt),
          ),
        )
        .orderBy(desc(heartbeatRuns.startedAt))
        .limit(pullLimit);
      for (const r of runs) {
        if (!r.startedAt) continue;
        events.push({
          id: `run:${r.id}`,
          type: "heartbeat_run",
          ts: (r.finishedAt ?? r.startedAt).toISOString(),
          agentId: r.agentId,
          agentName: nameById.get(r.agentId) ?? null,
          summary:
            r.status === "succeeded"
              ? `heartbeat ok`
              : r.status === "running"
                ? `heartbeat running`
                : `heartbeat ${r.status}${r.error ? `: ${r.error.slice(0, 80)}` : ""}`,
          link: null,
          payload: { status: r.status, runId: r.id },
        });
      }

      // Issues created by these agents (via metadata? We only track
      // assignee_agent_id. Use createdAt as the event timestamp.)
      const recentIssues = await db
        .select({
          id: issues.id,
          title: issues.title,
          status: issues.status,
          priority: issues.priority,
          assigneeAgentId: issues.assigneeAgentId,
          createdAt: issues.createdAt,
          updatedAt: issues.updatedAt,
        })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            or(
              inArray(issues.assigneeAgentId, agentIds),
              sql`${issues.assigneeAgentId} IS NULL`,
            ),
          ),
        )
        .orderBy(desc(issues.updatedAt))
        .limit(pullLimit);
      for (const iss of recentIssues) {
        if (!iss.createdAt) continue;
        // Emit a "created" event only if the row is recent (approximated by
        // createdAt === updatedAt ± 2s, which is good enough without adding
        // a dedicated events table).
        const created = iss.createdAt.getTime();
        const updated = iss.updatedAt?.getTime() ?? created;
        const isCreate = Math.abs(updated - created) < 2000;
        events.push({
          id: `issue:${iss.id}:${isCreate ? "created" : "updated"}`,
          type: isCreate ? "issue_created" : "issue_updated",
          ts: iss.updatedAt?.toISOString?.() ?? iss.createdAt.toISOString(),
          agentId: iss.assigneeAgentId ?? null,
          agentName: iss.assigneeAgentId ? (nameById.get(iss.assigneeAgentId) ?? null) : null,
          summary: `${isCreate ? "created" : "updated"}: ${iss.title ?? "(untitled)"} [${iss.status}]`,
          link: `/issues/${iss.id}`,
          payload: { status: iss.status, priority: iss.priority, issueId: iss.id },
        });
      }

      // Issue comments
      const comments = await db
        .select({
          id: issueComments.id,
          issueId: issueComments.issueId,
          authorAgentId: issueComments.authorAgentId,
          body: issueComments.body,
          createdAt: issueComments.createdAt,
        })
        .from(issueComments)
        .where(
          and(
            eq(issueComments.companyId, companyId),
            isNotNull(issueComments.authorAgentId),
            inArray(
              sql`COALESCE(${issueComments.authorAgentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
              agentIds,
            ),
          ),
        )
        .orderBy(desc(issueComments.createdAt))
        .limit(pullLimit);
      for (const c of comments) {
        if (!c.createdAt || !c.authorAgentId) continue;
        events.push({
          id: `comment:${c.id}`,
          type: "comment",
          ts: c.createdAt.toISOString(),
          agentId: c.authorAgentId,
          agentName: nameById.get(c.authorAgentId) ?? null,
          summary: `comment on issue: ${String(c.body ?? "").slice(0, 100)}`,
          link: `/issues/${c.issueId}`,
          payload: { issueId: c.issueId, commentId: c.id },
        });
      }

      // Memories written
      const memories = await db
        .select({
          id: agentMemories.id,
          agentId: agentMemories.agentId,
          scope: agentMemories.scope,
          key: agentMemories.key,
          content: agentMemories.content,
          createdAt: agentMemories.createdAt,
          updatedAt: agentMemories.updatedAt,
        })
        .from(agentMemories)
        .where(
          and(
            eq(agentMemories.companyId, companyId),
            inArray(agentMemories.agentId, agentIds),
          ),
        )
        .orderBy(desc(agentMemories.updatedAt))
        .limit(pullLimit);
      for (const m of memories) {
        events.push({
          id: `memory:${m.id}`,
          type: "memory_written",
          ts: m.updatedAt.toISOString(),
          agentId: m.agentId,
          agentName: nameById.get(m.agentId) ?? null,
          summary: `memory [${m.scope}${m.key ? `/${m.key}` : ""}]: ${String(m.content).slice(0, 100)}`,
          link: null,
          payload: { scope: m.scope, key: m.key, memoryId: m.id },
        });
      }

      // Human questions (ask_human approvals) — emit two events per row:
      // human_question at createdAt, human_answer at decidedAt if resolved.
      const asks = await db
        .select({
          id: approvals.id,
          requestedByAgentId: approvals.requestedByAgentId,
          status: approvals.status,
          payload: approvals.payload,
          decisionNote: approvals.decisionNote,
          createdAt: approvals.createdAt,
          decidedAt: approvals.decidedAt,
        })
        .from(approvals)
        .where(
          and(
            eq(approvals.companyId, companyId),
            eq(approvals.type, "ask_human"),
            isNotNull(approvals.requestedByAgentId),
            inArray(
              sql`COALESCE(${approvals.requestedByAgentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
              agentIds,
            ),
          ),
        )
        .orderBy(desc(approvals.createdAt))
        .limit(pullLimit);
      for (const a of asks) {
        if (!a.requestedByAgentId) continue;
        const payload = (a.payload as Record<string, unknown> | null) ?? {};
        const question = typeof payload.question === "string" ? payload.question : "";
        events.push({
          id: `ask:${a.id}:q`,
          type: "human_question",
          ts: a.createdAt.toISOString(),
          agentId: a.requestedByAgentId,
          agentName: nameById.get(a.requestedByAgentId) ?? null,
          summary: `asked human: ${question.slice(0, 140)}`,
          link: `/approvals/${a.id}`,
          payload: { approvalId: a.id, question, status: a.status },
        });
        if (a.decidedAt && (a.status === "approved" || a.status === "rejected")) {
          events.push({
            id: `ask:${a.id}:a`,
            type: "human_answer",
            ts: a.decidedAt.toISOString(),
            agentId: a.requestedByAgentId,
            agentName: nameById.get(a.requestedByAgentId) ?? null,
            summary: `human answered: ${(a.decisionNote ?? "").slice(0, 140)}`,
            link: `/approvals/${a.id}`,
            payload: { approvalId: a.id, decision: a.status, answer: a.decisionNote },
          });
        }
      }

      // Sort merged stream by ts desc, cap at limit.
      events.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
      return events.slice(0, limit);
    },

    /**
     * Per-agent leaderboard counts over a time window. Window format:
     * 24h, 7d, 14d, 4w. Default 7d.
     */
    async leaderboard(
      companyId: string,
      managerId: string | null,
      window: string | undefined,
    ): Promise<LeaderboardRow[]> {
      const since = parseWindow(window);
      const { ids: agentIds, agentsById } = await resolveSubtree(companyId, managerId);
      if (agentIds.length === 0) return [];

      const rows = new Map<string, LeaderboardRow>();
      for (const id of agentIds) {
        const a = agentsById.get(id);
        rows.set(id, {
          agentId: id,
          agentName: a?.name ?? id,
          role: a?.role ?? null,
          reportsTo: a?.reportsTo ?? null,
          heartbeatRunsOk: 0,
          heartbeatRunsFailed: 0,
          issuesCreated: 0,
          commentsPosted: 0,
          memoriesWritten: 0,
          humanQuestionsAsked: 0,
        });
      }

      // Heartbeat run counts
      const runAgg = await db
        .select({
          agentId: heartbeatRuns.agentId,
          status: heartbeatRuns.status,
          n: sql<number>`count(*)::int`,
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.agentId, agentIds),
            gte(heartbeatRuns.startedAt, since),
          ),
        )
        .groupBy(heartbeatRuns.agentId, heartbeatRuns.status);
      for (const r of runAgg) {
        const row = rows.get(r.agentId);
        if (!row) continue;
        if (r.status === "succeeded") row.heartbeatRunsOk += Number(r.n);
        else if (r.status === "failed" || r.status === "errored") row.heartbeatRunsFailed += Number(r.n);
      }

      // Issue creation (approximation: assignee == agent AND created_at in window)
      const issueAgg = await db
        .select({
          agentId: issues.assigneeAgentId,
          n: sql<number>`count(*)::int`,
        })
        .from(issues)
        .where(
          and(
            eq(issues.companyId, companyId),
            inArray(
              sql`COALESCE(${issues.assigneeAgentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
              agentIds,
            ),
            gte(issues.createdAt, since),
          ),
        )
        .groupBy(issues.assigneeAgentId);
      for (const r of issueAgg) {
        if (!r.agentId) continue;
        const row = rows.get(r.agentId);
        if (row) row.issuesCreated += Number(r.n);
      }

      // Comments
      const commentAgg = await db
        .select({
          agentId: issueComments.authorAgentId,
          n: sql<number>`count(*)::int`,
        })
        .from(issueComments)
        .where(
          and(
            eq(issueComments.companyId, companyId),
            inArray(
              sql`COALESCE(${issueComments.authorAgentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
              agentIds,
            ),
            gte(issueComments.createdAt, since),
          ),
        )
        .groupBy(issueComments.authorAgentId);
      for (const r of commentAgg) {
        if (!r.agentId) continue;
        const row = rows.get(r.agentId);
        if (row) row.commentsPosted += Number(r.n);
      }

      // Memories
      const memAgg = await db
        .select({
          agentId: agentMemories.agentId,
          n: sql<number>`count(*)::int`,
        })
        .from(agentMemories)
        .where(
          and(
            eq(agentMemories.companyId, companyId),
            inArray(agentMemories.agentId, agentIds),
            gte(agentMemories.updatedAt, since),
          ),
        )
        .groupBy(agentMemories.agentId);
      for (const r of memAgg) {
        const row = rows.get(r.agentId);
        if (row) row.memoriesWritten += Number(r.n);
      }

      // Human questions
      const askAgg = await db
        .select({
          agentId: approvals.requestedByAgentId,
          n: sql<number>`count(*)::int`,
        })
        .from(approvals)
        .where(
          and(
            eq(approvals.companyId, companyId),
            eq(approvals.type, "ask_human"),
            inArray(
              sql`COALESCE(${approvals.requestedByAgentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
              agentIds,
            ),
            gte(approvals.createdAt, since),
          ),
        )
        .groupBy(approvals.requestedByAgentId);
      for (const r of askAgg) {
        if (!r.agentId) continue;
        const row = rows.get(r.agentId);
        if (row) row.humanQuestionsAsked += Number(r.n);
      }

      // Sort by total activity desc
      const scored = Array.from(rows.values()).map((r) => ({
        ...r,
        _score:
          r.heartbeatRunsOk +
          r.issuesCreated * 2 +
          r.commentsPosted +
          r.memoriesWritten * 3 +
          r.humanQuestionsAsked * 2,
      }));
      scored.sort((a, b) => b._score - a._score);
      return scored.map(({ _score, ...rest }) => rest);
    },
  };
}

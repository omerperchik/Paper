import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, approvals, companies, costEvents, issues } from "@paperclipai/db";
import { notFound } from "../errors.js";
import { budgetService } from "./budgets.js";

export function dashboardService(db: Db) {
  const budgets = budgetService(db);
  return {
    summary: async (companyId: string) => {
      const company = await db
        .select()
        .from(companies)
        .where(eq(companies.id, companyId))
        .then((rows) => rows[0] ?? null);

      if (!company) throw notFound("Company not found");

      const agentRows = await db
        .select({ status: agents.status, count: sql<number>`count(*)` })
        .from(agents)
        .where(eq(agents.companyId, companyId))
        .groupBy(agents.status);

      const taskRows = await db
        .select({ status: issues.status, count: sql<number>`count(*)` })
        .from(issues)
        .where(eq(issues.companyId, companyId))
        .groupBy(issues.status);

      const pendingApprovals = await db
        .select({ count: sql<number>`count(*)` })
        .from(approvals)
        .where(and(eq(approvals.companyId, companyId), eq(approvals.status, "pending")))
        .then((rows) => Number(rows[0]?.count ?? 0));

      const agentCounts: Record<string, number> = {
        active: 0,
        running: 0,
        paused: 0,
        error: 0,
      };
      for (const row of agentRows) {
        const count = Number(row.count);
        // "idle" agents are operational — count them as active
        const bucket = row.status === "idle" ? "active" : row.status;
        agentCounts[bucket] = (agentCounts[bucket] ?? 0) + count;
      }

      const taskCounts: Record<string, number> = {
        open: 0,
        inProgress: 0,
        blocked: 0,
        done: 0,
      };
      for (const row of taskRows) {
        const count = Number(row.count);
        if (row.status === "in_progress") taskCounts.inProgress += count;
        if (row.status === "blocked") taskCounts.blocked += count;
        if (row.status === "done") taskCounts.done += count;
        if (row.status !== "done" && row.status !== "cancelled") taskCounts.open += count;
      }

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const [{ monthSpend }] = await db
        .select({
          monthSpend: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
        })
        .from(costEvents)
        .where(
          and(
            eq(costEvents.companyId, companyId),
            gte(costEvents.occurredAt, monthStart),
          ),
        );

      const monthSpendCents = Number(monthSpend);

      // Primary vs secondary model breakdown.
      //
      // "Primary" = the cost_event's model matches the agent's currently
      // configured runtime_config.model. "Secondary" = anything else the
      // adapter actually invoked (fallback tier, router downgrade, manual
      // override, retry on a cheaper model, etc.). Reported over the current
      // calendar month so it lines up with month spend.
      const modelRows = await db.execute<{
        bucket: string;
        call_count: number;
        spend_cents: number;
      }>(sql`
        select
          case
            when ${costEvents.model} = (${agents.runtimeConfig} ->> 'model')
              then 'primary'
            else 'secondary'
          end as bucket,
          count(*)::int as call_count,
          coalesce(sum(${costEvents.costCents}), 0)::int as spend_cents
        from ${costEvents}
        join ${agents} on ${agents.id} = ${costEvents.agentId}
        where ${costEvents.companyId} = ${companyId}
          and ${costEvents.occurredAt} >= ${monthStart}
        group by bucket
      `);
      let primaryCalls = 0;
      let secondaryCalls = 0;
      let primarySpendCents = 0;
      let secondarySpendCents = 0;
      for (const row of (modelRows as { rows?: Array<{ bucket: string; call_count: number; spend_cents: number }> }).rows ?? []) {
        if (row.bucket === "primary") {
          primaryCalls = Number(row.call_count) || 0;
          primarySpendCents = Number(row.spend_cents) || 0;
        } else if (row.bucket === "secondary") {
          secondaryCalls = Number(row.call_count) || 0;
          secondarySpendCents = Number(row.spend_cents) || 0;
        }
      }
      const totalCalls = primaryCalls + secondaryCalls;
      const primaryPercent = totalCalls > 0 ? Number(((primaryCalls / totalCalls) * 100).toFixed(1)) : 0;
      const secondaryPercent = totalCalls > 0 ? Number(((secondaryCalls / totalCalls) * 100).toFixed(1)) : 0;

      const utilization =
        company.budgetMonthlyCents > 0
          ? (monthSpendCents / company.budgetMonthlyCents) * 100
          : 0;
      const budgetOverview = await budgets.overview(companyId);

      return {
        companyId,
        agents: {
          active: agentCounts.active,
          running: agentCounts.running,
          paused: agentCounts.paused,
          error: agentCounts.error,
        },
        tasks: taskCounts,
        costs: {
          monthSpendCents,
          monthBudgetCents: company.budgetMonthlyCents,
          monthUtilizationPercent: Number(utilization.toFixed(2)),
        },
        pendingApprovals,
        budgets: {
          activeIncidents: budgetOverview.activeIncidents.length,
          pendingApprovals: budgetOverview.pendingApprovalCount,
          pausedAgents: budgetOverview.pausedAgentCount,
          pausedProjects: budgetOverview.pausedProjectCount,
        },
        modelUsage: {
          primaryCalls,
          secondaryCalls,
          primaryPercent,
          secondaryPercent,
          primarySpendCents,
          secondarySpendCents,
        },
      };
    },
  };
}

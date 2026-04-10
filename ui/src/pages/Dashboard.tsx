import { useEffect } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { heartbeatsApi } from "../api/heartbeats";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { MetricStrip, type MetricStripItem } from "../components/MetricStrip";
import { NeedsFeedbackCard } from "../components/NeedsFeedbackCard";
import { EmptyState } from "../components/EmptyState";
import { StatusIcon } from "../components/StatusIcon";
import { Identity } from "../components/Identity";
import { timeAgo } from "../lib/timeAgo";
import { formatCents } from "../lib/utils";
import { Bot, CircleDot, DollarSign, ShieldCheck, LayoutDashboard, PauseCircle, Receipt } from "lucide-react";
import { LiveFeed } from "../components/LiveFeed";
import { ChartCard, RunActivityChart, PriorityChart, IssueStatusChart, SuccessRateChart } from "../components/ActivityCharts";
import { FailureClassesPanel } from "../components/FailureClassesPanel";
import { PageSkeleton } from "../components/PageSkeleton";
import type { Issue } from "@paperclipai/shared";
import { PluginSlotOutlet } from "@/plugins/slots";

function getRecentIssues(issues: Issue[]): Issue[] {
  return [...issues]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function Dashboard() {
  const { selectedCompanyId, companies } = useCompany();
  const { openOnboarding } = useDialog();
  const { setBreadcrumbs } = useBreadcrumbs();

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Dashboard" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: runs } = useQuery({
    queryKey: queryKeys.heartbeats(selectedCompanyId!),
    queryFn: () => heartbeatsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const recentIssues = issues ? getRecentIssues(issues) : [];

  const agentName = (id: string | null) => {
    if (!id || !agents) return null;
    return agents.find((a) => a.id === id)?.name ?? null;
  };

  if (!selectedCompanyId) {
    if (companies.length === 0) {
      return (
        <EmptyState
          icon={LayoutDashboard}
          message="Welcome to Paperclip. Set up your first company and agent to get started."
          action="Get Started"
          onAction={openOnboarding}
        />
      );
    }
    return (
      <EmptyState icon={LayoutDashboard} message="Create or select a company to view the dashboard." />
    );
  }

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  const hasNoAgents = agents !== undefined && agents.length === 0;

  const metricItems: MetricStripItem[] = data
    ? [
        {
          icon: Bot,
          value: data.agents.active + data.agents.running + data.agents.paused + data.agents.error,
          label: "Agents",
          hint: `${data.agents.running} running · ${data.agents.paused} paused · ${data.agents.error} err`,
          to: "/agents",
          tone: data.agents.error > 0 ? "danger" : "default",
        },
        {
          icon: CircleDot,
          value: data.tasks.inProgress,
          label: "In progress",
          hint: `${data.tasks.open} open · ${data.tasks.blocked} blocked · ${data.tasks.done} done`,
          to: "/issues",
        },
        {
          icon: DollarSign,
          value: formatCents(data.costs.monthSpendCents),
          label: "Month spend",
          hint:
            data.costs.monthBudgetCents > 0
              ? `${data.costs.monthUtilizationPercent}% of ${formatCents(data.costs.monthBudgetCents)}`
              : "unlimited budget",
          to: "/costs",
          tone:
            data.costs.monthBudgetCents > 0 && data.costs.monthUtilizationPercent >= 90
              ? "danger"
              : data.costs.monthBudgetCents > 0 && data.costs.monthUtilizationPercent >= 70
                ? "warn"
                : "default",
        },
        {
          icon: Receipt,
          value:
            data.tasks.done > 0
              ? formatCents(Math.round(data.costs.monthSpendCents / data.tasks.done))
              : "—",
          label: "Cost / task",
          hint:
            data.tasks.done > 0
              ? `${data.tasks.done} completed this month`
              : "no completed tasks yet",
          to: "/costs",
        },
        {
          icon: ShieldCheck,
          value: data.pendingApprovals + data.budgets.pendingApprovals,
          label: "Approvals",
          hint:
            data.budgets.pendingApprovals > 0
              ? `${data.budgets.pendingApprovals} budget overrides`
              : "awaiting your input",
          to: "/approvals",
          tone: data.pendingApprovals + data.budgets.pendingApprovals > 0 ? "warn" : "default",
        },
      ]
    : [];

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {hasNoAgents && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 dark:border-amber-500/25 dark:bg-amber-950/60">
          <div className="flex items-center gap-2.5">
            <Bot className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
            <p className="text-sm text-amber-900 dark:text-amber-100">You have no agents.</p>
          </div>
          <button
            onClick={() => openOnboarding({ initialStep: 2, companyId: selectedCompanyId! })}
            className="text-sm font-medium text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100 underline underline-offset-2 shrink-0"
          >
            Create one here
          </button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          {data && data.budgets.activeIncidents > 0 && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5">
              <div className="flex items-start gap-2.5">
                <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                <div>
                  <p className="text-sm font-medium text-red-600 dark:text-red-300">
                    {data.budgets.activeIncidents} active budget incident
                    {data.budgets.activeIncidents === 1 ? "" : "s"}
                  </p>
                  <p className="text-xs text-red-600/70 dark:text-red-300/70">
                    {data.budgets.pausedAgents} agents paused · {data.budgets.pausedProjects} projects paused ·{" "}
                    {data.budgets.pendingApprovals} pending budget approvals
                  </p>
                </div>
              </div>
              <Link to="/costs" className="text-xs font-medium underline underline-offset-2 text-red-600 dark:text-red-300">
                Open budgets
              </Link>
            </div>
          )}

          {data && <MetricStrip items={metricItems} />}

          {/* The prominent "Needs your feedback" inbox — this is the main
              interactive card on the dashboard. It contains inline CTAs so
              the user can clear simple approvals without leaving the page. */}
          <NeedsFeedbackCard companyId={selectedCompanyId!} />

          {/* Compact charts row */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <ChartCard title="Runs" subtitle="14d">
              <RunActivityChart runs={runs ?? []} />
            </ChartCard>
            <ChartCard title="Priority" subtitle="14d">
              <PriorityChart issues={issues ?? []} />
            </ChartCard>
            <ChartCard title="Status" subtitle="14d">
              <IssueStatusChart issues={issues ?? []} />
            </ChartCard>
            <ChartCard title="Success rate" subtitle="14d">
              <SuccessRateChart runs={runs ?? []} />
            </ChartCard>
          </div>

          {selectedCompanyId && <FailureClassesPanel companyId={selectedCompanyId} />}

          <PluginSlotOutlet
            slotTypes={["dashboardWidget"]}
            context={{ companyId: selectedCompanyId }}
            className="grid gap-3 md:grid-cols-2"
            itemClassName="rounded-xl border border-border bg-card/40 p-3"
          />

          {/* Recent tasks — compact, single column, no redundant Recent Activity
              (the right-hand Live Feed is the source of truth for what's
              happening). */}
          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Recent tasks
              </h3>
              <Link to="/issues" className="text-xs text-muted-foreground hover:text-foreground">
                all issues →
              </Link>
            </div>
            {recentIssues.length === 0 ? (
              <div className="rounded-xl border border-border bg-card/40 p-4">
                <p className="text-sm text-muted-foreground">No tasks yet.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card/40">
                {recentIssues.slice(0, 8).map((issue) => {
                  const assignee = agentName(issue.assigneeAgentId ?? null);
                  return (
                    <li key={issue.id}>
                      <Link
                        to={`/issues/${issue.identifier ?? issue.id}`}
                        className="flex items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-accent/40 no-underline text-inherit"
                      >
                        <StatusIcon status={issue.status} />
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                          {issue.identifier ?? issue.id.slice(0, 8)}
                        </span>
                        <span className="min-w-0 flex-1 truncate">{issue.title}</span>
                        {assignee && <Identity name={assignee} size="sm" />}
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                          {timeAgo(issue.updatedAt)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <aside className="min-w-0 xl:sticky xl:top-4 xl:self-start xl:h-[calc(100vh-2rem)] xl:overflow-hidden">
          <LiveFeed companyId={selectedCompanyId!} />
        </aside>
      </div>
    </div>
  );
}

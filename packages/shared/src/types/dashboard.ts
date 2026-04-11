export interface DashboardSummary {
  companyId: string;
  agents: {
    active: number;
    running: number;
    paused: number;
    error: number;
  };
  tasks: {
    open: number;
    inProgress: number;
    blocked: number;
    done: number;
  };
  costs: {
    monthSpendCents: number;
    monthBudgetCents: number;
    monthUtilizationPercent: number;
  };
  pendingApprovals: number;
  budgets: {
    activeIncidents: number;
    pendingApprovals: number;
    pausedAgents: number;
    pausedProjects: number;
  };
  /**
   * Distribution of LLM calls this month between each agent's configured
   * "primary" model (agents.runtime_config -> 'model') and any other model
   * the adapter actually invoked (treated as "secondary" — fallback, router
   * downgrade, retry on a cheaper tier, etc.). Counts are individual
   * cost_events rows over the current calendar month.
   */
  modelUsage: {
    primaryCalls: number;
    secondaryCalls: number;
    primaryPercent: number;
    secondaryPercent: number;
    primarySpendCents: number;
    secondarySpendCents: number;
  };
}

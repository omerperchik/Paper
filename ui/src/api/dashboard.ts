import type { DashboardSummary } from "@paperclipai/shared";
import { api } from "./client";

export interface FailureClassBreakdown {
  windowHours: number;
  since: string;
  total: number;
  succeeded: number;
  successRate: number;
  breakdown: Array<{
    failureClass: string;
    count: number;
    percentOfAll: number;
  }>;
}

export const dashboardApi = {
  summary: (companyId: string) => api.get<DashboardSummary>(`/companies/${companyId}/dashboard`),
  failureClasses: (companyId: string, windowHours = 24, agentId?: string) => {
    const params = new URLSearchParams({ windowHours: String(windowHours) });
    if (agentId) params.set("agentId", agentId);
    return api.get<FailureClassBreakdown>(
      `/companies/${companyId}/failure-classes?${params.toString()}`,
    );
  },
};

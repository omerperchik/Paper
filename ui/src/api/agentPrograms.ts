import { api } from "./client";

export interface AgentProgramRevision {
  id: string;
  companyId: string;
  agentId: string;
  revisionNumber: number;
  status: "proposed" | "active" | "superseded" | "reverted";
  programMd: string;
  rationale: string | null;
  parentRevisionId: string | null;
  proposedByAgentId: string | null;
  proposedByRunId: string | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  activatedAt: string | null;
  supersededAt: string | null;
  revertedAt: string | null;
  revertedReason: string | null;
  metricName: string | null;
  metricBaseline: string | null;
  metricObserved: string | null;
  metricObservedAt: string | null;
  createdAt: string;
}

export const agentProgramsApi = {
  list: (agentId: string, limit = 50) =>
    api.get<AgentProgramRevision[]>(`/agents/${agentId}/program-revisions?limit=${limit}`),
  propose: (agentId: string, data: {
    programMd: string;
    rationale?: string | null;
    parentRevisionId?: string | null;
    metricName?: string | null;
    metricBaseline?: string | null;
    metricObserved?: string | null;
  }) => api.post<AgentProgramRevision>(`/agents/${agentId}/program-revisions`, data),
  seed: (agentId: string) =>
    api.post<AgentProgramRevision | null>(`/agents/${agentId}/program-revisions/seed`, {}),
  activate: (agentId: string, revisionId: string) =>
    api.post<AgentProgramRevision>(`/agents/${agentId}/program-revisions/${revisionId}/activate`, {}),
  revert: (agentId: string, reason: string) =>
    api.post<{ reverted: AgentProgramRevision; restored: AgentProgramRevision }>(
      `/agents/${agentId}/program-revisions/revert`,
      { reason },
    ),
  recordMetric: (agentId: string, metricName: string, metricObserved: string) =>
    api.post<AgentProgramRevision>(`/agents/${agentId}/program-revisions/metric`, {
      metricName,
      metricObserved,
    }),
};

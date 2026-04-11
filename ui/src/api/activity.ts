import type { ActivityEvent } from "@paperclipai/shared";
import { api } from "./client";

export interface RunForIssue {
  runId: string;
  status: string;
  agentId: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  invocationSource: string;
  usageJson: Record<string, unknown> | null;
  resultJson: Record<string, unknown> | null;
}

export interface IssueForRun {
  issueId: string;
  identifier: string | null;
  title: string;
  status: string;
  priority: string;
}

export interface ActivityEntity {
  id: string;
  companyId: string;
  activityId: string;
  entityType: string;
  entityKey: string;
  entityLabel: string | null;
  createdAt: string;
}

export interface ActivityEntityBacklink {
  activityId: string;
  entityType: string;
  entityKey: string;
  entityLabel: string | null;
  activity: ActivityEvent;
}

export const activityApi = {
  list: (companyId: string, filters?: { entityType?: string; entityId?: string; agentId?: string }) => {
    const params = new URLSearchParams();
    if (filters?.entityType) params.set("entityType", filters.entityType);
    if (filters?.entityId) params.set("entityId", filters.entityId);
    if (filters?.agentId) params.set("agentId", filters.agentId);
    const qs = params.toString();
    return api.get<ActivityEvent[]>(`/companies/${companyId}/activity${qs ? `?${qs}` : ""}`);
  },
  forIssue: (issueId: string) => api.get<ActivityEvent[]>(`/issues/${issueId}/activity`),
  runsForIssue: (issueId: string) => api.get<RunForIssue[]>(`/issues/${issueId}/runs`),
  issuesForRun: (runId: string) => api.get<IssueForRun[]>(`/heartbeat-runs/${runId}/issues`),
  entitiesForActivity: (activityId: string) =>
    api.get<ActivityEntity[]>(`/activity/${activityId}/entities`),
  backlinks: (companyId: string, type: string, key: string, limit = 100) =>
    api.get<ActivityEntityBacklink[]>(
      `/companies/${companyId}/activity-entities/${encodeURIComponent(type)}/${encodeURIComponent(key)}?limit=${limit}`,
    ),
};

// Re-export ActivityEvent so consumers can import everything from one place.
export type { ActivityEvent };

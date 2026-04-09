import { useEffect, useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import type { ActivityEvent, Agent, Issue } from "@paperclipai/shared";
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ExternalLink,
  Radio,
  XCircle,
} from "lucide-react";
import { heartbeatsApi, type LiveRunForIssue } from "../api/heartbeats";
import { activityApi } from "../api/activity";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { timeAgo } from "../lib/timeAgo";
import { RunTranscriptView } from "./transcript/RunTranscriptView";
import { useLiveRunTranscripts } from "./transcript/useLiveRunTranscripts";

const FEED_LIMIT = 20;
const RECENT_RUN_LOOKBACK = 12;

type FeedItemKind = "run" | "activity";

interface FeedItem {
  key: string;
  kind: FeedItemKind;
  timestamp: number;
  run?: LiveRunForIssue;
  activity?: ActivityEvent;
}

function runTimestamp(run: LiveRunForIssue): number {
  const t = run.finishedAt ?? run.startedAt ?? run.createdAt;
  return t ? new Date(t).getTime() : 0;
}

function isRunActive(run: LiveRunForIssue): boolean {
  return run.status === "queued" || run.status === "running";
}

const REASON_LABELS: Record<string, string> = {
  interval_elapsed: "heartbeat tick",
  heartbeat_timer: "heartbeat tick",
  manual: "manual invoke",
  callback: "callback",
  ping: "ping",
  process_loss_retry: "retry after process loss",
  continuous_dispatch: "continuous dispatch",
};

function runDescription(run: LiveRunForIssue): string {
  // Highest signal: linked routine → the user knows exactly what work unit this is.
  if (run.routineTitle) return run.routineTitle;
  // Next: linked issue title (manual wakeups, event triggers, etc.)
  if (run.issueTitle) return run.issueTitle;
  // Extracted deliverable headline from the adapter's result_json.content
  // (e.g. "Any.do Positioning Canvas", "7-Email Activation Sequence"). This
  // is only populated on finished runs.
  if (run.headline && run.headline.trim().length > 0) return run.headline.trim();
  // Reason from context snapshot (scheduler ticks, retries) — fallback only
  // when we don't yet have a headline (e.g. still running).
  const reason = run.reason ?? run.wakeReason;
  if (reason && REASON_LABELS[reason]) return REASON_LABELS[reason];
  if (reason) return reason.replace(/_/g, " ");
  // Invocation source + trigger detail fallback
  const bits: string[] = [];
  if (run.invocationSource && run.invocationSource !== "on_demand") bits.push(run.invocationSource);
  if (run.triggerDetail && run.triggerDetail !== "system" && run.triggerDetail !== "manual") {
    bits.push(run.triggerDetail);
  }
  if (bits.length > 0) return bits.join(" · ");
  // Last resort
  return "idle check-in";
}

function runIssueRef(run: LiveRunForIssue): string | null {
  if (run.issueIdentifier) return run.issueIdentifier;
  if (run.issueId) return run.issueId.slice(0, 8);
  return null;
}

function runStatusLabel(run: LiveRunForIssue): string {
  switch (run.status) {
    case "running":
      return "running";
    case "queued":
      return "queued";
    case "succeeded":
      return "finished";
    case "failed":
      return "failed";
    case "timed_out":
      return "timed out";
    case "cancelled":
      return "cancelled";
    default:
      return run.status;
  }
}

function runStatusTone(status: string): string {
  if (status === "running" || status === "queued") return "text-cyan-500";
  if (status === "succeeded") return "text-emerald-500";
  if (status === "failed" || status === "timed_out") return "text-destructive";
  if (status === "cancelled") return "text-muted-foreground";
  return "text-muted-foreground";
}

const ACTIVITY_VERBS: Record<string, string> = {
  "issue.created": "created issue",
  "issue.updated": "updated issue",
  "issue.checked_out": "checked out issue",
  "issue.released": "released issue",
  "issue.comment_added": "commented on",
  "issue.commented": "commented on",
  "issue.attachment_added": "attached a file to",
  "issue.document_created": "wrote a document on",
  "issue.document_updated": "updated a document on",
  "issue.deleted": "deleted issue",
  "approval.created": "requested approval",
  "approval.approved": "approved",
  "approval.rejected": "rejected",
  "cost.reported": "reported cost for",
  "cost.recorded": "recorded cost for",
  "agent.paused": "paused",
  "agent.resumed": "resumed",
  "agent.terminated": "terminated",
  "project.created": "created project",
  "project.updated": "updated project",
  "goal.created": "created goal",
  "goal.updated": "updated goal",
};

function activityVerb(action: string): string {
  return ACTIVITY_VERBS[action] ?? action.replace(/[._]/g, " ");
}

function activityDescription(event: ActivityEvent): string | null {
  const d = (event.details ?? {}) as Record<string, unknown>;
  const pick = (key: string): string | null => {
    const v = d[key];
    return typeof v === "string" && v.length > 0 ? v : null;
  };
  // Issue updates: describe what changed
  if (event.action === "issue.updated") {
    const changes: string[] = [];
    const prev = (d._previous ?? {}) as Record<string, unknown>;
    if (typeof d.status === "string") {
      const from = typeof prev.status === "string" ? prev.status.replace(/_/g, " ") : null;
      changes.push(from ? `status ${from} → ${d.status.replace(/_/g, " ")}` : `status → ${d.status.replace(/_/g, " ")}`);
    }
    if (typeof d.priority === "string") changes.push(`priority → ${d.priority}`);
    if (d.assigneeAgentId !== undefined || d.assigneeUserId !== undefined) changes.push("reassigned");
    if (d.reopened === true) changes.push("reopened");
    if (typeof d.title === "string") changes.push("title changed");
    if (typeof d.description === "string") changes.push("description changed");
    if (changes.length > 0) return changes.join(", ");
  }
  // Comments: first line of the body
  if (event.action === "issue.comment_added" || event.action === "issue.commented") {
    const snippet = pick("bodySnippet") ?? pick("body") ?? pick("text");
    if (snippet) return snippet.replace(/\s+/g, " ").slice(0, 120);
  }
  // Approval flows
  if (event.action.startsWith("approval.")) {
    return pick("reason") ?? pick("title") ?? null;
  }
  // Cost events
  if (event.action.startsWith("cost.")) {
    const cents = typeof d.costCents === "number" ? d.costCents : null;
    const provider = pick("provider");
    if (cents !== null) return `$${(cents / 100).toFixed(4)}${provider ? ` · ${provider}` : ""}`;
  }
  // Documents / attachments
  if (event.action.startsWith("issue.document_") || event.action.startsWith("issue.attachment_")) {
    return pick("name") ?? pick("filename") ?? pick("title");
  }
  // Generic fallback: prefer a 'title' or 'name' field if present
  return pick("title") ?? pick("name") ?? pick("reason") ?? pick("message");
}

function formatDuration(run: LiveRunForIssue): string | null {
  const start = run.startedAt ? new Date(run.startedAt).getTime() : null;
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : null;
  if (!start || !end || end < start) return null;
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

interface LiveFeedProps {
  companyId: string;
}

export function LiveFeed({ companyId }: LiveFeedProps) {
  const { data: liveRuns } = useQuery({
    queryKey: [...queryKeys.liveRuns(companyId), "feed"],
    queryFn: () => heartbeatsApi.liveRunsForCompany(companyId, RECENT_RUN_LOOKBACK),
    refetchInterval: 5000,
  });

  const { data: activity } = useQuery({
    queryKey: queryKeys.activity(companyId),
    queryFn: () => activityApi.list(companyId),
  });

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(companyId),
    queryFn: () => issuesApi.list(companyId),
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
  });

  const issueById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of issues ?? []) map.set(issue.id, issue);
    return map;
  }, [issues]);

  const agentById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const runs = liveRuns ?? [];
  const activeCount = runs.filter(isRunActive).length;

  // Live transcripts only for runs we may want to expand as "running".
  const { transcriptByRun } = useLiveRunTranscripts({
    runs: runs.filter(isRunActive),
    companyId,
    maxChunksPerRun: 60,
  });

  const items = useMemo<FeedItem[]>(() => {
    const out: FeedItem[] = [];
    for (const run of runs) {
      out.push({
        key: `run:${run.id}`,
        kind: "run",
        timestamp: runTimestamp(run),
        run,
      });
    }
    const runIds = new Set(runs.map((r) => r.id));
    for (const event of activity ?? []) {
      // Skip heartbeat_run activity entries — we already show runs directly.
      if (event.entityType === "heartbeat_run" && runIds.has(event.entityId)) continue;
      if (event.entityType === "heartbeat_run") continue; // dedup: covered by runs list
      out.push({
        key: `activity:${event.id}`,
        kind: "activity",
        timestamp: new Date(event.createdAt).getTime(),
        activity: event,
      });
    }
    out.sort((a, b) => b.timestamp - a.timestamp);
    return out.slice(0, FEED_LIMIT);
  }, [runs, activity]);

  const newestTs = items[0]?.timestamp ?? 0;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);
  void tick;

  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="flex h-full max-h-full flex-col overflow-hidden rounded-xl border border-border bg-card/30">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            {activeCount > 0 ? (
              <>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-500" />
              </>
            ) : (
              <span className="relative inline-flex h-2 w-2 rounded-full bg-muted-foreground/40" />
            )}
          </span>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Live Feed
          </h3>
          <span className="text-xs text-muted-foreground">
            {activeCount > 0
              ? `${activeCount} agent${activeCount === 1 ? "" : "s"} working`
              : "idle"}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Radio className="h-3 w-3" />
          {newestTs > 0 ? `last event ${timeAgo(new Date(newestTs))}` : "waiting…"}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          Nothing yet. Waiting for agents…
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-border/60 overflow-y-auto">
          {items.map((item) => (
            <FeedRow
              key={item.key}
              item={item}
              issueById={issueById}
              agentById={agentById}
              transcriptByRun={transcriptByRun}
              isExpanded={expanded === item.key}
              onToggle={() =>
                setExpanded((prev) => (prev === item.key ? null : item.key))
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface FeedRowProps {
  item: FeedItem;
  issueById: Map<string, Issue>;
  agentById: Map<string, Agent>;
  transcriptByRun: ReturnType<typeof useLiveRunTranscripts>["transcriptByRun"];
  isExpanded: boolean;
  onToggle: () => void;
}

function FeedRow({ item, issueById, agentById, transcriptByRun, isExpanded, onToggle }: FeedRowProps) {
  if (item.kind === "run" && item.run) {
    return (
      <RunFeedRow
        run={item.run}
        transcript={transcriptByRun.get(item.run.id) ?? []}
        isExpanded={isExpanded}
        onToggle={onToggle}
      />
    );
  }
  if (item.kind === "activity" && item.activity) {
    return (
      <ActivityFeedRow
        event={item.activity}
        agentById={agentById}
        issueById={issueById}
        isExpanded={isExpanded}
        onToggle={onToggle}
      />
    );
  }
  return null;
}

function RunFeedRow({
  run,
  transcript,
  isExpanded,
  onToggle,
}: {
  run: LiveRunForIssue;
  transcript: ReturnType<typeof useLiveRunTranscripts>["transcriptByRun"] extends Map<string, infer V> ? V : never;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const active = isRunActive(run);
  const ts = runTimestamp(run);
  const description = runDescription(run);
  const issueRef = runIssueRef(run);

  const Icon = active ? CircleDot : run.status === "succeeded" ? CheckCircle2 : run.status === "failed" || run.status === "timed_out" ? XCircle : Bot;

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-accent/40"
      >
        <span className="shrink-0">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </span>
        <span className="shrink-0">
          {active ? (
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-cyan-500" />
            </span>
          ) : (
            <Icon className={cn("h-3.5 w-3.5", runStatusTone(run.status))} />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{run.agentName}</span>
          <span className="text-muted-foreground"> {runStatusLabel(run)}</span>
          <span className="text-muted-foreground"> — </span>
          <span className="text-foreground">{description}</span>
          {issueRef && (
            <span className="ml-1.5 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
              {issueRef}
            </span>
          )}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {ts > 0 ? timeAgo(new Date(ts)) : ""}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-border/60 bg-muted/20 px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                status{" "}
                <span className={cn("font-medium", runStatusTone(run.status))}>
                  {runStatusLabel(run)}
                </span>
              </span>
              <span>trigger: {run.invocationSource}{run.triggerDetail ? ` · ${run.triggerDetail}` : ""}</span>
              {formatDuration(run) && <span>duration: {formatDuration(run)}</span>}
            </div>
            <Link
              to={`/agents/${run.agentId}/runs/${run.id}`}
              className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
            >
              open run <ExternalLink className="h-2.5 w-2.5" />
            </Link>
          </div>
          <div className="max-h-56 overflow-y-auto rounded-md border border-border/60 bg-background/40 p-2">
            <RunTranscriptView
              entries={transcript}
              density="compact"
              limit={active ? 8 : 5}
              streaming={active}
              collapseStdout
              thinkingClassName="!text-[10px] !leading-4"
              emptyMessage={active ? "Waiting for output…" : "No transcript captured."}
            />
          </div>
        </div>
      )}
    </li>
  );
}

function ActivityFeedRow({
  event,
  agentById,
  issueById,
  isExpanded,
  onToggle,
}: {
  event: ActivityEvent;
  agentById: Map<string, Agent>;
  issueById: Map<string, Issue>;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const verb = activityVerb(event.action);
  const actor =
    event.actorType === "agent"
      ? agentById.get(event.actorId)?.name ?? `Agent ${event.actorId.slice(0, 8)}`
      : event.actorType === "system"
        ? "System"
        : event.actorType === "user"
          ? "Board"
          : event.actorId || "Unknown";

  let entityLabel: string | null = null;
  let entityRef: string | null = null;
  if (event.entityType === "issue") {
    const iss = issueById.get(event.entityId);
    entityRef = iss?.identifier ?? event.entityId.slice(0, 8);
    entityLabel = iss?.title ?? null;
  } else if (event.entityType === "agent") {
    entityLabel = agentById.get(event.entityId)?.name ?? event.entityId.slice(0, 8);
  } else if (event.entityId) {
    entityLabel = event.entityId.slice(0, 8);
  }

  const detail = activityDescription(event);
  const summary = entityLabel
    ? detail
      ? `${entityLabel} — ${detail}`
      : entityLabel
    : detail ?? event.entityType;

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-accent/40"
      >
        <span className="shrink-0">
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </span>
        <span className="shrink-0">
          <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{actor}</span>
          <span className="text-muted-foreground"> {verb} </span>
          <span className="text-foreground">{summary}</span>
          {entityRef && (
            <span className="ml-1.5 rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
              {entityRef}
            </span>
          )}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {timeAgo(event.createdAt)}
        </span>
      </button>

      {isExpanded && (
        <div className="border-t border-border/60 bg-muted/20 px-4 py-3 text-[11px] text-muted-foreground">
          <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
            <span>action: <span className="font-mono">{event.action}</span></span>
            <span>entity: {event.entityType}</span>
            <span>actor: {event.actorType}</span>
          </div>
          {event.details && Object.keys(event.details).length > 0 && (
            <pre className="max-h-48 overflow-auto rounded-md border border-border/60 bg-background/40 p-2 text-[10px] leading-4 text-foreground/80">
              {JSON.stringify(event.details, null, 2)}
            </pre>
          )}
        </div>
      )}
    </li>
  );
}

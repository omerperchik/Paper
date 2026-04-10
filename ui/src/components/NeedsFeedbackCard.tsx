// NeedsFeedbackCard — compact dashboard inbox of items that require the
// user's explicit input before agents can proceed. Pulls from the same
// approvals endpoint used by the full /approvals page but shows only the
// top N pending items with inline Approve / Reject / Open CTAs. Clicking
// the CTAs fires the approvals API directly so the user can clear simple
// items without leaving the dashboard.

import { useMemo, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, ArrowRight, Inbox, MessageCircleQuestion } from "lucide-react";
import { approvalsApi } from "../api/approvals";
import { agentsApi } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import { timeAgo } from "../lib/timeAgo";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Identity } from "./Identity";
import { typeLabel, typeIcon, defaultTypeIcon, approvalSubject } from "./ApprovalPayload";
import type { Agent, Approval } from "@paperclipai/shared";

const MAX_ROWS = 6;

interface NeedsFeedbackCardProps {
  companyId: string;
}

type PendingAction = { id: string; action: "approve" | "reject" } | null;

function bodyPreview(approval: Approval): string | null {
  const payload = approval.payload as Record<string, unknown> | null;
  if (!payload) return null;
  // ask_human: the question the agent is asking the human
  const q = payload.question ?? payload.prompt;
  if (typeof q === "string" && q.length > 0) return q;
  // hire_agent: role + reason
  const role = typeof payload.role === "string" ? payload.role : null;
  const reason = typeof payload.reason === "string" ? payload.reason : null;
  if (role || reason) return [role, reason].filter(Boolean).join(" — ");
  // ceo_strategy / board approval: summary
  const summary = payload.summary ?? payload.recommendedAction ?? payload.rationale;
  if (typeof summary === "string") return summary;
  return null;
}

export function NeedsFeedbackCard({ companyId }: NeedsFeedbackCardProps) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: approvals } = useQuery({
    queryKey: queryKeys.approvals.list(companyId),
    queryFn: () => approvalsApi.list(companyId),
    refetchInterval: 15_000,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
  });

  const agentById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const pendingApprovals = useMemo(() => {
    return (approvals ?? [])
      .filter((a) => a.status === "pending" || a.status === "revision_requested")
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [approvals]);

  const visible = pendingApprovals.slice(0, MAX_ROWS);
  const overflowCount = Math.max(0, pendingApprovals.length - MAX_ROWS);

  const approveMut = useMutation({
    mutationFn: (id: string) => approvalsApi.approve(id),
    onMutate: (id) => setPending({ id, action: "approve" }),
    onSettled: () => setPending(null),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: queryKeys.approvals.list(companyId) });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(companyId) });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to approve"),
  });

  const rejectMut = useMutation({
    mutationFn: (id: string) => approvalsApi.reject(id),
    onMutate: (id) => setPending({ id, action: "reject" }),
    onSettled: () => setPending(null),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: queryKeys.approvals.list(companyId) });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard(companyId) });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to reject"),
  });

  return (
    <section className="rounded-xl border border-border bg-card/40">
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Needs your feedback
          </h3>
          {pendingApprovals.length > 0 && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
              {pendingApprovals.length}
            </span>
          )}
        </div>
        <Link
          to="/approvals/pending"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          inbox <ArrowRight className="h-3 w-3" />
        </Link>
      </header>

      {error && (
        <div className="border-b border-destructive/20 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
          <Check className="h-6 w-6 text-emerald-500" />
          <p className="text-sm text-muted-foreground">Nothing needs your feedback right now.</p>
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {visible.map((approval) => {
            const Icon = typeIcon[approval.type] ?? defaultTypeIcon;
            const kind = typeLabel[approval.type] ?? approval.type;
            const subject = approvalSubject(approval.payload as Record<string, unknown> | null);
            const preview = bodyPreview(approval);
            const requester =
              approval.requestedByAgentId ? agentById.get(approval.requestedByAgentId) : null;
            const isAskHuman = approval.type === "ask_human";
            const isBudget = approval.type === "budget_override_required";
            const rowPending = pending?.id === approval.id;

            return (
              <li key={approval.id} className="px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background/80">
                    <Icon className={cn("h-4 w-4", isAskHuman ? "text-cyan-500" : "text-muted-foreground")} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <span className="font-medium">{kind}</span>
                      {requester && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1 normal-case tracking-normal">
                            from <Identity name={requester.name} size="sm" />
                          </span>
                        </>
                      )}
                      <span>·</span>
                      <span className="normal-case tracking-normal">{timeAgo(approval.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium leading-5 text-foreground line-clamp-2">
                      {subject ?? (isAskHuman ? "Agent asked you a question" : kind)}
                    </p>
                    {preview && preview !== subject && (
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{preview}</p>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {isBudget ? (
                        <Link
                          to={`/approvals/${approval.id}`}
                          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium hover:bg-accent"
                        >
                          Review <ArrowRight className="h-3 w-3" />
                        </Link>
                      ) : isAskHuman ? (
                        <Link
                          to={`/approvals/${approval.id}`}
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          <MessageCircleQuestion className="h-3 w-3" />
                          Answer
                        </Link>
                      ) : (
                        <>
                          <Button
                            size="xs"
                            variant="default"
                            disabled={rowPending}
                            onClick={() => approveMut.mutate(approval.id)}
                          >
                            <Check className="h-3 w-3" />
                            {rowPending && pending?.action === "approve" ? "Approving…" : "Approve"}
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            disabled={rowPending}
                            onClick={() => rejectMut.mutate(approval.id)}
                          >
                            <X className="h-3 w-3" />
                            {rowPending && pending?.action === "reject" ? "Rejecting…" : "Reject"}
                          </Button>
                        </>
                      )}
                      <Link
                        to={`/approvals/${approval.id}`}
                        className="text-xs text-muted-foreground hover:text-foreground"
                      >
                        details
                      </Link>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {overflowCount > 0 && (
        <div className="border-t border-border/60 px-4 py-2 text-center">
          <Link
            to="/approvals/pending"
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            +{overflowCount} more in inbox →
          </Link>
        </div>
      )}
    </section>
  );
}

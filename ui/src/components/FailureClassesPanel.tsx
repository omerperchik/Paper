import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "@/api/dashboard";
import { cn } from "@/lib/utils";

const FAMILY_COLORS: Record<string, string> = {
  // Inference capacity — orange
  timeout_inference: "bg-orange-500",
  oom_inference: "bg-orange-600",
  rate_limited: "bg-orange-400",
  network_error: "bg-orange-400",
  upstream_fallback_failed: "bg-orange-700",
  // Model output — amber
  parse_error: "bg-amber-500",
  empty_output: "bg-amber-400",
  guardrail_abort: "bg-amber-600",
  tool_error: "bg-amber-500",
  // Control-plane — blue
  agent_not_found: "bg-blue-500",
  process_lost: "bg-blue-500",
  setup_error: "bg-blue-600",
  // Cancellation — gray
  cancelled: "bg-muted-foreground",
  // Logic — red
  logic_error: "bg-rose-500",
  unknown: "bg-zinc-500",
  unclassified: "bg-zinc-400",
};

const FAMILY_LABELS: Record<string, string> = {
  timeout_inference: "Inference timeout",
  oom_inference: "Out of memory",
  rate_limited: "Rate limited",
  network_error: "Network error",
  upstream_fallback_failed: "Fallback failed",
  parse_error: "Parse error",
  empty_output: "Empty output",
  guardrail_abort: "Guardrail abort",
  tool_error: "Tool error",
  agent_not_found: "Agent not found",
  process_lost: "Process lost",
  setup_error: "Setup error",
  cancelled: "Cancelled",
  logic_error: "Logic error",
  unknown: "Unknown",
  unclassified: "Unclassified (legacy)",
};

const WINDOW_OPTIONS: Array<{ label: string; hours: number }> = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 24 * 7 },
];

export function FailureClassesPanel({ companyId }: { companyId: string }) {
  const [windowHours, setWindowHours] = useState(24);

  const { data, isLoading, error } = useQuery({
    queryKey: ["failure-classes", companyId, windowHours] as const,
    queryFn: () => dashboardApi.failureClasses(companyId, windowHours),
    enabled: !!companyId,
    refetchInterval: 30_000,
  });

  const successPct = data ? Math.round(data.successRate * 1000) / 10 : null;
  const maxCount = data?.breakdown[0]?.count ?? 0;

  return (
    <div className="border border-border rounded-lg p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Run health</h3>
          <p className="text-[11px] text-muted-foreground">
            Where failures come from, classified at the source.
          </p>
        </div>
        <div className="flex gap-1">
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.hours}
              onClick={() => setWindowHours(opt.hours)}
              className={cn(
                "px-2 py-1 text-[10px] rounded-md border transition-colors",
                windowHours === opt.hours
                  ? "bg-muted border-border"
                  : "border-transparent hover:border-border",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
      {error && (
        <div className="text-xs text-destructive">Failed: {(error as Error).message}</div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total runs</div>
              <div className="text-xl font-semibold tabular-nums">{data.total}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Success rate</div>
              <div
                className={cn(
                  "text-xl font-semibold tabular-nums",
                  successPct !== null && successPct >= 95 && "text-emerald-500",
                  successPct !== null && successPct >= 80 && successPct < 95 && "text-amber-500",
                  successPct !== null && successPct < 80 && "text-destructive",
                )}
              >
                {successPct !== null ? `${successPct.toFixed(1)}%` : "—"}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Failed</div>
              <div className="text-xl font-semibold tabular-nums">
                {data.total - data.succeeded}
              </div>
            </div>
          </div>

          {data.breakdown.length === 0 ? (
            <div className="text-xs text-muted-foreground italic">
              No failures in this window. Nice.
            </div>
          ) : (
            <div className="space-y-1.5">
              {data.breakdown.map((row) => {
                const barPct = maxCount > 0 ? (row.count / maxCount) * 100 : 0;
                const overallPct = Math.round(row.percentOfAll * 1000) / 10;
                const color = FAMILY_COLORS[row.failureClass] ?? "bg-zinc-500";
                const label = FAMILY_LABELS[row.failureClass] ?? row.failureClass;
                return (
                  <div key={row.failureClass} className="space-y-0.5">
                    <div className="flex items-baseline justify-between gap-2 text-[11px]">
                      <span className="font-medium truncate">{label}</span>
                      <span className="text-muted-foreground tabular-nums shrink-0">
                        {row.count} · {overallPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", color)}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

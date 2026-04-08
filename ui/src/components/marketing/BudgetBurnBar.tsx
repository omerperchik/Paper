import { cn } from "@/lib/utils";
import type { BudgetOverview } from "@/lib/marketing-api";

interface BudgetBurnBarProps {
  budget: BudgetOverview;
  className?: string;
}

export function BudgetBurnBar({ budget, className }: BudgetBurnBarProps) {
  const spentPct = budget.totalBudget > 0 ? Math.min((budget.spent / budget.totalBudget) * 100, 100) : 0;
  const projectedPct = budget.totalBudget > 0 ? Math.min((budget.projectedSpend / budget.totalBudget) * 100, 100) : 0;
  const daysPct = budget.daysTotal > 0 ? ((budget.daysTotal - budget.daysRemaining) / budget.daysTotal) * 100 : 0;

  // Warning if projected to overspend (projected > 100% of budget)
  const isOverspending = budget.projectedSpend > budget.totalBudget;
  // Warning if spending faster than time elapsed
  const isPacingHigh = spentPct > daysPct + 10;

  const barColor = isOverspending
    ? "bg-red-500"
    : isPacingHigh
      ? "bg-amber-500"
      : "bg-emerald-500";

  const projectedColor = isOverspending
    ? "bg-red-500/20"
    : "bg-zinc-500/20";

  return (
    <div className={cn("rounded-lg border border-border p-4 sm:p-5 space-y-4", className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium text-muted-foreground tracking-wide">Budget Burn Rate</h3>
        {isOverspending && (
          <span className="text-[10px] font-medium text-red-400 bg-red-500/15 px-1.5 py-0.5 rounded-full">
            Overspend projected
          </span>
        )}
      </div>

      {/* Main bar */}
      <div className="space-y-2">
        <div className="h-3 w-full rounded-full bg-muted/20 overflow-hidden relative">
          {/* Projected (background) */}
          <div
            className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-700", projectedColor)}
            style={{ width: `${projectedPct}%` }}
          />
          {/* Actual spend */}
          <div
            className={cn("absolute inset-y-0 left-0 rounded-full transition-all duration-700", barColor)}
            style={{ width: `${spentPct}%` }}
          />
          {/* Day marker */}
          <div
            className="absolute top-0 bottom-0 w-px bg-white/30"
            style={{ left: `${daysPct}%` }}
          />
        </div>

        {/* Labels */}
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground tabular-nums">
            <span className="text-foreground font-medium">${budget.spent.toLocaleString()}</span>
            {" / "}${budget.totalBudget.toLocaleString()}
          </span>
          <span className="text-muted-foreground tabular-nums">
            {budget.daysRemaining}d remaining
          </span>
        </div>
      </div>

      {/* Projected */}
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", barColor)} />
          Spent: {spentPct.toFixed(0)}%
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-zinc-500/40" />
          Projected: ${budget.projectedSpend.toLocaleString()}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-white/30" />
          Time elapsed: {daysPct.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

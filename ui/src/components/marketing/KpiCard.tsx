import { cn } from "@/lib/utils";
import type { MarketingKpi } from "@/lib/marketing-api";
import { ArrowUp, ArrowDown, Minus } from "lucide-react";

interface KpiCardProps {
  kpi: MarketingKpi;
  className?: string;
}

function Sparkline({ data, className }: { data: number[]; className?: string }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const h = 28;
  const w = 64;
  const step = w / (data.length - 1);

  const points = data
    .map((v, i) => `${i * step},${h - ((v - min) / range) * h}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("w-16 h-7", className)} preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function TrendBadge({ trend, direction }: { trend: number; direction: "up" | "down" | "flat" }) {
  const Icon = direction === "up" ? ArrowUp : direction === "down" ? ArrowDown : Minus;
  const colorClass =
    direction === "up"
      ? "text-emerald-400"
      : direction === "down"
        ? "text-red-400"
        : "text-zinc-500";

  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", colorClass)}>
      <Icon className="h-3 w-3" />
      {Math.abs(trend).toFixed(1)}%
    </span>
  );
}

export function KpiCard({ kpi, className }: KpiCardProps) {
  return (
    <div className={cn("rounded-lg border border-border p-4 sm:p-5 space-y-2", className)}>
      <p className="text-xs font-medium text-muted-foreground tracking-wide">{kpi.label}</p>
      <div className="flex items-end justify-between gap-3">
        <div className="space-y-1">
          <p className="text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums">
            {kpi.formatted}
          </p>
          <TrendBadge trend={kpi.trend} direction={kpi.trendDirection} />
        </div>
        {kpi.sparkline.length > 1 && (
          <Sparkline
            data={kpi.sparkline}
            className={cn(
              kpi.trendDirection === "up"
                ? "text-emerald-400/60"
                : kpi.trendDirection === "down"
                  ? "text-red-400/60"
                  : "text-zinc-500/60",
            )}
          />
        )}
      </div>
    </div>
  );
}

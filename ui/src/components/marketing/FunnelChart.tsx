import { cn } from "@/lib/utils";
import type { FunnelStage } from "@/lib/marketing-api";

interface FunnelChartProps {
  stages: FunnelStage[];
  className?: string;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

const stageColors = [
  "from-blue-500/20 to-blue-500/10 border-blue-500/30",
  "from-indigo-500/20 to-indigo-500/10 border-indigo-500/30",
  "from-violet-500/20 to-violet-500/10 border-violet-500/30",
  "from-emerald-500/20 to-emerald-500/10 border-emerald-500/30",
];

const stageTextColors = [
  "text-blue-400",
  "text-indigo-400",
  "text-violet-400",
  "text-emerald-400",
];

export function FunnelChart({ stages, className }: FunnelChartProps) {
  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-end gap-2">
        {stages.map((stage, i) => {
          const heightPct = Math.max((stage.count / maxCount) * 100, 12);
          return (
            <div key={stage.name} className="flex-1 flex flex-col items-center gap-2">
              {/* Bar */}
              <div className="w-full flex flex-col items-center justify-end" style={{ height: 120 }}>
                <div
                  className={cn(
                    "w-full rounded-md border bg-gradient-to-b transition-all duration-500",
                    stageColors[i % stageColors.length],
                  )}
                  style={{ height: `${heightPct}%`, minHeight: 16 }}
                />
              </div>

              {/* Count */}
              <p className={cn("text-lg font-semibold tabular-nums", stageTextColors[i % stageTextColors.length])}>
                {formatCount(stage.count)}
              </p>

              {/* Label */}
              <p className="text-xs text-muted-foreground text-center leading-tight">{stage.name}</p>

              {/* Conversion rate arrow */}
              {stage.conversionRate !== null && i < stages.length - 1 && (
                <p className="text-[10px] text-muted-foreground/70 tabular-nums">
                  {stage.conversionRate.toFixed(1)}% &rarr;
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

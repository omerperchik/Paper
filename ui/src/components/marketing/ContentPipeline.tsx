import { cn } from "@/lib/utils";
import type { ContentPipelineStage } from "@/lib/marketing-api";

interface ContentPipelineProps {
  stages: ContentPipelineStage[];
  className?: string;
}

const stageColors = [
  "border-zinc-500/30 bg-zinc-500/10",
  "border-amber-500/30 bg-amber-500/10",
  "border-blue-500/30 bg-blue-500/10",
  "border-emerald-500/30 bg-emerald-500/10",
];

const countColors = [
  "text-zinc-300 bg-zinc-500/20",
  "text-amber-300 bg-amber-500/20",
  "text-blue-300 bg-blue-500/20",
  "text-emerald-300 bg-emerald-500/20",
];

export function ContentPipeline({ stages, className }: ContentPipelineProps) {
  return (
    <div className={cn("flex gap-2 overflow-x-auto pb-1", className)}>
      {stages.map((stage, i) => (
        <div
          key={stage.slug}
          className={cn(
            "flex-1 min-w-[100px] rounded-lg border p-3 sm:p-4 flex flex-col items-center gap-2",
            stageColors[i % stageColors.length],
          )}
        >
          <span
            className={cn(
              "text-xl sm:text-2xl font-semibold tabular-nums rounded-full h-10 w-10 sm:h-12 sm:w-12 flex items-center justify-center",
              countColors[i % countColors.length],
            )}
          >
            {stage.count}
          </span>
          <p className="text-xs font-medium text-muted-foreground text-center leading-tight">
            {stage.name}
          </p>
        </div>
      ))}
    </div>
  );
}

import { cn } from "@/lib/utils";
import type { ChannelPerformance } from "@/lib/marketing-api";

interface ChannelTableProps {
  channels: ChannelPerformance[];
  className?: string;
}

const statusConfig = {
  over_performing: { label: "Over", color: "text-emerald-400 bg-emerald-500/15" },
  on_target: { label: "On target", color: "text-zinc-400 bg-zinc-500/15" },
  under_performing: { label: "Under", color: "text-red-400 bg-red-500/15" },
} as const;

export function ChannelTable({ channels, className }: ChannelTableProps) {
  return (
    <div className={cn("rounded-lg border border-border overflow-hidden", className)}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className="px-4 py-3 text-xs font-medium text-muted-foreground tracking-wide">Channel</th>
              <th className="px-4 py-3 text-xs font-medium text-muted-foreground tracking-wide text-right">Spend</th>
              <th className="px-4 py-3 text-xs font-medium text-muted-foreground tracking-wide text-right">Conv.</th>
              <th className="px-4 py-3 text-xs font-medium text-muted-foreground tracking-wide text-right">CAC</th>
              <th className="px-4 py-3 text-xs font-medium text-muted-foreground tracking-wide text-right">ROAS</th>
              <th className="px-4 py-3 text-xs font-medium text-muted-foreground tracking-wide text-right">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {channels.map((ch) => {
              const status = statusConfig[ch.status];
              return (
                <tr key={ch.channel} className="hover:bg-accent/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{ch.channel}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    ${ch.spend.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {ch.conversions.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    ${ch.cac.toFixed(0)}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-3 text-right tabular-nums font-medium",
                      ch.roas >= 3 ? "text-emerald-400" : ch.roas >= 1 ? "text-zinc-200" : "text-red-400",
                    )}
                  >
                    {ch.roas.toFixed(1)}x
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span
                      className={cn(
                        "inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                        status.color,
                      )}
                    >
                      {status.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

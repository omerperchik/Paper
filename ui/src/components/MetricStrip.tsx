// MetricStrip — a dense, single-row replacement for the old 4x giant
// MetricCard grid. Each pill is compact (~56px tall): icon, value, label,
// thin secondary line. Designed for maximum info density so the rest of
// the dashboard can actually fit on one screen.

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@/lib/router";
import { cn } from "../lib/utils";

export interface MetricStripItem {
  icon: LucideIcon;
  value: string | number;
  label: string;
  hint?: ReactNode;
  to?: string;
  tone?: "default" | "warn" | "danger" | "ok";
}

const TONE_CLASSES: Record<NonNullable<MetricStripItem["tone"]>, string> = {
  default: "text-foreground",
  warn: "text-amber-600 dark:text-amber-400",
  danger: "text-red-600 dark:text-red-400",
  ok: "text-emerald-600 dark:text-emerald-400",
};

export function MetricStrip({ items }: { items: MetricStripItem[] }) {
  return (
    <div className="grid grid-cols-2 divide-border rounded-xl border border-border bg-card/40 sm:grid-cols-3 lg:grid-cols-5 sm:divide-x">
      {items.map((item, i) => {
        const Icon = item.icon;
        const tone = TONE_CLASSES[item.tone ?? "default"];
        const inner = (
          <div
            className={cn(
              "flex items-center gap-3 px-4 py-2.5 transition-colors",
              item.to ? "hover:bg-accent/40 cursor-pointer" : "",
              i < items.length && "border-b border-border sm:border-b-0",
            )}
          >
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground/70" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className={cn("text-lg font-semibold tabular-nums leading-none", tone)}>
                  {item.value}
                </span>
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground truncate">
                  {item.label}
                </span>
              </div>
              {item.hint && (
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{item.hint}</div>
              )}
            </div>
          </div>
        );

        if (item.to) {
          return (
            <Link key={item.label} to={item.to} className="no-underline text-inherit">
              {inner}
            </Link>
          );
        }
        return <div key={item.label}>{inner}</div>;
      })}
    </div>
  );
}

import { Download, Star } from "lucide-react";

interface MarketplaceCardProps {
  id: string;
  name: string;
  author: string;
  description: string;
  icon?: string;
  category: string;
  rating: number;
  ratingCount: number;
  installCount: number;
  installed?: boolean;
  onInstall?: () => void;
  onClick?: () => void;
}

function categoryLabel(cat: string): string {
  const labels: Record<string, string> = {
    skill: "Skill",
    template: "Template",
    integration: "Integration",
    agent_template: "Agent",
  };
  return labels[cat] ?? cat;
}

function categoryColor(cat: string): string {
  const colors: Record<string, string> = {
    skill: "bg-violet-500/15 text-violet-400",
    template: "bg-sky-500/15 text-sky-400",
    integration: "bg-emerald-500/15 text-emerald-400",
    agent_template: "bg-amber-500/15 text-amber-400",
  };
  return colors[cat] ?? "bg-muted text-muted-foreground";
}

export function MarketplaceCard({
  name,
  author,
  description,
  icon,
  category,
  rating,
  ratingCount,
  installCount,
  installed,
  onInstall,
  onClick,
}: MarketplaceCardProps) {
  return (
    <div
      onClick={onClick}
      className="group relative flex flex-col rounded-lg border border-border bg-card p-5 transition-all hover:border-border/80 hover:bg-accent/30 cursor-pointer"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-lg">
          {icon || "📦"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold truncate">{name}</h3>
            <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${categoryColor(category)}`}>
              {categoryLabel(category)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">by {author}</p>
        </div>
      </div>

      <p className="mt-3 text-xs text-muted-foreground line-clamp-2 flex-1">
        {description}
      </p>

      <div className="mt-4 flex items-center justify-between border-t border-border/50 pt-3">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
            <span className="tabular-nums">{rating.toFixed(1)}</span>
            <span className="text-muted-foreground/50">({ratingCount})</span>
          </span>
          <span className="flex items-center gap-1">
            <Download className="h-3 w-3" />
            <span className="tabular-nums">{installCount.toLocaleString()}</span>
          </span>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onInstall?.();
          }}
          disabled={installed}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            installed
              ? "bg-muted text-muted-foreground cursor-default"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          }`}
        >
          {installed ? "Installed" : "Install"}
        </button>
      </div>
    </div>
  );
}

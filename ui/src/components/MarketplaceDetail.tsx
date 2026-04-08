import { X, Star, Download, Clock, Tag } from "lucide-react";

interface MarketplaceDetailProps {
  item: {
    id: string;
    name: string;
    author: string;
    description: string;
    longDescription?: string;
    icon?: string;
    category: string;
    version: string;
    changelog?: string;
    rating: number;
    ratingCount: number;
    installCount: number;
    tags: string[];
    createdAt: string;
    updatedAt: string;
  };
  installed?: boolean;
  onInstall?: () => void;
  onClose: () => void;
}

function categoryLabel(cat: string): string {
  const labels: Record<string, string> = {
    skill: "Skill",
    template: "Template",
    integration: "Integration",
    agent_template: "Agent Template",
  };
  return labels[cat] ?? cat;
}

export function MarketplaceDetail({ item, installed, onInstall, onClose }: MarketplaceDetailProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-card shadow-2xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="border-b border-border p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-muted/50 text-2xl">
              {item.icon || "📦"}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold">{item.name}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                by {item.author} &middot; {categoryLabel(item.category)}
              </p>

              <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                  <span className="tabular-nums">{item.rating.toFixed(1)}</span>
                  <span className="text-muted-foreground/50">({item.ratingCount} ratings)</span>
                </span>
                <span className="flex items-center gap-1">
                  <Download className="h-3.5 w-3.5" />
                  <span className="tabular-nums">{item.installCount.toLocaleString()}</span>
                  <span className="text-muted-foreground/50">installs</span>
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  v{item.version}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <button
              onClick={onInstall}
              disabled={installed}
              className={`rounded-md px-5 py-2 text-sm font-medium transition-colors ${
                installed
                  ? "bg-muted text-muted-foreground cursor-default"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              }`}
            >
              {installed ? "Installed" : "Install"}
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Description */}
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Description
            </h3>
            <p className="text-sm leading-relaxed">
              {item.longDescription || item.description}
            </p>
          </div>

          {/* Tags */}
          {item.tags.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Tags
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {item.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-muted/50 px-2.5 py-0.5 text-xs text-muted-foreground"
                  >
                    <Tag className="h-2.5 w-2.5" />
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Changelog */}
          {item.changelog && (
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Changelog
              </h3>
              <pre className="text-xs text-muted-foreground whitespace-pre-wrap bg-muted/30 rounded-md p-3 border border-border/50">
                {item.changelog}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

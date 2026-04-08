import { Building2, TrendingUp, DollarSign, Target } from "lucide-react";

interface TenantClientCardProps {
  clientName: string;
  companyId: string;
  product?: string;
  cacCents?: number;
  spendCents?: number;
  status?: "active" | "paused" | "onboarding";
  onRemove?: () => void;
  onClick?: () => void;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function TenantClientCard({
  clientName,
  companyId,
  product,
  cacCents = 4200,
  spendCents = 125000,
  status = "active",
  onRemove,
  onClick,
}: TenantClientCardProps) {
  const statusColors = {
    active: "bg-emerald-500/20 text-emerald-400",
    paused: "bg-amber-500/20 text-amber-400",
    onboarding: "bg-blue-500/20 text-blue-400",
  };

  return (
    <div
      onClick={onClick}
      className={`group relative rounded-lg border border-border bg-card p-5 transition-all hover:border-border/80 hover:bg-accent/30 ${onClick ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted/50">
            <Building2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{clientName}</h3>
            {product && (
              <p className="text-xs text-muted-foreground truncate mt-0.5">{product}</p>
            )}
          </div>
        </div>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusColors[status]}`}>
          {status}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2">
          <Target className="h-3.5 w-3.5 text-muted-foreground/60" />
          <div>
            <p className="text-xs text-muted-foreground">CAC</p>
            <p className="text-sm font-medium tabular-nums">{formatCents(cacCents)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DollarSign className="h-3.5 w-3.5 text-muted-foreground/60" />
          <div>
            <p className="text-xs text-muted-foreground">Spend</p>
            <p className="text-sm font-medium tabular-nums">{formatCents(spendCents)}</p>
          </div>
        </div>
      </div>

      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs text-muted-foreground hover:text-destructive px-1.5 py-0.5 rounded"
        >
          Remove
        </button>
      )}
    </div>
  );
}

import { cn } from "@/lib/utils";
import type { Campaign, CampaignPlatform, CampaignStatus } from "@/lib/marketing-api";
import { Globe, Facebook, Linkedin, Twitter, Mail, Search } from "lucide-react";

interface CampaignCardProps {
  campaign: Campaign;
  className?: string;
}

const platformIcons: Record<CampaignPlatform, typeof Globe> = {
  google_ads: Globe,
  meta: Facebook,
  linkedin: Linkedin,
  twitter: Twitter,
  email: Mail,
  seo: Search,
};

const platformLabels: Record<CampaignPlatform, string> = {
  google_ads: "Google Ads",
  meta: "Meta",
  linkedin: "LinkedIn",
  twitter: "X / Twitter",
  email: "Email",
  seo: "SEO",
};

const statusStyles: Record<CampaignStatus, { bg: string; text: string; label: string }> = {
  active: { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "Active" },
  paused: { bg: "bg-amber-500/15", text: "text-amber-400", label: "Paused" },
  completed: { bg: "bg-zinc-500/15", text: "text-zinc-400", label: "Completed" },
};

function MiniSparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const h = 20;
  const w = 56;
  const step = w / (data.length - 1);

  const points = data
    .map((v, i) => `${i * step},${h - ((v - min) / range) * h}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-14 h-5 text-muted-foreground/40" preserveAspectRatio="none">
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

export function CampaignCard({ campaign, className }: CampaignCardProps) {
  const Icon = platformIcons[campaign.platform] ?? Globe;
  const status = statusStyles[campaign.status];
  const spendPct = campaign.budget > 0 ? Math.min((campaign.spend / campaign.budget) * 100, 100) : 0;
  const isOverBudget = campaign.spend > campaign.budget * 0.9;

  return (
    <div className={cn("rounded-lg border border-border p-4 space-y-3 hover:bg-accent/30 transition-colors", className)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{campaign.name}</p>
            <p className="text-[10px] text-muted-foreground">{platformLabels[campaign.platform]}</p>
          </div>
        </div>
        <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0", status.bg, status.text)}>
          {status.label}
        </span>
      </div>

      {/* Budget bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums">
          <span>${campaign.spend.toLocaleString()}</span>
          <span>${campaign.budget.toLocaleString()}</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-muted/30 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              isOverBudget ? "bg-amber-500" : "bg-blue-500",
            )}
            style={{ width: `${spendPct}%` }}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">ROAS</p>
          <p
            className={cn(
              "text-sm font-semibold tabular-nums",
              campaign.roas >= 3 ? "text-emerald-400" : campaign.roas >= 1 ? "text-zinc-200" : "text-red-400",
            )}
          >
            {campaign.roas.toFixed(1)}x
          </p>
        </div>
        <MiniSparkline data={campaign.sparkline} />
      </div>
    </div>
  );
}

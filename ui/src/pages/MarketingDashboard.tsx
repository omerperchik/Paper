import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { marketingApi, marketingQueryKeys } from "../lib/marketing-api";
import type { MarketingKpis } from "../lib/marketing-api";
import { KpiCard } from "../components/marketing/KpiCard";
import { FunnelChart } from "../components/marketing/FunnelChart";
import { CampaignCard } from "../components/marketing/CampaignCard";
import { BudgetBurnBar } from "../components/marketing/BudgetBurnBar";
import { ChannelTable } from "../components/marketing/ChannelTable";
import { ActivityFeed } from "../components/marketing/ActivityFeed";
import { ContentPipeline } from "../components/marketing/ContentPipeline";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Megaphone } from "lucide-react";

function kpiList(kpis: MarketingKpis) {
  return [
    kpis.blendedCac,
    kpis.ltvCacRatio,
    kpis.monthlyRevenue,
    kpis.totalSpend,
    kpis.activeCampaigns,
    kpis.conversionRate,
  ];
}

export function MarketingDashboard() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Marketing" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: marketingQueryKeys.dashboard(selectedCompanyId!),
    queryFn: () => marketingApi.fetchDashboard(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 30_000, // 30s for KPIs
  });

  const { data: campaigns } = useQuery({
    queryKey: marketingQueryKeys.campaigns(selectedCompanyId!),
    queryFn: () => marketingApi.fetchCampaigns(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 5 * 60_000, // 5 min
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={Megaphone} message="Select a company to view the marketing dashboard." />;
  }

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <p className="text-sm text-destructive">{error.message}</p>
      </div>
    );
  }

  if (!data) return null;

  const allCampaigns = campaigns ?? data.campaigns;

  return (
    <div className="space-y-6">
      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-2">
        {kpiList(data.kpis).map((kpi) => (
          <KpiCard key={kpi.label} kpi={kpi} />
        ))}
      </div>

      {/* Funnel + Budget */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border p-4 sm:p-5 space-y-3">
          <h3 className="text-xs font-medium text-muted-foreground tracking-wide">Conversion Funnel</h3>
          <FunnelChart stages={data.funnel.stages} />
        </div>
        <BudgetBurnBar budget={data.budget} />
      </div>

      {/* Channel Performance */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Channel Performance
        </h3>
        <ChannelTable channels={data.channels} />
      </div>

      {/* Active Campaigns */}
      {allCampaigns.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Active Campaigns
          </h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {allCampaigns.map((campaign) => (
              <CampaignCard key={campaign.id} campaign={campaign} />
            ))}
          </div>
        </div>
      )}

      {/* Content Pipeline + Agent Activity */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Content Pipeline
          </h3>
          <ContentPipeline stages={data.contentPipeline.stages} />
        </div>
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Agent Activity
          </h3>
          <ActivityFeed actions={data.activity.slice(0, 8)} />
        </div>
      </div>
    </div>
  );
}

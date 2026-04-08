import { api } from "../api/client";

// ---- Types ----

export interface MarketingKpi {
  label: string;
  value: number;
  formatted: string;
  trend: number; // percentage change, positive = up
  trendDirection: "up" | "down" | "flat";
  sparkline: number[]; // last 7 data points
}

export interface MarketingKpis {
  blendedCac: MarketingKpi;
  ltvCacRatio: MarketingKpi;
  monthlyRevenue: MarketingKpi;
  totalSpend: MarketingKpi;
  activeCampaigns: MarketingKpi;
  conversionRate: MarketingKpi;
}

export interface FunnelStage {
  name: string;
  count: number;
  conversionRate: number | null; // null for last stage
}

export interface MarketingFunnel {
  stages: FunnelStage[];
}

export type CampaignStatus = "active" | "paused" | "completed";
export type CampaignPlatform = "google_ads" | "meta" | "linkedin" | "twitter" | "email" | "seo";

export interface Campaign {
  id: string;
  name: string;
  platform: CampaignPlatform;
  status: CampaignStatus;
  spend: number;
  budget: number;
  roas: number;
  sparkline: number[]; // last 7 days
  updatedAt: string;
}

export interface ChannelPerformance {
  channel: string;
  spend: number;
  conversions: number;
  cac: number;
  roas: number;
  status: "over_performing" | "on_target" | "under_performing";
}

export interface BudgetOverview {
  totalBudget: number;
  spent: number;
  projectedSpend: number;
  daysRemaining: number;
  daysTotal: number;
}

export interface AgentAction {
  id: string;
  agentName: string;
  agentIcon: string;
  action: string;
  timestamp: string;
  issueId: string | null;
  issueIdentifier: string | null;
}

export interface ContentPipelineStage {
  name: string;
  slug: string;
  count: number;
}

export interface ContentPipeline {
  stages: ContentPipelineStage[];
}

export interface Product {
  id: string;
  name: string;
  description: string;
  status: string;
}

export interface MarketingDashboard {
  kpis: MarketingKpis;
  funnel: MarketingFunnel;
  campaigns: Campaign[];
  channels: ChannelPerformance[];
  budget: BudgetOverview;
  activity: AgentAction[];
  contentPipeline: ContentPipeline;
}

// ---- API Functions ----

export const marketingApi = {
  fetchDashboard: (companyId: string) =>
    api.get<MarketingDashboard>(`/companies/${companyId}/marketing/dashboard`),

  fetchKpis: (companyId: string) =>
    api.get<MarketingKpis>(`/companies/${companyId}/marketing/kpis`),

  fetchCampaigns: (companyId: string) =>
    api.get<Campaign[]>(`/companies/${companyId}/marketing/campaigns`),

  fetchFunnel: (companyId: string) =>
    api.get<MarketingFunnel>(`/companies/${companyId}/marketing/funnel`),

  fetchBudget: (companyId: string) =>
    api.get<BudgetOverview>(`/companies/${companyId}/marketing/budget`),

  fetchContent: (companyId: string) =>
    api.get<ContentPipeline>(`/companies/${companyId}/marketing/content`),

  fetchProducts: (companyId: string) =>
    api.get<Product[]>(`/companies/${companyId}/marketing/products`),
};

// ---- Query Keys ----

export const marketingQueryKeys = {
  dashboard: (companyId: string) => ["marketing", "dashboard", companyId] as const,
  kpis: (companyId: string) => ["marketing", "kpis", companyId] as const,
  campaigns: (companyId: string) => ["marketing", "campaigns", companyId] as const,
  funnel: (companyId: string) => ["marketing", "funnel", companyId] as const,
  budget: (companyId: string) => ["marketing", "budget", companyId] as const,
  content: (companyId: string) => ["marketing", "content", companyId] as const,
  products: (companyId: string) => ["marketing", "products", companyId] as const,
};

// ---------------------------------------------------------------------------
// Shared type definitions for the competitive intelligence plugin
// ---------------------------------------------------------------------------

/**
 * Plugin context passed to setup and tool handlers.
 * Simplified type -- the real type comes from the plugin SDK.
 */
export interface PluginContext {
  logger: {
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
  };
  events: {
    on(event: string, handler: (event: { entityId: string; [key: string]: unknown }) => Promise<void>): void;
    emit(event: string, payload: Record<string, unknown>): Promise<void>;
  };
  jobs: {
    register(key: string, handler: (job: { runId: string }) => Promise<void>): void;
  };
  tools: {
    register(name: string, handler: (input: { params: Record<string, unknown> }) => Promise<unknown>): void;
  };
  data: {
    register(key: string, handler: (input: { companyId: string | number }) => Promise<unknown>): void;
  };
  state: {
    get(key: { scopeKind: string; scopeId: string; stateKey: string }): Promise<unknown>;
    set(key: { scopeKind: string; scopeId: string; stateKey: string }, value: string): Promise<void>;
  };
  secrets: {
    get(ref: string): Promise<string | null>;
  };
  config: {
    get(key: string): Promise<unknown>;
  };
  http: {
    get(url: string, opts?: { headers?: Record<string, string> }): Promise<{ data: unknown }>;
    post(url: string, opts?: { headers?: Record<string, string>; body?: string }): Promise<{ data: unknown }>;
  };
}

// -- Domain types -----------------------------------------------------------

export interface Competitor {
  id: string;
  name: string;
  domain: string;
  notes?: string;
  addedAt: string;
  lastScannedAt?: string;
}

export interface WebsiteSnapshot {
  competitorId: string;
  scannedAt: string;
  pages: PageSnapshot[];
}

export interface PageSnapshot {
  url: string;
  title?: string;
  metaDescription?: string;
  headings: string[];
  features: string[];
  pricingTiers: PricingTier[];
  techSignals: string[];
  textContent: string;
}

export interface PricingTier {
  name: string;
  price: string;
  period?: string;
  features: string[];
}

export interface PriceChangeRecord {
  competitorId: string;
  detectedAt: string;
  previousSnapshot: PricingTier[];
  currentSnapshot: PricingTier[];
  changes: string[];
}

export interface AdSnapshot {
  competitorId: string;
  platform: string;
  scannedAt: string;
  ads: AdEntry[];
}

export interface AdEntry {
  id: string;
  headline?: string;
  body?: string;
  imageUrl?: string;
  landingUrl?: string;
  startDate?: string;
  status: string;
}

export interface KeywordGapEntry {
  keyword: string;
  volume: number;
  competitorRank?: number;
  competitorId: string;
  ownRank?: number | null;
  difficulty?: number;
  opportunity: "high" | "medium" | "low";
}

export interface ContentGapEntry {
  topic: string;
  contentType: string;
  competitorId: string;
  competitorUrl: string;
  relevanceScore: number;
}

export interface ShareOfVoiceEntry {
  keyword: string;
  volume: number;
  ownPosition?: number | null;
  competitors: Array<{ competitorId: string; position?: number | null }>;
  ownVisibilityScore: number;
}

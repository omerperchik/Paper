// ---------------------------------------------------------------------------
// Shared type definitions for the meta-optimizer plugin
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

export interface OutcomeRecord {
  id: string;
  agentId: string;
  outcomeType: string;
  value: number;
  metadata?: Record<string, unknown>;
  promptSnippet?: string;
  promptHash?: string;
  latencyMs?: number;
  costUsd?: number;
  recordedAt: string;
}

export interface AgentStats {
  agentId: string;
  totalRuns: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgQuality: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  avgCostUsd: number;
  outcomesByType: Record<string, { count: number; avgValue: number; minValue: number; maxValue: number }>;
  lastUpdated: string;
}

export interface PromptPattern {
  hash: string;
  snippet: string;
  agentId: string;
  usageCount: number;
  avgOutcomeValue: number;
  outcomeType: string;
  stdDev: number;
  firstSeen: string;
  lastSeen: string;
}

export interface Experiment {
  experimentId: string;
  agentId: string;
  hypothesis: string;
  controlDescription: string;
  treatmentDescription: string;
  primaryMetric: string;
  targetSampleSize: number;
  status: "running" | "completed" | "stopped";
  createdAt: string;
  completedAt?: string;
  controlObservations: number[];
  treatmentObservations: number[];
}

export interface ExperimentResult {
  experimentId: string;
  status: string;
  controlMean: number;
  treatmentMean: number;
  lift: number;
  liftPercent: number;
  pValue: number;
  isSignificant: boolean;
  confidenceInterval: { lower: number; upper: number };
  controlN: number;
  treatmentN: number;
  recommendation: string;
}

export interface PlaybookSuggestion {
  area: string;
  currentPattern: string;
  suggestedChange: string;
  expectedImpact: string;
  confidence: "high" | "medium" | "low";
  supportingData: string;
}

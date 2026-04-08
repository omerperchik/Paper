// ---------------------------------------------------------------------------
// Shared type aliases for the marketing tools plugin
// ---------------------------------------------------------------------------

/**
 * Plugin context passed to setup and tool handlers.
 * This is a simplified type — the real type comes from the plugin SDK.
 */
export interface PluginContext {
  logger: {
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
  };
  events: {
    on(event: string, handler: (event: { entityId: string; [key: string]: unknown }) => Promise<void>): void;
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

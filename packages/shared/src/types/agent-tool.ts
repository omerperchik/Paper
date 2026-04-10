// Agent-ergonomic tool response envelope. Inspired by the AXI (axi.md)
// "10 principles for agent-ergonomic CLI" playbook. Every tool that
// agents call returns a predictable shape so the model never has to
// guess where to find count, where to find items, or what to do next.
//
// Design goals:
// 1. One envelope shape across every tool — agents learn it once.
// 2. Lists always ship with aggregates inline (breakdown, total) so
//    the agent doesn't need a second round-trip to count things.
// 3. Truncated content carries the original size + an escape hatch
//    ("call with offset=N for more"). Silent truncation is a bug.
// 4. Empty states are *explicit* — a human-readable `message` string,
//    not just an empty array the model has to interpret.
// 5. Every response can carry a `nextHint` — a short sentence that
//    tells the agent what it should probably do next given the result.
//    This costs ~15 tokens but saves entire tool-loop iterations.
// 6. Errors use a structured `error` object with a stable `code` so
//    the agent can retry intelligently.

export interface AgentToolError {
  /** Short stable code like "web_fetch_failed", "not_a_file", "github_404". */
  code: string;
  /** Human-readable explanation. Include enough context to fix. */
  message: string;
  /** True if a naive retry might succeed (timeouts, rate limits). */
  retry?: boolean;
}

export interface AgentToolResponse<T = unknown> {
  /** Always present. true = caller should consume `data`/`items`. false = consume `error`. */
  ok: boolean;

  // ---------- list responses ----------
  /** Number of items actually returned in `items`. */
  count?: number;
  /** Real total if larger than `count` (e.g. pagination). Omit if equal to count. */
  total?: number;
  /** Pre-computed aggregates over the full result set, not just `items`. */
  breakdown?: Record<string, number>;
  /** The actual items. Trimmed to 3–4 fields per row by default. */
  items?: T[];

  // ---------- scalar / single-object responses ----------
  /** Used for tools that return a single record (create, update, read one file, etc). */
  data?: T;

  // ---------- truncation ----------
  /** True if content was truncated. Callers should also see `originalBytes`. */
  truncated?: boolean;
  /** Bytes before truncation. Agent can decide whether to re-fetch with offset. */
  originalBytes?: number;
  /** Bytes returned after truncation. */
  returnedBytes?: number;

  // ---------- metadata for the agent ----------
  /** Explicit human-readable explanation of the result. REQUIRED on empty states. */
  message?: string;
  /** Short sentence telling the agent what to do next given this result. */
  nextHint?: string;

  // ---------- error ----------
  error?: AgentToolError;
}

/** Convenience constructors to keep route handlers terse and consistent. */
export const toolResponse = {
  ok<T>(init: Omit<AgentToolResponse<T>, "ok">): AgentToolResponse<T> {
    return { ok: true, ...init };
  },
  list<T>(init: {
    items: T[];
    total?: number;
    breakdown?: Record<string, number>;
    truncated?: boolean;
    message?: string;
    nextHint?: string;
  }): AgentToolResponse<T> {
    return {
      ok: true,
      count: init.items.length,
      total: init.total ?? init.items.length,
      items: init.items,
      ...(init.breakdown ? { breakdown: init.breakdown } : {}),
      ...(init.truncated ? { truncated: true } : {}),
      ...(init.message ? { message: init.message } : {}),
      ...(init.nextHint ? { nextHint: init.nextHint } : {}),
    };
  },
  empty(message: string, nextHint?: string): AgentToolResponse<never> {
    return {
      ok: true,
      count: 0,
      total: 0,
      items: [],
      message,
      ...(nextHint ? { nextHint } : {}),
    };
  },
  fail(error: AgentToolError): AgentToolResponse<never> {
    return { ok: false, error };
  },
};

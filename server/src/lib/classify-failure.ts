/**
 * Structured failure taxonomy for heartbeat runs.
 *
 * The goal is to answer "where are the 70 points of success we're leaving on
 * the table" without having to grep logs. Every failed run is bucketed into
 * exactly one class by a pure function so the classification is reproducible
 * and easy to improve as new patterns show up.
 *
 * Buckets are grouped into four families:
 *
 *  1. Inference capacity  — the model couldn't run or was preempted
 *  2. Model output        — the model ran but output was unusable
 *  3. Control-plane       — not the agent's fault (infra / lifecycle)
 *  4. Agent logic         — the model produced valid output but the agent
 *                           workflow still failed (the last resort bucket)
 *
 * "succeeded" runs are not classified (function returns null).
 */

export type FailureClass =
  // Inference capacity
  | "timeout_inference"
  | "oom_inference"
  | "rate_limited"
  | "network_error"
  | "upstream_fallback_failed"
  // Model output
  | "parse_error"
  | "empty_output"
  | "guardrail_abort"
  | "tool_error"
  // Control-plane
  | "agent_not_found"
  | "process_lost"
  | "setup_error"
  // Explicit cancellation (not really a failure, but we track it)
  | "cancelled"
  // Catch-all for adapter-failed runs that matched no pattern
  | "logic_error"
  // Truly unclassified — every occurrence is a bug in this classifier
  | "unknown";

export type RunOutcome = "succeeded" | "failed" | "timed_out" | "cancelled";

export interface ClassifyFailureInput {
  outcome?: RunOutcome | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  stderrExcerpt?: string | null;
  stdoutExcerpt?: string | null;
  exitCode?: number | null;
  signal?: string | null;
  resultJson?: Record<string, unknown> | null;
}

/**
 * Map a run's terminal state + error context to a single failure class.
 * Returns null for succeeded runs.
 */
export function classifyFailure(input: ClassifyFailureInput): FailureClass | null {
  if (input.outcome === "succeeded") return null;

  const code = (input.errorCode ?? "").toLowerCase();
  const haystack = [
    input.errorMessage ?? "",
    input.stderrExcerpt ?? "",
    input.stdoutExcerpt ?? "",
  ]
    .join("\n")
    .toLowerCase();

  // ---- Direct error-code passthroughs (the caller already knows) ----
  if (code === "cancelled" || input.outcome === "cancelled") return "cancelled";
  if (code === "agent_not_found") return "agent_not_found";
  if (code === "process_lost") return "process_lost";
  if (code === "setup_error") return "setup_error";

  // ---- Inference capacity ----
  // Timeouts come from the adapter hitting its deadline. On a CPU-only box
  // running Ollama locally, this is almost always the #1 failure class.
  if (code === "timeout" || input.outcome === "timed_out") {
    return "timeout_inference";
  }

  // OOM: Ollama crashed, process killed by kernel, or GGML assert.
  if (
    /out of memory\b|\boom\b|cannot allocate|ggml_assert|enomem|killed.*memory|memory.*exhaust/i.test(
      haystack,
    )
  ) {
    return "oom_inference";
  }

  // Rate limiting from remote providers (MiniMax, Anthropic, etc.)
  if (/\brate.?limit|\b429\b|too many requests|quota exceeded/i.test(haystack)) {
    return "rate_limited";
  }

  // Transient network problems.
  if (
    /econnrefused|enotfound|eai_again|econnreset|epipe|etimedout|connection (refused|reset)|socket hang up|getaddrinfo|tls handshake/i.test(
      haystack,
    )
  ) {
    return "network_error";
  }

  // Both primary and fallback providers failed.
  if (/both providers failed|fallback.*(failed|exhausted)|all providers/i.test(haystack)) {
    return "upstream_fallback_failed";
  }

  // ---- Model output failures ----

  // Safety / policy filters (provider-side or local guardrails).
  if (/guardrail|safety filter|content filter|blocked by policy|refused to answer|unsafe content/i.test(haystack)) {
    return "guardrail_abort";
  }

  // JSON / tool-call parse errors. Very common with small local models.
  if (
    /could not parse|failed to parse|invalid json|unexpected token|malformed (json|tool|output)|json.*parse error|tool call.*invalid/i.test(
      haystack,
    )
  ) {
    return "parse_error";
  }

  // Explicit empty-output markers.
  if (/empty (response|output)|no (output|response) from model|model returned (nothing|empty)/i.test(haystack)) {
    return "empty_output";
  }

  // Heuristic empty output: adapter marked failed, exit code 0, no stderr, no
  // error message. The model ran to completion and produced nothing.
  if (
    input.outcome === "failed" &&
    (input.exitCode === 0 || input.exitCode == null) &&
    !(input.stdoutExcerpt ?? "").trim() &&
    !(input.stderrExcerpt ?? "").trim() &&
    !(input.errorMessage ?? "").trim()
  ) {
    return "empty_output";
  }

  // Tool-level failures: the model emitted a valid tool call but the tool
  // itself errored (HTTP 4xx/5xx, missing auth, downstream API broken).
  if (/\btool.*(error|failed|rejected)\b|http [45]\d{2}\b|status code [45]\d{2}|downstream.*error/i.test(haystack)) {
    return "tool_error";
  }

  // ---- Catch-all ----
  // adapter_failed from an unrecognized pattern = agent logic error
  if (code === "adapter_failed") return "logic_error";

  return "unknown";
}

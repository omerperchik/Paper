// ---------------------------------------------------------------------------
// Response parsing for OpenAI-compatible chat completions (Ollama / MiniMax)
// ---------------------------------------------------------------------------

export interface ParsedChatCompletion {
  content: string | null;
  toolCalls: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  finishReason: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
  };
  model: string | null;
}

/**
 * Parse a raw JSON response body from an OpenAI-compatible chat completions
 * endpoint (Ollama or MiniMax) into a normalised structure.
 */
export function parseChatCompletion(body: unknown): ParsedChatCompletion {
  const result: ParsedChatCompletion = {
    content: null,
    toolCalls: [],
    finishReason: null,
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
    model: null,
  };

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return result;
  }

  const rec = body as Record<string, unknown>;
  result.model = typeof rec.model === "string" ? rec.model : null;

  // Usage
  if (typeof rec.usage === "object" && rec.usage !== null) {
    const u = rec.usage as Record<string, unknown>;
    result.usage.inputTokens = safeInt(u.prompt_tokens) + safeInt(u.input_tokens);
    result.usage.outputTokens = safeInt(u.completion_tokens) + safeInt(u.output_tokens);
    const promptDetails = typeof u.prompt_tokens_details === "object" && u.prompt_tokens_details !== null
      ? u.prompt_tokens_details as Record<string, unknown>
      : null;
    result.usage.cachedInputTokens = safeInt(u.cached_tokens) + safeInt(promptDetails?.cached_tokens);
  }

  // Choices
  const choices = Array.isArray(rec.choices) ? rec.choices : [];
  if (choices.length === 0) return result;

  const choice = choices[0] as Record<string, unknown> | undefined;
  if (!choice || typeof choice !== "object") return result;

  result.finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : null;

  const message = choice.message as Record<string, unknown> | undefined;
  if (!message || typeof message !== "object") return result;

  if (typeof message.content === "string" && message.content.trim().length > 0) {
    result.content = message.content.trim();
  }

  // Tool calls
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      if (typeof tc !== "object" || tc === null) continue;
      const call = tc as Record<string, unknown>;
      const fn = call.function as Record<string, unknown> | undefined;
      if (!fn || typeof fn !== "object") continue;

      result.toolCalls.push({
        id: typeof call.id === "string" ? call.id : `call_${Math.random().toString(36).slice(2)}`,
        type: "function",
        function: {
          name: typeof fn.name === "string" ? fn.name : "unknown",
          arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
        },
      });
    }
  }

  return result;
}

/**
 * Extract a human-readable error message from an API error response body.
 */
export function parseErrorResponse(body: unknown): string | null {
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (trimmed.length > 0) return trimmed.slice(0, 500);
    return null;
  }
  if (typeof body !== "object" || body === null) return null;
  const rec = body as Record<string, unknown>;

  // Standard OpenAI error shape: { error: { message: "..." } }
  if (typeof rec.error === "object" && rec.error !== null) {
    const errObj = rec.error as Record<string, unknown>;
    if (typeof errObj.message === "string") return errObj.message;
  }
  // Flat error message
  if (typeof rec.error === "string") return rec.error;
  if (typeof rec.message === "string") return rec.message;
  if (typeof rec.detail === "string") return rec.detail;

  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function safeInt(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  return 0;
}

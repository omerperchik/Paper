// ---------------------------------------------------------------------------
// Gemma-local adapter: sends prompts to Ollama (OpenAI-compat) with MiniMax
// fallback.  Every AI call is trace-logged with model, fallback flag, latency,
// and token counts.
// ---------------------------------------------------------------------------

import type {
  AdapterExecutionContext,
  AdapterExecutionResult,
} from "@paperclipai/adapter-utils";
import {
  DEFAULT_OLLAMA_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_FALLBACK_URL,
  DEFAULT_FALLBACK_MODEL,
} from "../index.js";
import { parseChatCompletion, parseErrorResponse } from "./parse.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
  name?: string;
}

interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Build the chat messages array from the execution context
// ---------------------------------------------------------------------------

function buildMessages(ctx: AdapterExecutionContext, systemPrompt: string, prompt: string): ChatMessage[] {
  const messages: ChatMessage[] = [];

  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }

  // If conversation history is provided via context, include it
  const history = ctx.context.conversationHistory;
  if (Array.isArray(history)) {
    for (const entry of history) {
      if (typeof entry !== "object" || entry === null) continue;
      const msg = entry as Record<string, unknown>;
      const role = typeof msg.role === "string" ? msg.role : "";
      const content = typeof msg.content === "string" ? msg.content : "";
      if (role === "system" || role === "user" || role === "assistant" || role === "tool") {
        const chatMsg: ChatMessage = { role: role as ChatMessage["role"], content };
        if (role === "tool" && typeof msg.tool_call_id === "string") {
          chatMsg.tool_call_id = msg.tool_call_id;
        }
        if (role === "tool" && typeof msg.name === "string") {
          chatMsg.name = msg.name;
        }
        messages.push(chatMsg);
      }
    }
  }

  // The current prompt as the final user message
  if (prompt) {
    messages.push({ role: "user", content: prompt });
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Extract tool definitions from context
// ---------------------------------------------------------------------------

function buildTools(ctx: AdapterExecutionContext): ToolDefinition[] | undefined {
  const raw = ctx.context.tools;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  const tools: ToolDefinition[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const t = entry as Record<string, unknown>;
    const fn = t.function as Record<string, unknown> | undefined;
    if (!fn || typeof fn !== "object") continue;
    const name = typeof fn.name === "string" ? fn.name : "";
    if (!name) continue;
    tools.push({
      type: "function",
      function: {
        name,
        ...(typeof fn.description === "string" ? { description: fn.description } : {}),
        ...(typeof fn.parameters === "object" && fn.parameters !== null
          ? { parameters: fn.parameters as Record<string, unknown> }
          : {}),
      },
    });
  }

  return tools.length > 0 ? tools : undefined;
}

// ---------------------------------------------------------------------------
// HTTP fetch with timeout (AbortController based)
// ---------------------------------------------------------------------------

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Single-provider chat completion call
// ---------------------------------------------------------------------------

interface CallResult {
  ok: boolean;
  parsed: ReturnType<typeof parseChatCompletion> | null;
  errorMessage: string | null;
  latencyMs: number;
  wasFallback: boolean;
  model: string;
  provider: string;
}

async function callChatCompletion(opts: {
  baseUrl: string;
  model: string;
  apiKey: string | null;
  messages: ChatMessage[];
  tools: ToolDefinition[] | undefined;
  timeoutMs: number;
  provider: string;
  wasFallback: boolean;
}): Promise<CallResult> {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.apiKey) {
    headers["Authorization"] = `Bearer ${opts.apiKey}`;
  }

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
  };
  if (opts.tools) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }

  const start = performance.now();
  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }, opts.timeoutMs);

    const latencyMs = Math.round(performance.now() - start);
    const responseBody = await response.json() as unknown;

    if (!response.ok) {
      const errMsg = parseErrorResponse(responseBody) ?? `HTTP ${response.status} ${response.statusText}`;
      return {
        ok: false,
        parsed: null,
        errorMessage: errMsg,
        latencyMs,
        wasFallback: opts.wasFallback,
        model: opts.model,
        provider: opts.provider,
      };
    }

    const parsed = parseChatCompletion(responseBody);
    return {
      ok: true,
      parsed,
      errorMessage: null,
      latencyMs,
      wasFallback: opts.wasFallback,
      model: parsed.model ?? opts.model,
      provider: opts.provider,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    const isAbort = err instanceof DOMException && err.name === "AbortError";
    const errMsg = isAbort
      ? `Request timed out after ${Math.round(opts.timeoutMs / 1000)}s`
      : err instanceof Error
        ? err.message
        : String(err);
    return {
      ok: false,
      parsed: null,
      errorMessage: errMsg,
      latencyMs,
      wasFallback: opts.wasFallback,
      model: opts.model,
      provider: opts.provider,
    };
  }
}

// ---------------------------------------------------------------------------
// Trace logging helper
// ---------------------------------------------------------------------------

async function traceLog(
  onLog: AdapterExecutionContext["onLog"],
  call: CallResult,
): Promise<void> {
  const usage = call.parsed?.usage;
  const parts = [
    `[gemma-local] AI call trace:`,
    `provider=${call.provider}`,
    `model=${call.model}`,
    `was_fallback=${call.wasFallback}`,
    `latency_ms=${call.latencyMs}`,
    `ok=${call.ok}`,
  ];
  if (usage) {
    parts.push(
      `input_tokens=${usage.inputTokens}`,
      `output_tokens=${usage.outputTokens}`,
      `cached_input_tokens=${usage.cachedInputTokens}`,
    );
  }
  if (call.errorMessage) {
    parts.push(`error=${call.errorMessage}`);
  }
  await onLog("stderr", parts.join(" ") + "\n");
}

// ---------------------------------------------------------------------------
// Main execute function
// ---------------------------------------------------------------------------

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, config, context, onLog, onMeta } = ctx;

  // Read configuration
  const ollamaUrl = asString(config.ollamaUrl, DEFAULT_OLLAMA_URL);
  const ollamaModel = asString(config.ollamaModel, DEFAULT_OLLAMA_MODEL);
  const fallbackUrl = asString(config.fallbackUrl, DEFAULT_FALLBACK_URL);
  const fallbackModel = asString(config.fallbackModel, DEFAULT_FALLBACK_MODEL);
  const fallbackApiKey = asString(config.fallbackApiKey, "");
  const ollamaTimeoutSec = asNumber(config.timeoutSec, 240);
  const fallbackTimeoutSec = asNumber(config.fallbackTimeoutSec, 120);
  const systemPrompt = asString(config.systemPrompt, "");

  // Build prompt from template
  const promptTemplate = asString(
    config.promptTemplate,
    "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.",
  );
  const prompt = promptTemplate
    .replace(/\{\{agent\.id\}\}/g, agent.id)
    .replace(/\{\{agent\.name\}\}/g, agent.name)
    .replace(/\{\{agent\.companyId\}\}/g, agent.companyId)
    .replace(/\{\{runId\}\}/g, runId);

  // Build messages and tools
  const messages = buildMessages(ctx, systemPrompt, prompt);
  const tools = buildTools(ctx);

  // Emit invocation metadata
  if (onMeta) {
    await onMeta({
      adapterType: "gemma_local",
      command: `${ollamaUrl}/chat/completions`,
      cwd: process.cwd(),
      commandNotes: [
        `Primary: Ollama at ${ollamaUrl} model=${ollamaModel} timeout=${ollamaTimeoutSec}s`,
        `Fallback: MiniMax at ${fallbackUrl} model=${fallbackModel} timeout=${fallbackTimeoutSec}s`,
        `Messages: ${messages.length} (${tools ? tools.length + " tools" : "no tools"})`,
      ],
      prompt,
      context,
    });
  }

  await onLog("stderr", `[gemma-local] Starting execution run=${runId} agent=${agent.id}\n`);
  await onLog("stderr", `[gemma-local] Primary: ${ollamaUrl} model=${ollamaModel}\n`);

  // Attempt primary (Ollama)
  const primary = await callChatCompletion({
    baseUrl: ollamaUrl,
    model: ollamaModel,
    apiKey: null, // Ollama typically needs no auth
    messages,
    tools,
    timeoutMs: ollamaTimeoutSec * 1000,
    provider: "ollama",
    wasFallback: false,
  });
  await traceLog(onLog, primary);

  // If primary succeeded, return result
  if (primary.ok && primary.parsed) {
    return buildResult(primary, context);
  }

  // Primary failed — attempt fallback
  await onLog(
    "stderr",
    `[gemma-local] Primary (Ollama) failed: ${primary.errorMessage ?? "unknown error"}. Attempting MiniMax fallback.\n`,
  );

  if (!fallbackApiKey) {
    await onLog(
      "stderr",
      "[gemma-local] No fallbackApiKey configured; skipping MiniMax fallback.\n",
    );
    return buildErrorResult(primary, `Ollama failed: ${primary.errorMessage ?? "unknown"} (no fallback API key configured)`);
  }

  const fallback = await callChatCompletion({
    baseUrl: fallbackUrl,
    model: fallbackModel,
    apiKey: fallbackApiKey,
    messages,
    tools,
    timeoutMs: fallbackTimeoutSec * 1000,
    provider: "minimax",
    wasFallback: true,
  });
  await traceLog(onLog, fallback);

  if (fallback.ok && fallback.parsed) {
    return buildResult(fallback, context);
  }

  // Both failed
  const combinedError = [
    `Ollama: ${primary.errorMessage ?? "unknown"}`,
    `MiniMax: ${fallback.errorMessage ?? "unknown"}`,
  ].join("; ");
  await onLog("stderr", `[gemma-local] Both providers failed. ${combinedError}\n`);

  return buildErrorResult(fallback, combinedError);
}

// ---------------------------------------------------------------------------
// Result builders
// ---------------------------------------------------------------------------

function buildResult(
  call: CallResult,
  context: Record<string, unknown>,
): AdapterExecutionResult {
  const parsed = call.parsed!;
  const toolCalls = parsed.toolCalls.length > 0 ? parsed.toolCalls : undefined;

  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    usage: {
      inputTokens: parsed.usage.inputTokens,
      outputTokens: parsed.usage.outputTokens,
      cachedInputTokens: parsed.usage.cachedInputTokens,
    },
    provider: call.provider,
    biller: call.provider,
    model: call.model,
    billingType: call.wasFallback ? "api" : "unknown",
    summary: parsed.content,
    resultJson: {
      content: parsed.content,
      finishReason: parsed.finishReason,
      ...(toolCalls ? { toolCalls } : {}),
      wasFallback: call.wasFallback,
      latencyMs: call.latencyMs,
      provider: call.provider,
    },
  };
}

function buildErrorResult(
  call: CallResult,
  errorMessage: string,
): AdapterExecutionResult {
  return {
    exitCode: 1,
    signal: null,
    timedOut: call.errorMessage?.includes("timed out") ?? false,
    errorMessage,
    provider: call.provider,
    biller: call.provider,
    model: call.model,
    billingType: call.wasFallback ? "api" : "unknown",
    usage: call.parsed
      ? {
          inputTokens: call.parsed.usage.inputTokens,
          outputTokens: call.parsed.usage.outputTokens,
          cachedInputTokens: call.parsed.usage.cachedInputTokens,
        }
      : undefined,
    resultJson: {
      error: errorMessage,
      wasFallback: call.wasFallback,
      latencyMs: call.latencyMs,
      provider: call.provider,
    },
  };
}

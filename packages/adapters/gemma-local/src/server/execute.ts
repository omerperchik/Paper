// ---------------------------------------------------------------------------
// Gemma-local adapter: sends prompts to Ollama (native API with think=false)
// with MiniMax fallback (OpenAI-compat).  Every AI call is trace-logged with
// model, fallback flag, latency, and token counts.
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
import { getOllamaQueue } from "./ollama-queue.js";

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

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
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

/**
 * Call Ollama's native /api/chat endpoint.
 * This supports `think: false` to disable Gemma 4's extended thinking mode,
 * which is critical for CPU inference where reasoning tokens cause timeouts.
 */
async function callOllamaNative(opts: {
  baseUrl: string;
  model: string;
  messages: ChatMessage[];
  tools: ToolDefinition[] | undefined;
  timeoutMs: number;
  think: boolean;
  numPredict: number;
}): Promise<CallResult> {
  // Strip /v1 suffix if present — native API is at /api/chat
  const base = opts.baseUrl.replace(/\/v1\/?$/, "").replace(/\/+$/, "");
  const url = `${base}/api/chat`;

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: false,
    think: opts.think,
    options: {
      num_predict: opts.numPredict,
    },
  };
  if (opts.tools) {
    body.tools = opts.tools;
  }

  const start = performance.now();
  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, opts.timeoutMs);

    const latencyMs = Math.round(performance.now() - start);
    const responseBody = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      const errMsg = typeof responseBody.error === "string"
        ? responseBody.error
        : `HTTP ${response.status} ${response.statusText}`;
      return {
        ok: false, parsed: null, errorMessage: errMsg, latencyMs,
        wasFallback: false, model: opts.model, provider: "ollama",
      };
    }

    // Parse Ollama native response format
    const msg = responseBody.message as Record<string, unknown> | undefined;
    const content = typeof msg?.content === "string" ? msg.content : "";

    // Parse tool calls from native format
    const rawToolCalls = Array.isArray(msg?.tool_calls) ? msg.tool_calls as Array<Record<string, unknown>> : [];
    const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
    for (let i = 0; i < rawToolCalls.length; i++) {
      const tc = rawToolCalls[i];
      const fn = tc?.function as Record<string, unknown> | undefined;
      if (fn && typeof fn.name === "string") {
        toolCalls.push({
          id: `call_${i}`,
          type: "function",
          function: {
            name: fn.name,
            arguments: typeof fn.arguments === "string"
              ? fn.arguments
              : JSON.stringify(fn.arguments ?? {}),
          },
        });
      }
    }

    // Extract usage from Ollama native response
    const promptTokens = typeof responseBody.prompt_eval_count === "number" ? responseBody.prompt_eval_count : 0;
    const evalTokens = typeof responseBody.eval_count === "number" ? responseBody.eval_count : 0;

    return {
      ok: true,
      parsed: {
        content,
        finishReason: responseBody.done ? "stop" : "length",
        model: typeof responseBody.model === "string" ? responseBody.model : opts.model,
        toolCalls,
        usage: {
          inputTokens: promptTokens as number,
          outputTokens: evalTokens as number,
          cachedInputTokens: 0,
        },
      },
      errorMessage: null,
      latencyMs,
      wasFallback: false,
      model: typeof responseBody.model === "string" ? responseBody.model as string : opts.model,
      provider: "ollama",
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
      ok: false, parsed: null, errorMessage: errMsg, latencyMs,
      wasFallback: false, model: opts.model, provider: "ollama",
    };
  }
}

/**
 * Call OpenAI-compatible chat completions endpoint (used for MiniMax fallback).
 */
async function callOpenAICompat(opts: {
  baseUrl: string;
  model: string;
  apiKey: string | null;
  messages: ChatMessage[];
  tools: ToolDefinition[] | undefined;
  timeoutMs: number;
  maxTokens: number;
  provider: string;
}): Promise<CallResult> {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.apiKey) {
    headers["Authorization"] = `Bearer ${opts.apiKey}`;
  }

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.maxTokens,
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
        ok: false, parsed: null, errorMessage: errMsg, latencyMs,
        wasFallback: true, model: opts.model, provider: opts.provider,
      };
    }

    const parsed = parseChatCompletion(responseBody);
    return {
      ok: true, parsed, errorMessage: null, latencyMs,
      wasFallback: true, model: parsed.model ?? opts.model, provider: opts.provider,
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
      ok: false, parsed: null, errorMessage: errMsg, latencyMs,
      wasFallback: true, model: opts.model, provider: opts.provider,
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
  const ollamaTimeoutSec = asNumber(config.timeoutSec, 600);
  const fallbackTimeoutSec = asNumber(config.fallbackTimeoutSec, 120);
  const baseSystemPrompt = asString(config.systemPrompt, "");
  const enableThinking = asBool(config.enableThinking, false);
  const numPredict = asNumber(config.numPredict, 2048);

  // Autonomous work directive: if the heartbeat service injected a program.md
  // for this agent, prepend it to the system prompt so the model has its
  // identity, hypothesis, backlog, and known-bad list as context. When the
  // run has no explicit issue (autonomous heartbeat), also append a directive
  // telling the model to pick the next highest-priority backlog item and
  // produce real output (research note, copy draft, content piece, or a new
  // issue queued for follow-up) instead of idling.
  const programMd = typeof context.paperclipProgramMd === "string" ? context.paperclipProgramMd : "";
  const isAutonomousRun = context.paperclipAutonomousRun === true;
  let systemPrompt = baseSystemPrompt;
  if (programMd) {
    systemPrompt = [
      baseSystemPrompt,
      "---",
      "# Your program.md (autonomous mandate)",
      "",
      "This is your persistent identity, hypothesis, protocol, metric history, known-bad list, and backlog. Use it as the source of truth for what to work on.",
      "",
      programMd,
    ].filter((s) => s.length > 0).join("\n");
  }
  if (isAutonomousRun) {
    const autonomyDirective = [
      "---",
      "# Autonomous run directive",
      "",
      "This invocation has no explicit task assigned. You MUST produce real, useful marketing/research/content/copy work this turn — not a status check.",
      "",
      "Steps:",
      "1. Look at the backlog section of your program.md. Pick the single highest-priority item you can complete this turn.",
      "2. If the backlog is empty, generate ONE new backlog item grounded in your hypothesis and identity, then execute it.",
      "3. Execute the work end-to-end: do the research, write the copy, draft the content, run the analysis. Use your available tools to persist output (create issues, post comments, write files, publish drafts).",
      "4. Record what you did in your metric history (via the program.md update tool if available, otherwise as a comment on a tracking issue).",
      "5. Never return an empty turn. If you cannot complete the chosen item, split it into a smaller deliverable and complete that.",
    ].join("\n");
    systemPrompt = systemPrompt ? `${systemPrompt}\n${autonomyDirective}` : autonomyDirective;
  }

  // Queue configuration (can be overridden per-agent in adapter_config)
  const maxConcurrentOllama = asNumber(config.maxConcurrentOllama, 2);
  const maxQueueDepth = asNumber(config.maxQueueDepth, 3);
  const queueTimeoutMs = asNumber(config.queueTimeoutMs, 60_000);

  // Get or update the shared Ollama queue
  const ollamaQueue = getOllamaQueue({ maxConcurrentOllama, maxQueueDepth, queueTimeoutMs });

  // Build prompt from template. Default differs based on whether this is an
  // autonomous heartbeat run (no assigned issue) or a task-driven run.
  const defaultPromptTemplate = isAutonomousRun
    ? "You are {{agent.name}} ({{agent.id}}). This is an autonomous heartbeat turn — no task has been assigned. Per your system instructions, pick the next highest-priority item from your program.md backlog and execute it end-to-end this turn. Produce a concrete deliverable (research note, copy draft, content piece, analysis, or new issue) — do not return an empty turn."
    : "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.";
  const promptTemplate = asString(config.promptTemplate, defaultPromptTemplate);
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
      command: `${ollamaUrl}/api/chat`,
      cwd: process.cwd(),
      commandNotes: [
        `Primary: Ollama at ${ollamaUrl} model=${ollamaModel} timeout=${ollamaTimeoutSec}s think=${enableThinking} num_predict=${numPredict}`,
        `Fallback: MiniMax at ${fallbackUrl} model=${fallbackModel} timeout=${fallbackTimeoutSec}s`,
        `Queue: ${ollamaQueue.statusLine()}`,
        `Messages: ${messages.length} (${tools ? tools.length + " tools" : "no tools"})`,
      ],
      prompt,
      context,
    });
  }

  await onLog("stderr", `[gemma-local] Starting execution run=${runId} agent=${agent.id}\n`);
  await onLog("stderr", `[gemma-local] Primary: ${ollamaUrl} model=${ollamaModel} think=${enableThinking}\n`);
  await onLog("stderr", `[gemma-local] Queue: ${ollamaQueue.statusLine()}\n`);

  // ---------------------------------------------------------------------------
  // Acquire Ollama slot via the shared queue
  // ---------------------------------------------------------------------------
  const slotResult = await ollamaQueue.acquire();

  if (slotResult === "overflow") {
    // Queue is full — skip Ollama entirely, go straight to MiniMax
    await onLog(
      "stderr",
      `[gemma-local] Ollama queue full (${ollamaQueue.statusLine()}). Routing directly to MiniMax.\n`,
    );
    return await executeFallback(fallbackUrl, fallbackModel, fallbackApiKey, messages, tools, fallbackTimeoutSec, numPredict, onLog, context);
  }

  if (slotResult === "timeout") {
    // Waited too long in queue — go to MiniMax
    await onLog(
      "stderr",
      `[gemma-local] Ollama queue wait timed out after ${Math.round(queueTimeoutMs / 1000)}s. Routing to MiniMax.\n`,
    );
    return await executeFallback(fallbackUrl, fallbackModel, fallbackApiKey, messages, tools, fallbackTimeoutSec, numPredict, onLog, context);
  }

  // slotResult === "acquired" — we have an Ollama slot
  await onLog("stderr", `[gemma-local] Ollama slot acquired (${ollamaQueue.statusLine()})\n`);

  try {
    // Attempt primary (Ollama native API with think control)
    const primary = await callOllamaNative({
      baseUrl: ollamaUrl,
      model: ollamaModel,
      messages,
      tools,
      timeoutMs: ollamaTimeoutSec * 1000,
      think: enableThinking,
      numPredict,
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

    return await executeFallback(fallbackUrl, fallbackModel, fallbackApiKey, messages, tools, fallbackTimeoutSec, numPredict, onLog, context, primary);
  } finally {
    // ALWAYS release the Ollama slot
    ollamaQueue.release();
    await onLog("stderr", `[gemma-local] Ollama slot released (${ollamaQueue.statusLine()})\n`);
  }
}

// ---------------------------------------------------------------------------
// Fallback execution helper
// ---------------------------------------------------------------------------

async function executeFallback(
  fallbackUrl: string,
  fallbackModel: string,
  fallbackApiKey: string,
  messages: ChatMessage[],
  tools: ToolDefinition[] | undefined,
  fallbackTimeoutSec: number,
  numPredict: number,
  onLog: AdapterExecutionContext["onLog"],
  context: Record<string, unknown>,
  primaryResult?: CallResult,
): Promise<AdapterExecutionResult> {
  if (!fallbackApiKey) {
    await onLog(
      "stderr",
      "[gemma-local] No fallbackApiKey configured; skipping MiniMax fallback.\n",
    );
    const errorMsg = primaryResult
      ? `Ollama failed: ${primaryResult.errorMessage ?? "unknown"} (no fallback API key configured)`
      : "Ollama queue overflow (no fallback API key configured)";
    return buildErrorResult(
      primaryResult ?? { ok: false, parsed: null, errorMessage: errorMsg, latencyMs: 0, wasFallback: false, model: "", provider: "ollama" },
      errorMsg,
    );
  }

  // Retry transient upstream errors (overload, 5xx, rate limit) with
  // exponential backoff. Errors that are clearly not transient (auth, 4xx
  // except 429) bail out immediately so we don't burn the retry budget.
  const MAX_ATTEMPTS = 3;
  const BASE_DELAY_MS = 1500;
  let fallback: CallResult | null = null;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    fallback = await callOpenAICompat({
      baseUrl: fallbackUrl,
      model: fallbackModel,
      apiKey: fallbackApiKey,
      messages,
      tools,
      timeoutMs: fallbackTimeoutSec * 1000,
      maxTokens: numPredict,
      provider: "minimax",
    });
    await traceLog(onLog, fallback);

    if (fallback.ok && fallback.parsed) {
      if (attempt > 1) {
        await onLog(
          "stderr",
          `[gemma-local] MiniMax fallback succeeded on attempt ${attempt}/${MAX_ATTEMPTS}.\n`,
        );
      }
      return buildResult(fallback, context);
    }

    lastError = fallback.errorMessage ?? "unknown";
    const transient = isTransientUpstreamError(lastError);
    if (!transient || attempt === MAX_ATTEMPTS) {
      break;
    }
    // Exponential backoff with a bit of jitter.
    const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 500);
    await onLog(
      "stderr",
      `[gemma-local] MiniMax transient error on attempt ${attempt}/${MAX_ATTEMPTS} (${lastError}). Retrying in ${delayMs}ms.\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  // Fallback also failed after retries
  const primaryError = primaryResult?.errorMessage ?? "skipped (queue overflow)";
  const combinedError = [
    `Ollama: ${primaryError}`,
    `MiniMax: ${lastError ?? "unknown"}`,
  ].join("; ");
  await onLog("stderr", `[gemma-local] Both providers failed after retries. ${combinedError}\n`);

  return buildErrorResult(fallback ?? { ok: false, parsed: null, errorMessage: combinedError, latencyMs: 0, wasFallback: true, model: fallbackModel, provider: "minimax" }, combinedError);
}

/**
 * Decide whether a MiniMax error message looks like a transient upstream
 * problem that's worth retrying. Matches the error shapes we've actually
 * observed: HTTP 5xx, explicit "high load" messages, timeouts, MiniMax code
 * 1000/1002/2064.
 */
function isTransientUpstreamError(message: string): boolean {
  const lower = message.toLowerCase();
  if (/\b(5\d\d)\b/.test(lower)) return true; // any 5xx
  if (lower.includes("high load")) return true;
  if (lower.includes("rate limit")) return true;
  if (lower.includes("timed out") || lower.includes("etimedout") || lower.includes("econnreset")) return true;
  if (lower.includes("server cluster")) return true;
  // MiniMax-specific error codes observed in production
  if (/\b(1000|1002|1004|2064)\b/.test(lower)) return true;
  return false;
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

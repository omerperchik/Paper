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
import { buildExpertisePreamble } from "./expertise.js";

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

  // Ollama native API expects assistant tool_calls.function.arguments as an
  // object, not a JSON string. Convert any string-form arguments before
  // sending. (Our internal ChatMessage shape uses string for portability.)
  const ollamaMessages = opts.messages.map((m) => {
    if (m.role === "assistant" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
      return {
        ...m,
        tool_calls: m.tool_calls.map((tc) => {
          let argsObj: unknown = tc.function.arguments;
          if (typeof argsObj === "string") {
            try { argsObj = JSON.parse(argsObj); } catch { argsObj = {}; }
          }
          return {
            ...tc,
            function: { name: tc.function.name, arguments: argsObj },
          };
        }),
      };
    }
    return m;
  });

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: ollamaMessages,
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

// ---------------------------------------------------------------------------
// Tool execution: dispatch LLM tool_calls back to the local Paperclip API
// ---------------------------------------------------------------------------
//
// gemma-local agents are real workers, not chatbots — when a CEO decides to
// delegate, the LLM emits an OpenAI-format tool_call which we execute against
// the local Paperclip API using the agent's short-lived JWT (passed in via
// ctx.authToken). Results are appended to the conversation as tool messages
// and the LLM is invoked again. We cap the loop at MAX_TOOL_ITERATIONS to
// prevent runaways.
//
// Supported tools (defined server-side in agent-tool-definitions.ts):
//   paperclipListAgents      → GET  /api/companies/{companyId}/agents
//   paperclipListIssues      → GET  /api/companies/{companyId}/issues
//   paperclipCreateIssue     → POST /api/companies/{companyId}/issues
//   paperclipAddComment      → POST /api/issues/{issueId}/comments
//   paperclipUpdateIssue     → PATCH /api/issues/{issueId}
// ---------------------------------------------------------------------------

// Tool loop caps — deliberately permissive. The old cap of 6 iterations was
// a major bottleneck: real agentic research easily needs 20–50 tool calls
// (search → fetch → memory → delegate → comment → update). We now gate on
// three compound limits:
//   1. MAX_TOOL_ITERATIONS — ejection seat, not a working cap.
//   2. MAX_TOOL_CALLS_TOTAL — prevents runaway loops that batch many calls per iter.
//   3. MAX_WALL_CLOCK_MS — wall-clock cap so a stuck model doesn't burn budget.
// The model can also exit cleanly any time via paperclipDone().
const MAX_TOOL_ITERATIONS = 50;
const MAX_TOOL_CALLS_TOTAL = 120;
const MAX_WALL_CLOCK_MS = 9 * 60 * 1000;

interface ToolDispatchOptions {
  apiBase: string;
  authToken: string;
  companyId: string;
  agentId: string;
  runId: string;
  projectId?: string | null;
}

function safeParseArgs(raw: string): Record<string, unknown> {
  if (!raw || raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function dispatchToolCall(
  name: string,
  args: Record<string, unknown>,
  opts: ToolDispatchOptions,
): Promise<{ ok: boolean; result: string }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${opts.authToken}`,
  };
  const base = opts.apiBase.replace(/\/+$/, "");

  // Dispatch-level response cap. Most envelope tool responses are well
  // under this, but raw list endpoints (paperclipListAgents etc.) can be
  // large. We cap to protect the model's context, but unlike before we
  // tell the agent honestly when we had to truncate — silent truncation
  // is an agent-ergonomic bug (see AXI playbook, axi.md).
  const DISPATCH_RESPONSE_CAP = 8_000;

  const httpJson = async (method: string, path: string, body?: unknown) => {
    const response = await fetchWithTimeout(
      `${base}${path}`,
      {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      20_000,
    );
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        result: `HTTP ${response.status}: ${text.slice(0, 500)}`,
      };
    }
    if (text.length <= DISPATCH_RESPONSE_CAP) {
      return { ok: true, result: text };
    }
    // Over the cap — tell the agent exactly what happened so it can
    // retry with a tighter filter or call again with pagination.
    return {
      ok: true,
      result: `${text.slice(0, DISPATCH_RESPONSE_CAP)}\n\n[dispatch: truncated ${text.length - DISPATCH_RESPONSE_CAP} of ${text.length} chars. If you need more, call this tool again with tighter filters (status, limit, assigneeAgentId, offset, etc).]`,
    };
  };

  switch (name) {
    case "paperclipListAgents": {
      return httpJson("GET", `/api/companies/${opts.companyId}/agents`);
    }
    case "paperclipListIssues": {
      const params = new URLSearchParams();
      if (typeof args.assigneeAgentId === "string") params.set("assigneeAgentId", args.assigneeAgentId);
      if (typeof args.status === "string") params.set("status", args.status);
      const limit = typeof args.limit === "number" ? args.limit : 25;
      params.set("limit", String(limit));
      const qs = params.toString();
      return httpJson("GET", `/api/companies/${opts.companyId}/issues${qs ? `?${qs}` : ""}`);
    }
    case "paperclipCreateIssue": {
      const body: Record<string, unknown> = {
        title: typeof args.title === "string" ? args.title : "(untitled)",
      };
      // If a typed Handoff packet was provided, merge it into the
      // description as a structured section the assignee's context
      // waterfall will surface prominently. Also persist the raw packet
      // via metadata so downstream consumers (SLA tracking, retros) can
      // reference it. This is the "typed delegation" pattern — dramatically
      // reduces the ping-pong comments that normally follow a delegation.
      const handoff =
        args.handoff && typeof args.handoff === "object" && !Array.isArray(args.handoff)
          ? (args.handoff as Record<string, unknown>)
          : null;
      let description = typeof args.description === "string" ? args.description : "";
      if (handoff) {
        const lines: string[] = [];
        lines.push("## Handoff");
        if (typeof handoff.goal === "string" && handoff.goal.trim()) {
          lines.push(`**Goal:** ${handoff.goal.trim()}`);
        }
        if (Array.isArray(handoff.constraints) && handoff.constraints.length > 0) {
          lines.push("**Constraints:**");
          for (const c of handoff.constraints) {
            if (typeof c === "string" && c.trim()) lines.push(`- ${c.trim()}`);
          }
        }
        if (Array.isArray(handoff.successCriteria) && handoff.successCriteria.length > 0) {
          lines.push("**Success criteria:**");
          for (const c of handoff.successCriteria) {
            if (typeof c === "string" && c.trim()) lines.push(`- [ ] ${c.trim()}`);
          }
        }
        if (handoff.budget && typeof handoff.budget === "object") {
          const b = handoff.budget as Record<string, unknown>;
          const parts: string[] = [];
          if (typeof b.maxCents === "number") parts.push(`≤ $${(b.maxCents / 100).toFixed(2)}`);
          if (typeof b.maxIterations === "number") parts.push(`≤ ${b.maxIterations} heartbeats`);
          if (typeof b.deadline === "string" && b.deadline.trim()) parts.push(`by ${b.deadline.trim()}`);
          if (parts.length > 0) lines.push(`**Budget:** ${parts.join(", ")}`);
        }
        const section = lines.join("\n");
        description = description ? `${section}\n\n${description}` : section;
        body.handoff = handoff;
      }
      if (description) body.description = description;
      if (typeof args.assigneeAgentId === "string") body.assigneeAgentId = args.assigneeAgentId;
      if (typeof args.priority === "string") body.priority = args.priority;
      body.status = typeof args.status === "string" ? args.status : "todo";
      if (typeof args.projectId === "string") {
        body.projectId = args.projectId;
      } else if (opts.projectId) {
        body.projectId = opts.projectId;
      }
      return httpJson("POST", `/api/companies/${opts.companyId}/issues`, body);
    }
    case "paperclipAddComment": {
      const issueId = typeof args.issueId === "string" ? args.issueId : "";
      if (!issueId) return { ok: false, result: "issueId is required" };
      return httpJson("POST", `/api/issues/${encodeURIComponent(issueId)}/comments`, {
        body: typeof args.body === "string" ? args.body : "",
      });
    }
    case "paperclipUpdateIssue": {
      const issueId = typeof args.issueId === "string" ? args.issueId : "";
      if (!issueId) return { ok: false, result: "issueId is required" };
      const body: Record<string, unknown> = {};
      if (typeof args.status === "string") body.status = args.status;
      if (typeof args.priority === "string") body.priority = args.priority;
      if (typeof args.assigneeAgentId === "string" || args.assigneeAgentId === null) {
        body.assigneeAgentId = args.assigneeAgentId;
      }
      if (typeof args.title === "string") body.title = args.title;
      return httpJson("PATCH", `/api/issues/${encodeURIComponent(issueId)}`, body);
    }
    case "paperclipAskHuman": {
      // Queue a free-text question for the human operator. We use the
      // existing approvals table with type=ask_human so the operator sees
      // it in the approvals UI. The agent's current heartbeat ends after
      // this call (the tool result just tells them the question is queued).
      // On a future heartbeat, answered questions are injected into the
      // system prompt by the heartbeat service.
      const question = typeof args.question === "string" ? args.question : "";
      if (!question) return { ok: false, result: "question is required" };
      const body = {
        type: "ask_human",
        payload: {
          question,
          context: typeof args.context === "string" ? args.context : "",
          urgency: typeof args.urgency === "string" ? args.urgency : "normal",
          askedByAgentId: opts.agentId,
          askedInRunId: opts.runId,
        },
        requestedByAgentId: opts.agentId,
      };
      return httpJson("POST", `/api/companies/${opts.companyId}/approvals`, body);
    }
    case "paperclipWebSearch": {
      const query = typeof args.query === "string" ? args.query : "";
      if (!query) return { ok: false, result: "query is required" };
      const body: Record<string, unknown> = { query };
      if (typeof args.maxResults === "number") body.maxResults = args.maxResults;
      return httpJson("POST", `/api/agent-tools/web-search`, body);
    }
    case "paperclipWebFetch": {
      const url = typeof args.url === "string" ? args.url : "";
      if (!url) return { ok: false, result: "url is required" };
      const body: Record<string, unknown> = { url };
      if (typeof args.offset === "number") body.offset = args.offset;
      if (typeof args.maxBytes === "number") body.maxBytes = args.maxBytes;
      return httpJson("POST", `/api/agent-tools/web-fetch`, body);
    }
    case "paperclipMemoryWrite": {
      const content = typeof args.content === "string" ? args.content : "";
      if (!content) return { ok: false, result: "content is required" };
      const body: Record<string, unknown> = { content };
      if (typeof args.scope === "string") body.scope = args.scope;
      if (typeof args.key === "string") body.key = args.key;
      return httpJson("POST", `/api/agent-tools/memory-write`, body);
    }
    case "paperclipMemorySearch": {
      const query = typeof args.query === "string" ? args.query : "";
      if (!query) return { ok: false, result: "query is required" };
      const body: Record<string, unknown> = { query };
      if (typeof args.limit === "number") body.limit = args.limit;
      return httpJson("POST", `/api/agent-tools/memory-search`, body);
    }
    case "paperclipAgentStats": {
      const body: Record<string, unknown> = {};
      if (args.scope === "team" || args.scope === "company") body.scope = args.scope;
      if (typeof args.window === "string") body.window = args.window;
      return httpJson("POST", `/api/agent-tools/agent-stats`, body);
    }
    case "paperclipRepoListFiles": {
      const repo = typeof args.repo === "string" ? args.repo : "";
      if (!repo) return { ok: false, result: "repo is required" };
      const body: Record<string, unknown> = { repo };
      if (typeof args.path === "string") body.path = args.path;
      if (typeof args.ref === "string") body.ref = args.ref;
      return httpJson("POST", `/api/agent-tools/repo-list-files`, body);
    }
    case "paperclipRepoReadFile": {
      const repo = typeof args.repo === "string" ? args.repo : "";
      const path = typeof args.path === "string" ? args.path : "";
      if (!repo || !path) return { ok: false, result: "repo and path are required" };
      const body: Record<string, unknown> = { repo, path };
      if (typeof args.ref === "string") body.ref = args.ref;
      if (typeof args.offset === "number") body.offset = args.offset;
      return httpJson("POST", `/api/agent-tools/repo-read-file`, body);
    }
    case "paperclipRepoWriteFile": {
      const repo = typeof args.repo === "string" ? args.repo : "";
      const path = typeof args.path === "string" ? args.path : "";
      const content = typeof args.content === "string" ? args.content : "";
      const message = typeof args.message === "string" ? args.message : "";
      const branch = typeof args.branch === "string" ? args.branch : "";
      if (!repo || !path || !message || !branch) {
        return { ok: false, result: "repo, path, message, and branch are required" };
      }
      const body: Record<string, unknown> = { repo, path, content, message, branch };
      if (typeof args.baseBranch === "string") body.baseBranch = args.baseBranch;
      return httpJson("POST", `/api/agent-tools/repo-write-file`, body);
    }
    case "paperclipReadWorkingMemory": {
      return httpJson("POST", `/api/agent-tools/working-memory-read`);
    }
    case "paperclipUpdateWorkingMemory": {
      const body: Record<string, unknown> = {};
      if (typeof args.currentFocus === "string") body.currentFocus = args.currentFocus;
      if (Array.isArray(args.openThreads)) body.openThreads = args.openThreads;
      if (Array.isArray(args.recentDecisions)) body.recentDecisions = args.recentDecisions;
      if (Array.isArray(args.expectedResponses)) body.expectedResponses = args.expectedResponses;
      return httpJson("POST", `/api/agent-tools/working-memory-write`, body);
    }
    case "paperclipReadCompanyState": {
      return httpJson("POST", `/api/agent-tools/company-state-read`);
    }
    case "paperclipUpdateCompanyState": {
      const body: Record<string, unknown> = {};
      for (const key of ["strategy", "okrs", "constraints", "recentPivots", "knownTruths", "openDecisions"]) {
        if (args[key] !== undefined) body[key] = args[key];
      }
      return httpJson("POST", `/api/agent-tools/company-state-write`, body);
    }
    case "paperclipEstimateCost": {
      const operation = typeof args.operation === "string" ? args.operation : "";
      if (!operation) return { ok: false, result: "operation is required" };
      const body: Record<string, unknown> = { operation };
      if (typeof args.estimatedToolCalls === "number") body.estimatedToolCalls = args.estimatedToolCalls;
      if (typeof args.estimatedInputTokens === "number") body.estimatedInputTokens = args.estimatedInputTokens;
      if (typeof args.estimatedOutputTokens === "number") body.estimatedOutputTokens = args.estimatedOutputTokens;
      if (typeof args.notes === "string") body.notes = args.notes;
      return httpJson("POST", `/api/agent-tools/estimate-cost`, body);
    }
    case "paperclipDone": {
      // paperclipDone is handled as an early-exit signal in runToolLoop —
      // but we still call the HTTP route for telemetry + consistent envelope.
      const body: Record<string, unknown> = {};
      if (typeof args.outcome === "string") body.outcome = args.outcome;
      if (typeof args.confidence === "string") body.confidence = args.confidence;
      if (Array.isArray(args.openQuestions)) body.openQuestions = args.openQuestions;
      return httpJson("POST", `/api/agent-tools/done`, body);
    }
    case "paperclipRepoOpenPr": {
      const repo = typeof args.repo === "string" ? args.repo : "";
      const title = typeof args.title === "string" ? args.title : "";
      const head = typeof args.head === "string" ? args.head : "";
      if (!repo || !title || !head) {
        return { ok: false, result: "repo, title, and head are required" };
      }
      const body: Record<string, unknown> = { repo, title, head };
      if (typeof args.body === "string") body.body = args.body;
      if (typeof args.base === "string") body.base = args.base;
      return httpJson("POST", `/api/agent-tools/repo-open-pr`, body);
    }
    // ========================================================
    // Integration tool dispatchers — each is a thin passthrough
    // to the /agent-tools/<provider>-<action> HTTP route. The
    // route handler resolves the agent's integration binding,
    // decrypts credentials, and calls the provider driver.
    // ========================================================
    case "paperclipGoogleAdsCreateCampaign": {
      return httpJson("POST", `/api/agent-tools/google-ads-create-campaign`, args);
    }
    case "paperclipGoogleAdsGetPerformance": {
      return httpJson("POST", `/api/agent-tools/google-ads-get-performance`, args);
    }
    case "paperclipFacebookAdsCreateCampaign": {
      return httpJson("POST", `/api/agent-tools/facebook-ads-create-campaign`, args);
    }
    case "paperclipFacebookAdsGetInsights": {
      return httpJson("POST", `/api/agent-tools/facebook-ads-get-insights`, args);
    }
    case "paperclipXPost": {
      return httpJson("POST", `/api/agent-tools/x-post`, args);
    }
    case "paperclipXSearch": {
      return httpJson("POST", `/api/agent-tools/x-search`, args);
    }
    case "paperclipRedditPost": {
      return httpJson("POST", `/api/agent-tools/reddit-post`, args);
    }
    case "paperclipTikTokAdsCreateCampaign": {
      return httpJson("POST", `/api/agent-tools/tiktok-ads-create-campaign`, args);
    }
    case "paperclipTikTokAdsGetReport": {
      return httpJson("POST", `/api/agent-tools/tiktok-ads-get-report`, args);
    }
    case "paperclipGithubOpenPr": {
      return httpJson("POST", `/api/agent-tools/github-open-pr`, args);
    }
    case "paperclipGithubListIssues": {
      return httpJson("POST", `/api/agent-tools/github-list-issues`, args);
    }
    case "paperclipWordpressPublish": {
      return httpJson("POST", `/api/agent-tools/wordpress-publish`, args);
    }
    case "paperclipMakeUgcGenerate": {
      return httpJson("POST", `/api/agent-tools/make-ugc-generate`, args);
    }
    case "paperclipSfmcSendEmail": {
      return httpJson("POST", `/api/agent-tools/sfmc-send-email`, args);
    }
    case "paperclipFirebasePush": {
      return httpJson("POST", `/api/agent-tools/firebase-push`, args);
    }
    // ---- Expanded integration tools ----
    case "paperclipGoogleAdsListCampaigns": {
      return httpJson("POST", `/api/agent-tools/google-ads-list-campaigns`, args);
    }
    case "paperclipGoogleAdsUpdateCampaignStatus": {
      return httpJson("POST", `/api/agent-tools/google-ads-update-campaign-status`, args);
    }
    case "paperclipGoogleAdsUpdateCampaignBudget": {
      return httpJson("POST", `/api/agent-tools/google-ads-update-campaign-budget`, args);
    }
    case "paperclipGoogleAdsGetSearchTerms": {
      return httpJson("POST", `/api/agent-tools/google-ads-get-search-terms`, args);
    }
    case "paperclipFacebookAdsListCampaigns": {
      return httpJson("POST", `/api/agent-tools/facebook-ads-list-campaigns`, args);
    }
    case "paperclipFacebookAdsUpdateCampaignStatus": {
      return httpJson("POST", `/api/agent-tools/facebook-ads-update-campaign-status`, args);
    }
    case "paperclipFacebookAdsCreateAdSet": {
      return httpJson("POST", `/api/agent-tools/facebook-ads-create-ad-set`, args);
    }
    case "paperclipXGetTweetMetrics": {
      return httpJson("POST", `/api/agent-tools/x-get-tweet-metrics`, args);
    }
    case "paperclipRedditComment": {
      return httpJson("POST", `/api/agent-tools/reddit-comment`, args);
    }
    case "paperclipRedditSearch": {
      return httpJson("POST", `/api/agent-tools/reddit-search`, args);
    }
    case "paperclipTikTokAdsListCampaigns": {
      return httpJson("POST", `/api/agent-tools/tiktok-ads-list-campaigns`, args);
    }
    case "paperclipTikTokAdsUpdateCampaignStatus": {
      return httpJson("POST", `/api/agent-tools/tiktok-ads-update-campaign-status`, args);
    }
    case "paperclipWordpressUpdatePost": {
      return httpJson("POST", `/api/agent-tools/wordpress-update-post`, args);
    }
    case "paperclipWordpressListPosts": {
      return httpJson("POST", `/api/agent-tools/wordpress-list-posts`, args);
    }
    case "paperclipWordpressUploadMedia": {
      return httpJson("POST", `/api/agent-tools/wordpress-upload-media`, args);
    }
    case "paperclipMakeUgcGetStatus": {
      return httpJson("POST", `/api/agent-tools/make-ugc-get-status`, args);
    }
    case "paperclipFirebaseSubscribeTopic": {
      return httpJson("POST", `/api/agent-tools/firebase-subscribe-topic`, args);
    }
    case "paperclipRequestIntegration": {
      return httpJson("POST", `/api/agent-tools/request-integration`, args);
    }
    default:
      return { ok: false, result: `Unknown tool: ${name}` };
  }
}

// Run a multi-turn tool execution loop against an arbitrary LLM call
// function. Each iteration: invoke `callFn` with the current message list,
// check the result for tool_calls, dispatch them, append the assistant + tool
// messages, and re-invoke. Returns the final CallResult once the LLM stops
// asking for tools (or when the iteration cap is reached, or when callFn
// fails). The caller is responsible for converting the CallResult into an
// AdapterExecutionResult.
async function runToolLoop(opts: {
  messages: ChatMessage[];
  callFn: (messages: ChatMessage[]) => Promise<CallResult>;
  dispatch: ToolDispatchOptions | null;
  label: string;
  onLog: AdapterExecutionContext["onLog"];
}): Promise<{ finalCall: CallResult | null; totalToolCalls: number; exitReason: string }> {
  let lastCall: CallResult | null = null;
  let totalToolCalls = 0;
  const loopStartedAt = Date.now();
  let exitReason = "completed";
  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    // Wall-clock and total-calls budget checks before invoking the model again.
    if (Date.now() - loopStartedAt > MAX_WALL_CLOCK_MS) {
      exitReason = `wall_clock_cap (${Math.round(MAX_WALL_CLOCK_MS / 1000)}s)`;
      break;
    }
    if (totalToolCalls >= MAX_TOOL_CALLS_TOTAL) {
      exitReason = `total_tool_calls_cap (${MAX_TOOL_CALLS_TOTAL})`;
      break;
    }

    lastCall = await opts.callFn(opts.messages);
    await traceLog(opts.onLog, lastCall);

    if (!lastCall.ok || !lastCall.parsed) {
      return { finalCall: lastCall, totalToolCalls, exitReason: "call_failed" };
    }

    const toolCalls = lastCall.parsed.toolCalls ?? [];
    if (toolCalls.length === 0) {
      return { finalCall: lastCall, totalToolCalls, exitReason: "no_more_tool_calls" };
    }

    // Early-exit signal: paperclipDone() lets the model explicitly declare it's
    // finished. We honor it immediately without another model turn.
    const doneCall = toolCalls.find((tc) => tc.function.name === "paperclipDone");
    if (doneCall) {
      const args = safeParseArgs(doneCall.function.arguments);
      const outcome = typeof args.outcome === "string" ? args.outcome : "completed";
      await opts.onLog(
        "stderr",
        `[gemma-local] Tool loop (${opts.label}) paperclipDone() called: ${outcome}\n`,
      );
      // Inject the done call into the transcript so resultJson reflects it.
      opts.messages.push({
        role: "assistant",
        content: lastCall.parsed.content || "",
        tool_calls: [{
          id: doneCall.id,
          type: "function" as const,
          function: { name: doneCall.function.name, arguments: doneCall.function.arguments },
        }],
      });
      opts.messages.push({
        role: "tool",
        tool_call_id: doneCall.id,
        name: doneCall.function.name,
        content: JSON.stringify({ ok: true, done: true, outcome }),
      });
      // Patch the lastCall content to include the outcome as the final answer.
      if (lastCall.parsed) {
        lastCall.parsed.content = lastCall.parsed.content || outcome;
      }
      return { finalCall: lastCall, totalToolCalls: totalToolCalls + 1, exitReason: "paperclipDone" };
    }

    totalToolCalls += toolCalls.length;
    await opts.onLog(
      "stderr",
      `[gemma-local] Tool loop (${opts.label}) iter=${iter + 1}/${MAX_TOOL_ITERATIONS}: dispatching ${toolCalls.length} tool call(s) in parallel\n`,
    );

    opts.messages.push({
      role: "assistant",
      content: lastCall.parsed.content || "",
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    });

    // Parallel dispatch — multiple tool calls from one model turn run
    // concurrently. This is a multi-x speedup for research-heavy loops where
    // an agent fires 4+ web searches simultaneously.
    const dispatched = await Promise.all(
      toolCalls.map(async (tc) => {
        const args = safeParseArgs(tc.function.arguments);
        if (!opts.dispatch) {
          return {
            tc,
            resultText: `Error: tool dispatch unavailable in this run (no apiBase or authToken). Cannot execute ${tc.function.name}.`,
            ok: false,
          };
        }
        const res = await dispatchToolCall(tc.function.name, args, opts.dispatch);
        return { tc, resultText: res.result, ok: res.ok };
      }),
    );
    for (const { tc, resultText, ok } of dispatched) {
      await opts.onLog(
        "stderr",
        `[gemma-local]   tool=${tc.function.name} ok=${ok} bytes=${resultText.length}\n`,
      );
      opts.messages.push({
        role: "tool",
        tool_call_id: tc.id,
        name: tc.function.name,
        content: resultText,
      });
    }
  }

  if (exitReason === "completed") exitReason = `max_iterations (${MAX_TOOL_ITERATIONS})`;
  await opts.onLog(
    "stderr",
    `[gemma-local] Tool loop (${opts.label}) exited: ${exitReason}, totalToolCalls=${totalToolCalls}\n`,
  );
  return { finalCall: lastCall, totalToolCalls, exitReason };
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, config, context, onLog, onMeta, authToken } = ctx;

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

  // World-class expertise layer: every gemma-local agent operates as a
  // domain specialist for whichever product its project promotes. The
  // heartbeat service resolves the agent → project → product brief and
  // injects the brief (and optional product name) via context. We prepend
  // the brief + role-specific playbook to the system prompt so the agent
  // has deep frameworks, target metrics, quality bars, and first-move
  // plays grounded in the right product.
  const agentRole = typeof context.paperclipAgentRole === "string" ? context.paperclipAgentRole : null;
  const agentTitle = typeof context.paperclipAgentTitle === "string" ? context.paperclipAgentTitle : null;
  const agentCapabilities = typeof context.paperclipAgentCapabilities === "string" ? context.paperclipAgentCapabilities : null;
  const productBrief = typeof context.paperclipProductBrief === "string" ? context.paperclipProductBrief : null;
  const productBriefKey = typeof context.paperclipProductBriefKey === "string" ? context.paperclipProductBriefKey : null;
  const productName = typeof context.paperclipProductName === "string" ? context.paperclipProductName : null;
  const skillsManifest = typeof context.paperclipSkillsManifest === "string" ? context.paperclipSkillsManifest : null;
  const { preamble: expertisePreamble, resolvedRoleKey, resolvedProductName, skillCount } = buildExpertisePreamble({
    role: agentRole,
    title: agentTitle,
    name: agent.name,
    capabilities: agentCapabilities,
    brief: productBrief,
    briefKey: productBriefKey,
    productName,
    skillsManifest,
  });

  // Server-injected web research findings (DuckDuckGo). The heartbeat
  // service performs a keyless search for research-oriented agents and
  // attaches the formatted results here so the model has fresh grounding
  // without needing tool calling.
  const researchFindings = typeof context.paperclipResearchFindings === "string" ? context.paperclipResearchFindings.trim() : "";
  const researchSection = researchFindings.length > 0
    ? [
        "# Fresh web research (server-fetched)",
        "",
        "The findings below were fetched from the live web by the operator runtime just before this invocation. Use them to ground your output in current information. Cite sources inline as [1], [2] etc. referencing the numbered list.",
        "",
        researchFindings,
      ].join("\n")
    : "";

  let systemPrompt = [expertisePreamble, researchSection, baseSystemPrompt].filter((s) => s && s.trim().length > 0).join("\n\n---\n\n");

  if (programMd) {
    systemPrompt = [
      systemPrompt,
      "---",
      "# Your program.md (persistent mandate)",
      "",
      "Below is YOUR specific identity, hypothesis, protocol, metric history, known-bad list, and backlog. This overrides the generic role playbook where they differ. Use it as the source of truth for what to work on.",
      "",
      programMd,
    ].filter((s) => s.length > 0).join("\n");
  }
  // Surface answered / pending paperclipAskHuman questions so the agent
  // actually notices the human's replies instead of re-asking forever.
  const answeredAsks = Array.isArray(context.paperclipAnsweredHumanQuestions)
    ? (context.paperclipAnsweredHumanQuestions as Array<Record<string, unknown>>)
    : [];
  const pendingAsks = Array.isArray(context.paperclipPendingHumanQuestions)
    ? (context.paperclipPendingHumanQuestions as Array<Record<string, unknown>>)
    : [];
  if (answeredAsks.length > 0 || pendingAsks.length > 0) {
    const asksSection: string[] = ["---", "# Human answers to your questions"];
    if (answeredAsks.length > 0) {
      asksSection.push("", "## Answered (act on these now — do not re-ask)");
      for (const a of answeredAsks) {
        const q = typeof a.question === "string" ? a.question : "";
        const ans = typeof a.answer === "string" ? a.answer : "";
        const decision = typeof a.decision === "string" ? a.decision : "answered";
        asksSection.push(`- **Q:** ${q}`);
        asksSection.push(`  **${decision === "rejected" ? "Rejected" : "A"}:** ${ans || "(no text)"}`);
      }
    }
    if (pendingAsks.length > 0) {
      asksSection.push("", "## Still pending (the operator has NOT answered yet — do NOT re-ask these):");
      for (const p of pendingAsks) {
        const q = typeof p.question === "string" ? p.question : "";
        asksSection.push(`- ${q}`);
      }
    }
    systemPrompt = systemPrompt ? `${systemPrompt}\n${asksSection.join("\n")}` : asksSection.join("\n");
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
        `Role: ${resolvedRoleKey}${isAutonomousRun ? " (autonomous)" : ""}${programMd ? " +program.md" : ""} · Product: ${resolvedProductName}${skillCount > 0 ? ` · Skills: ${skillCount}` : ""}`,
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

  // Pull tool-dispatch context (apiBase, companyId) injected by heartbeat.
  // If any of these are missing we still run the LLM, but tool calls will
  // surface a clear error so the model can self-correct.
  const apiBase = typeof context.paperclipApiBase === "string" ? context.paperclipApiBase : "";
  const companyId = typeof context.paperclipCompanyId === "string" ? context.paperclipCompanyId : agent.companyId;
  const projectId = typeof context.paperclipProjectId === "string" ? context.paperclipProjectId : null;
  const dispatch: ToolDispatchOptions | null = apiBase && authToken
    ? { apiBase, authToken, companyId, agentId: agent.id, runId, projectId }
    : null;

  try {
    // Run the tool execution loop against Ollama. The loop drives multi-turn
    // tool calls (paperclipCreateIssue, etc.) so CEOs can actually delegate.
    const { finalCall: primary } = await runToolLoop({
      messages,
      callFn: (msgs) =>
        callOllamaNative({
          baseUrl: ollamaUrl,
          model: ollamaModel,
          messages: msgs,
          tools,
          timeoutMs: ollamaTimeoutSec * 1000,
          think: enableThinking,
          numPredict,
        }),
      dispatch,
      label: "ollama",
      onLog,
    });

    if (primary && primary.ok && primary.parsed) {
      return buildResult(primary, context);
    }

    const failure = primary ?? {
      ok: false,
      parsed: null,
      errorMessage: "no LLM call attempted",
      latencyMs: 0,
      wasFallback: false,
      model: ollamaModel,
      provider: "ollama",
    } as CallResult;

    // Primary (Ollama) failed — attempt MiniMax fallback. The fallback path
    // ALSO runs the tool execution loop so delegation tool calls are
    // dispatched the same way regardless of which provider answered.
    await onLog(
      "stderr",
      `[gemma-local] Primary (Ollama) failed: ${failure.errorMessage ?? "unknown error"}. Attempting MiniMax fallback.\n`,
    );

    return await executeFallback(fallbackUrl, fallbackModel, fallbackApiKey, messages, tools, fallbackTimeoutSec, numPredict, onLog, context, failure, dispatch);
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
  dispatch: ToolDispatchOptions | null = null,
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
    // Run a fresh tool loop against MiniMax. The loop drives any tool calls
    // the model emits (paperclipCreateIssue, etc.) the same way the Ollama
    // path does, so delegation works whether or not Ollama is healthy.
    const loopResult = await runToolLoop({
      messages,
      callFn: (msgs) =>
        callOpenAICompat({
          baseUrl: fallbackUrl,
          model: fallbackModel,
          apiKey: fallbackApiKey,
          messages: msgs,
          tools,
          timeoutMs: fallbackTimeoutSec * 1000,
          maxTokens: numPredict,
          provider: "minimax",
        }),
      dispatch,
      label: "minimax",
      onLog,
    });
    fallback = loopResult.finalCall;

    if (fallback && fallback.ok && fallback.parsed) {
      if (attempt > 1) {
        await onLog(
          "stderr",
          `[gemma-local] MiniMax fallback succeeded on attempt ${attempt}/${MAX_ATTEMPTS}.\n`,
        );
      }
      return buildResult(fallback, context);
    }

    lastError = fallback?.errorMessage ?? "unknown";
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

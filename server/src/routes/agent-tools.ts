// agent-tools: HTTP endpoints that back the non-delegation tools agents can
// dispatch via the gemma-local execute loop. All of these routes require an
// agent JWT (or board access) and enforce company-scoped authz.
//
//   POST /api/agent-tools/web-search        { query, maxResults? }
//   POST /api/agent-tools/web-fetch         { url, maxBytes? }
//   POST /api/agent-tools/memory-write      { scope, key?, content }
//   POST /api/agent-tools/memory-search     { query, limit? }
//
// Kept in one file so adding tool #6/#7/#8 is a single-file change — that's
// the "one-file tool registry" pattern we committed to as part of the
// tool-loop refactor (see the "spokes on platform" commentary in the prior
// session).

import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents as agentsTable } from "@paperclipai/db";
import { toolResponse } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { agentMemoryService } from "../services/agent-memory.js";
import { agentWorkingMemoryService } from "../services/agent-working-memory.js";
import { companyStateService } from "../services/company-state.js";
import { agentPlaybookService, derivePattern } from "../services/agent-playbooks.js";
import { teamFeedService } from "../services/team-feed.js";
import { webSearch, formatSearchResultsForPrompt } from "../services/web-search.js";
import { unauthorized, unprocessable } from "../errors.js";
import {
  integrationService,
  type IntegrationProvider,
} from "../services/integrations.js";
import * as drivers from "../services/integration-providers/drivers.js";

// ---------- schemas ----------

const webSearchSchema = z.object({
  query: z.string().min(1).max(512),
  maxResults: z.number().int().min(1).max(10).optional(),
});

const webFetchSchema = z.object({
  url: z.string().url().max(2048),
  maxBytes: z.number().int().min(1).max(200_000).optional(),
  offset: z.number().int().min(0).max(10_000_000).optional(),
});

const memoryWriteSchema = z.object({
  scope: z.enum(["self", "team", "company"]).default("self"),
  key: z.string().max(128).optional().default(""),
  content: z.string().min(1).max(8192),
});

const memorySearchSchema = z.object({
  query: z.string().min(1).max(512),
  limit: z.number().int().min(1).max(20).optional(),
});

const agentStatsSchema = z.object({
  scope: z.enum(["team", "company"]).optional().default("team"),
  window: z.string().regex(/^\d+[hdw]$/).optional().default("7d"),
});

// ---------- 100x foundation schemas ----------

const openThreadSchema = z.object({
  topic: z.string().min(1).max(200),
  nextStep: z.string().min(1).max(400),
  blockedBy: z.string().max(200).optional(),
  lastTouchedAt: z.string().max(64).optional(),
});
const recentDecisionSchema = z.object({
  decision: z.string().min(1).max(400),
  rationale: z.string().max(800).optional(),
  at: z.string().max(64).optional(),
});
const expectedResponseSchema = z.object({
  question: z.string().min(1).max(400),
  waitingOn: z.string().min(1).max(200),
  askedAt: z.string().max(64).optional(),
});
const workingMemoryWriteSchema = z.object({
  currentFocus: z.string().max(400).optional(),
  openThreads: z.array(openThreadSchema).max(10).optional(),
  recentDecisions: z.array(recentDecisionSchema).max(10).optional(),
  expectedResponses: z.array(expectedResponseSchema).max(10).optional(),
});

const companyStateWriteSchema = z.object({
  strategy: z
    .object({
      currentFocus: z.string().max(400).optional(),
      northStar: z.string().max(400).optional(),
      activeBets: z.array(z.string().max(200)).max(10).optional(),
      killedBets: z.array(z.string().max(200)).max(10).optional(),
    })
    .optional(),
  okrs: z
    .array(
      z.object({
        objective: z.string().max(300),
        keyResults: z.array(z.string().max(200)).max(6),
        quarter: z.string().max(32).optional(),
      }),
    )
    .max(10)
    .optional(),
  constraints: z
    .object({
      runwayMonths: z.number().optional(),
      monthlyBudgetCents: z.number().optional(),
      hardDeadlines: z.array(z.string().max(200)).max(10).optional(),
    })
    .optional(),
  recentPivots: z
    .array(
      z.object({
        when: z.string().max(64),
        from: z.string().max(300),
        to: z.string().max(300),
        why: z.string().max(500),
      }),
    )
    .max(10)
    .optional(),
  knownTruths: z
    .array(
      z.object({
        fact: z.string().max(400),
        source: z.string().max(200).optional(),
        at: z.string().max(64).optional(),
      }),
    )
    .max(30)
    .optional(),
  openDecisions: z
    .array(
      z.object({
        question: z.string().max(400),
        options: z.array(z.string().max(200)).max(6).optional(),
        blockedWork: z.string().max(300).optional(),
      }),
    )
    .max(15)
    .optional(),
});

const estimateCostSchema = z.object({
  operation: z.string().min(1).max(200),
  estimatedToolCalls: z.number().int().min(1).max(500).optional(),
  estimatedInputTokens: z.number().int().min(0).max(1_000_000).optional(),
  estimatedOutputTokens: z.number().int().min(0).max(500_000).optional(),
  notes: z.string().max(1000).optional(),
});

const doneSchema = z.object({
  outcome: z.string().max(2000).optional(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
  openQuestions: z.array(z.string().max(300)).max(10).optional(),
});

const repoRef = z.object({
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, "repo must be owner/name"),
});
const repoListSchema = repoRef.extend({
  path: z.string().max(1024).optional().default(""),
  ref: z.string().max(256).optional(),
});
const repoReadSchema = repoRef.extend({
  path: z.string().min(1).max(1024),
  ref: z.string().max(256).optional(),
  offset: z.number().int().min(0).max(10_000_000).optional(),
});
const repoWriteSchema = repoRef.extend({
  path: z.string().min(1).max(1024),
  content: z.string().max(500_000),
  message: z.string().min(1).max(1024),
  branch: z.string().min(1).max(256),
  baseBranch: z.string().max(256).optional(),
});
const repoOpenPrSchema = repoRef.extend({
  title: z.string().min(1).max(256),
  body: z.string().max(32_000).optional().default(""),
  head: z.string().min(1).max(256),
  base: z.string().max(256).optional(),
});

// ---------- helpers ----------

function requireAgentActor(req: Parameters<Parameters<Router["post"]>[1]>[0]) {
  if (req.actor.type !== "agent") {
    throw unauthorized("This endpoint requires an agent JWT");
  }
  const agentId = req.actor.agentId;
  const companyId = req.actor.companyId;
  if (!agentId || !companyId) {
    throw unauthorized("Agent actor missing ids");
  }
  return { agentId, companyId };
}

// A tiny, safe HTML-to-text converter. Strips script/style, tags, and
// collapses whitespace. Not a full html parser — agents get "readable text"
// quality, which is enough for the vast majority of research pages.
function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&nbsp;/g, " ");
  s = s.replace(/&amp;/g, "&");
  s = s.replace(/&lt;/g, "<");
  s = s.replace(/&gt;/g, ">");
  s = s.replace(/&quot;/g, '"');
  s = s.replace(/&#39;/g, "'");
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

// ---------- GitHub helpers ----------

const GITHUB_API = "https://api.github.com";

function githubToken(): string {
  const token = process.env.PAPERCLIP_GITHUB_TOKEN?.trim();
  if (!token) {
    throw unprocessable(
      "PAPERCLIP_GITHUB_TOKEN env var is not set on the server; git tools are disabled",
    );
  }
  return token;
}

async function githubFetch(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const url = `${GITHUB_API}${path}`;
  const response = await fetch(url, {
    method: init.method ?? "GET",
    headers: {
      "accept": "application/vnd.github+json",
      "authorization": `Bearer ${githubToken()}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "paperclip-agent-tools/1.0",
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await response.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { ok: response.ok, status: response.status, json, text };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; PaperclipBot/1.0; +https://paperclip.ai)",
        "accept": "text/html,application/xhtml+xml,text/plain,*/*",
        "accept-language": "en-US,en;q=0.9",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

// ---------- router ----------

export function agentToolRoutes(db: Db) {
  const router = Router();
  const memory = agentMemoryService(db);
  const workingMemory = agentWorkingMemoryService(db);
  const worldState = companyStateService(db);
  const playbooks = agentPlaybookService(db);
  const feed = teamFeedService(db);

  async function resolveAgentRole(agentId: string): Promise<string | null> {
    const row = await db
      .select({ role: agentsTable.role })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId))
      .limit(1)
      .then((r) => r[0] ?? null);
    return row?.role ?? null;
  }

  router.post("/agent-tools/web-search", validate(webSearchSchema), async (req, res) => {
    requireAgentActor(req);
    const { query, maxResults } = req.body as z.infer<typeof webSearchSchema>;
    try {
      const results = await webSearch(query, { maxResults: maxResults ?? 5 });
      if (results.length === 0) {
        res.json(
          toolResponse.empty(
            `No web results for “${query}”. The search provider returned 0 hits.`,
            "Try broader terms, remove quotes, or try a domain-specific query (e.g. 'site:github.com ...').",
          ),
        );
        return;
      }
      // Trim each result to 3 fields: title, url, snippet. No ranking, no favicons,
      // no raw HTML. Agents can call paperclipWebFetch on the URL if they want more.
      const items = results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
      }));
      res.json(
        toolResponse.list({
          items,
          nextHint:
            "Pick the 1–2 most relevant URLs and call paperclipWebFetch on each to read the page content.",
          // Keep `formatted` as an optional companion field for the gemma-local
          // prompt formatter — not in the envelope spec but backwards-compatible.
          message: formatSearchResultsForPrompt(query, results),
        }),
      );
    } catch (err) {
      res.status(502).json(
        toolResponse.fail({
          code: "web_search_failed",
          message: err instanceof Error ? err.message : String(err),
          retry: true,
        }),
      );
    }
  });

  router.post("/agent-tools/web-fetch", validate(webFetchSchema), async (req, res) => {
    requireAgentActor(req);
    const { url, maxBytes, offset } = req.body as z.infer<typeof webFetchSchema>;

    // Basic SSRF guard: block private/loopback hosts.
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) {
      throw unprocessable("Only http and https URLs are allowed");
    }
    const host = parsed.hostname.toLowerCase();
    const blockedHosts = [
      "localhost",
      "127.0.0.1",
      "0.0.0.0",
      "::1",
      "metadata.google.internal",
      "169.254.169.254",
    ];
    if (blockedHosts.includes(host) || host.endsWith(".local") || host.endsWith(".internal")) {
      throw unprocessable("Cannot fetch internal or loopback hosts");
    }

    try {
      const response = await fetchWithTimeout(url, 15_000);
      if (!response.ok) {
        res.status(502).json(
          toolResponse.fail({
            code: "web_fetch_http_error",
            message: `HTTP ${response.status} ${response.statusText} for ${url}`,
            retry: response.status >= 500 || response.status === 429,
          }),
        );
        return;
      }
      const contentType = response.headers.get("content-type") ?? "";
      const raw = await response.text();
      const fullText = /html|xml/i.test(contentType) ? htmlToText(raw) : raw;
      const originalBytes = fullText.length;
      const startAt = offset ?? 0;
      const cap = maxBytes ?? 12_000;
      const sliced = fullText.slice(startAt, startAt + cap);
      const hasMore = startAt + sliced.length < originalBytes;
      const nextOffset = startAt + sliced.length;
      const nextHint = hasMore
        ? `Page continues. To read more, call paperclipWebFetch again with the same url and offset=${nextOffset}.`
        : "End of document reached. Extract the facts you need and store them with paperclipMemoryWrite so you don't have to re-fetch.";
      res.json({
        ok: true,
        data: {
          url,
          contentType,
          status: response.status,
          offset: startAt,
          text: sliced,
        },
        truncated: hasMore,
        originalBytes,
        returnedBytes: sliced.length,
        message:
          originalBytes === 0
            ? "The page fetched successfully but contained no extractable text (likely a JS-heavy SPA or a binary asset)."
            : hasMore
              ? `Showing bytes ${startAt}..${nextOffset} of ${originalBytes}.`
              : `Full document (${originalBytes} chars) returned.`,
        nextHint,
      });
    } catch (err) {
      res.status(502).json(
        toolResponse.fail({
          code: "web_fetch_failed",
          message: err instanceof Error ? err.message : String(err),
          retry: true,
        }),
      );
    }
  });

  // ---------- working memory (live cursor) ----------

  router.post("/agent-tools/working-memory-read", async (req, res) => {
    const { agentId } = requireAgentActor(req);
    const row = await workingMemory.read(agentId);
    if (!row) {
      res.json(
        toolResponse.empty(
          "No working memory yet. This is your first structured scratchpad — write one at the end of this heartbeat with paperclipUpdateWorkingMemory so your next run can resume where you left off.",
          "Set currentFocus to a one-line description of what you are working on right now.",
        ),
      );
      return;
    }
    res.json(
      toolResponse.ok({
        data: {
          currentFocus: row.currentFocus,
          openThreads: row.openThreads,
          recentDecisions: row.recentDecisions,
          expectedResponses: row.expectedResponses,
          updatedAt: row.updatedAt.toISOString(),
        },
        nextHint:
          row.expectedResponses.length > 0
            ? "You have pending questions awaiting answers — check paperclipAnsweredHumanQuestions in your context before asking again."
            : "Resume work on the top openThread, or refine currentFocus if priorities shifted.",
      }),
    );
  });

  router.post(
    "/agent-tools/working-memory-write",
    validate(workingMemoryWriteSchema),
    async (req, res) => {
      const { agentId, companyId } = requireAgentActor(req);
      const patch = req.body as z.infer<typeof workingMemoryWriteSchema>;
      const row = await workingMemory.upsert({ companyId, agentId, patch });
      res.json(
        toolResponse.ok({
          data: {
            currentFocus: row.currentFocus,
            openThreadCount: row.openThreads.length,
            updatedAt: row.updatedAt.toISOString(),
          },
          message: `Working memory updated. Focus: ${row.currentFocus || "(none)"}; ${row.openThreads.length} open thread(s).`,
          nextHint:
            "Your next heartbeat will resume from this scratchpad. Keep it terse — this is your cursor, not a journal.",
        }),
      );
    },
  );

  // ---------- company state (shared world model) ----------

  router.post("/agent-tools/company-state-read", async (req, res) => {
    const { companyId } = requireAgentActor(req);
    const row = await worldState.read(companyId);
    if (!row) {
      res.json(
        toolResponse.empty(
          "No company_state has been written yet. If you are the CEO, seed it with paperclipUpdateCompanyState; otherwise ask your CEO to.",
          "Subordinates: proceed with what you know and flag missing strategy as an openThread.",
        ),
      );
      return;
    }
    res.json(
      toolResponse.ok({
        data: {
          version: row.version,
          strategy: row.strategy,
          okrs: row.okrs,
          constraints: row.constraints,
          recentPivots: row.recentPivots.slice(-3),
          knownTruths: row.knownTruths.slice(-10),
          openDecisions: row.openDecisions,
          updatedAt: row.updatedAt.toISOString(),
        },
        nextHint:
          row.openDecisions.length > 0
            ? "There are open strategic decisions. If you can contribute data or a recommendation, create an issue or comment to help the CEO decide."
            : "Align your work to strategy.currentFocus and check that your openThreads do not contradict killedBets.",
      }),
    );
  });

  router.post(
    "/agent-tools/company-state-write",
    validate(companyStateWriteSchema),
    async (req, res) => {
      const { agentId, companyId } = requireAgentActor(req);
      const role = (await resolveAgentRole(agentId))?.toLowerCase() ?? "";
      if (role !== "ceo" && role !== "founder") {
        res.status(403).json(
          toolResponse.fail({
            code: "company_state_forbidden",
            message:
              "Only CEO/founder-role agents can update company_state. Propose changes via a comment on the CEO's issue queue instead.",
          }),
        );
        return;
      }
      const patch = req.body as z.infer<typeof companyStateWriteSchema>;
      const row = await worldState.upsert({
        companyId,
        updatedByAgentId: agentId,
        patch,
      });
      res.json(
        toolResponse.ok({
          data: {
            version: row.version,
            strategy: row.strategy,
            updatedAt: row.updatedAt.toISOString(),
          },
          message: `company_state v${row.version} updated. All agents will see this on their next heartbeat.`,
          nextHint:
            "Every subordinate reads company_state at the top of their next heartbeat — there is no need to re-announce in comments. Focus on execution.",
        }),
      );
    },
  );

  // ---------- paperclipEstimateCost (predictive budgeting) ----------

  router.post(
    "/agent-tools/estimate-cost",
    validate(estimateCostSchema),
    async (req, res) => {
      const body = req.body as z.infer<typeof estimateCostSchema>;
      // Rough cost model for gemma-local: assume $0.0000002/input tok,
      // $0.0000006/output tok. This is a back-of-envelope number — the
      // value here is forcing the model to think before acting, not
      // precision.
      const toolCalls = body.estimatedToolCalls ?? 3;
      const inputTokens =
        body.estimatedInputTokens ?? 2000 + toolCalls * 800;
      const outputTokens = body.estimatedOutputTokens ?? 500 + toolCalls * 200;
      const costCents = Math.max(
        1,
        Math.round((inputTokens * 0.00002 + outputTokens * 0.00006) / 10),
      );
      const confidence =
        toolCalls <= 5 ? "high" : toolCalls <= 20 ? "medium" : "low";
      res.json(
        toolResponse.ok({
          data: {
            operation: body.operation,
            toolCalls,
            inputTokens,
            outputTokens,
            estimatedCostCents: costCents,
            confidence,
          },
          message: `Estimated ~${costCents}¢ (${toolCalls} tool calls, ${inputTokens + outputTokens} tokens).`,
          nextHint:
            costCents >= 50
              ? "This is a costly operation — consider paperclipAskHuman for approval before proceeding, or narrow the scope."
              : "Within normal budget. Proceed.",
        }),
      );
    },
  );

  // ---------- paperclipDone (clean exit signal) ----------

  router.post("/agent-tools/done", validate(doneSchema), async (req, res) => {
    const body = req.body as z.infer<typeof doneSchema>;
    res.json(
      toolResponse.ok({
        data: {
          outcome: body.outcome ?? "completed",
          confidence: body.confidence ?? "medium",
          openQuestions: body.openQuestions ?? [],
        },
        message: "Run marked done. The tool loop will exit after this turn.",
      }),
    );
  });

  router.post("/agent-tools/memory-write", validate(memoryWriteSchema), async (req, res) => {
    const { agentId, companyId } = requireAgentActor(req);
    const { scope, key, content } = req.body as z.infer<typeof memoryWriteSchema>;
    const memoryRow = await memory.write({
      companyId,
      agentId,
      scope,
      key: key ?? "",
      content,
    });
    res.json(
      toolResponse.ok({
        data: {
          id: memoryRow.id,
          scope: memoryRow.scope,
          key: memoryRow.key,
          updatedAt: memoryRow.updatedAt.toISOString(),
        },
        message: `Saved ${content.length} chars to ${scope} memory${key ? `/${key}` : ""}.`,
        nextHint:
          scope === "self"
            ? "This memory is private to you. To share with your team, call again with scope='team'."
            : scope === "team"
              ? "Your direct reports and your manager can now read this via paperclipMemorySearch."
              : "All agents in the company can now read this via paperclipMemorySearch.",
      }),
    );
  });

  // ---------- git tools ----------

  router.post("/agent-tools/repo-list-files", validate(repoListSchema), async (req, res) => {
    requireAgentActor(req);
    const { repo, path, ref } = req.body as z.infer<typeof repoListSchema>;
    const cleanPath = (path ?? "").replace(/^\/+/, "");
    const qs = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const r = await githubFetch(`/repos/${repo}/contents/${encodeURI(cleanPath)}${qs}`);
    if (!r.ok) {
      res.status(r.status).json(
        toolResponse.fail({
          code: r.status === 404 ? "github_not_found" : "github_error",
          message: `${repo}${cleanPath ? `/${cleanPath}` : ""}${ref ? `@${ref}` : ""}: ${r.text.slice(0, 300)}`,
          retry: r.status >= 500 || r.status === 429,
        }),
      );
      return;
    }
    const raw = Array.isArray(r.json) ? r.json : [r.json];
    const entries = raw
      .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
      .map((x) => ({
        name: String(x.name ?? ""),
        path: String(x.path ?? ""),
        type: String(x.type ?? ""),
        size: typeof x.size === "number" ? x.size : 0,
      }));
    if (entries.length === 0) {
      res.json(
        toolResponse.empty(
          `${repo}/${cleanPath || "(root)"} is empty${ref ? ` at ${ref}` : ""}.`,
          "Double-check the path and ref; GitHub returns empty rather than 404 for empty directories.",
        ),
      );
      return;
    }
    const breakdown: Record<string, number> = {};
    for (const e of entries) breakdown[e.type] = (breakdown[e.type] ?? 0) + 1;
    res.json(
      toolResponse.list({
        items: entries,
        breakdown,
        nextHint:
          "Call paperclipRepoReadFile with the path of any file you want to inspect. Directories can be listed recursively by calling this tool again with their path.",
      }),
    );
  });

  router.post("/agent-tools/repo-read-file", validate(repoReadSchema), async (req, res) => {
    requireAgentActor(req);
    const { repo, path, ref, offset } = req.body as z.infer<typeof repoReadSchema>;
    const qs = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const r = await githubFetch(`/repos/${repo}/contents/${encodeURI(path)}${qs}`);
    if (!r.ok) {
      res.status(r.status).json(
        toolResponse.fail({
          code: r.status === 404 ? "github_not_found" : "github_error",
          message: `${repo}/${path}${ref ? `@${ref}` : ""}: ${r.text.slice(0, 300)}`,
          retry: r.status >= 500 || r.status === 429,
        }),
      );
      return;
    }
    const obj = (r.json as Record<string, unknown>) ?? {};
    if (obj.type !== "file") {
      res.status(400).json(
        toolResponse.fail({
          code: "not_a_file",
          message: `${repo}/${path} is a ${obj.type}, not a file. Call paperclipRepoListFiles with this path to list its contents.`,
        }),
      );
      return;
    }
    const encoding = typeof obj.encoding === "string" ? obj.encoding : "base64";
    const contentB64 = typeof obj.content === "string" ? obj.content : "";
    const fullContent =
      encoding === "base64"
        ? Buffer.from(contentB64.replace(/\n/g, ""), "base64").toString("utf8")
        : contentB64;
    const originalBytes = fullContent.length;
    const startAt = offset ?? 0;
    const maxChars = 12_000;
    const sliced = fullContent.slice(startAt, startAt + maxChars);
    const hasMore = startAt + sliced.length < originalBytes;
    const nextOffset = startAt + sliced.length;
    res.json({
      ok: true,
      data: {
        repo,
        path,
        sha: obj.sha,
        size: obj.size,
        offset: startAt,
        content: sliced,
      },
      truncated: hasMore,
      originalBytes,
      returnedBytes: sliced.length,
      message: hasMore
        ? `Showing bytes ${startAt}..${nextOffset} of ${originalBytes}.`
        : `Full file (${originalBytes} chars) returned.`,
      nextHint: hasMore
        ? `File continues. Call again with offset=${nextOffset} for the next chunk.`
        : "If you want to edit this file, call paperclipRepoWriteFile with the same path and a new content string plus a branch name.",
    });
  });

  router.post("/agent-tools/repo-write-file", validate(repoWriteSchema), async (req, res) => {
    requireAgentActor(req);
    const { repo, path, content, message, branch, baseBranch } = req.body as z.infer<typeof repoWriteSchema>;

    // Resolve default branch if baseBranch not provided
    let baseRef = baseBranch;
    if (!baseRef) {
      const repoInfo = await githubFetch(`/repos/${repo}`);
      if (!repoInfo.ok) {
        res.status(repoInfo.status).json(
          toolResponse.fail({ code: "github_error", message: repoInfo.text.slice(0, 300) }),
        );
        return;
      }
      baseRef = ((repoInfo.json as Record<string, unknown>)?.default_branch as string) ?? "main";
    }

    // Ensure target branch exists. If it doesn't, create it from baseRef.
    let createdBranch = false;
    const refProbe = await githubFetch(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    if (!refProbe.ok && refProbe.status === 404) {
      const baseProbe = await githubFetch(`/repos/${repo}/git/ref/heads/${encodeURIComponent(baseRef)}`);
      if (!baseProbe.ok) {
        res.status(baseProbe.status).json(
          toolResponse.fail({
            code: "github_base_branch_missing",
            message: `base branch ${baseRef} not found: ${baseProbe.text.slice(0, 200)}`,
          }),
        );
        return;
      }
      const baseSha = ((baseProbe.json as Record<string, unknown>)?.object as Record<string, unknown> | undefined)?.sha;
      if (typeof baseSha !== "string") {
        res.status(500).json(
          toolResponse.fail({ code: "github_error", message: "could not resolve base branch sha" }),
        );
        return;
      }
      const createRef = await githubFetch(`/repos/${repo}/git/refs`, {
        method: "POST",
        body: { ref: `refs/heads/${branch}`, sha: baseSha },
      });
      if (!createRef.ok) {
        res.status(createRef.status).json(
          toolResponse.fail({
            code: "github_branch_create_failed",
            message: `failed to create branch ${branch}: ${createRef.text.slice(0, 200)}`,
          }),
        );
        return;
      }
      createdBranch = true;
    } else if (!refProbe.ok) {
      res.status(refProbe.status).json(
        toolResponse.fail({ code: "github_error", message: refProbe.text.slice(0, 300) }),
      );
      return;
    }

    // Look up existing file sha (if any) on the target branch so we can update in place.
    const existing = await githubFetch(`/repos/${repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(branch)}`);
    let existingSha: string | undefined;
    if (existing.ok) {
      const obj = existing.json as Record<string, unknown>;
      if (obj && obj.type === "file" && typeof obj.sha === "string") {
        existingSha = obj.sha;
      }
    }
    const isUpdate = Boolean(existingSha);

    const put = await githubFetch(`/repos/${repo}/contents/${encodeURI(path)}`, {
      method: "PUT",
      body: {
        message,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch,
        ...(existingSha ? { sha: existingSha } : {}),
      },
    });
    if (!put.ok) {
      res.status(put.status).json(
        toolResponse.fail({
          code: "github_write_failed",
          message: `PUT ${repo}/${path}@${branch}: ${put.text.slice(0, 300)}`,
          retry: put.status >= 500,
        }),
      );
      return;
    }
    const result = put.json as Record<string, unknown>;
    res.json(
      toolResponse.ok({
        data: {
          repo,
          branch,
          path,
          commitSha: (result?.commit as Record<string, unknown> | undefined)?.sha,
          fileSha: (result?.content as Record<string, unknown> | undefined)?.sha,
          createdBranch,
          operation: isUpdate ? "update" : "create",
        },
        message: `${isUpdate ? "Updated" : "Created"} ${path} on branch ${branch}${createdBranch ? ` (branch was created from ${baseRef})` : ""}.`,
        nextHint:
          "To open a pull request for this change, call paperclipRepoOpenPr with head='" +
          branch +
          "' and an appropriate title + body.",
      }),
    );
  });

  router.post("/agent-tools/repo-open-pr", validate(repoOpenPrSchema), async (req, res) => {
    requireAgentActor(req);
    const { repo, title, body, head, base } = req.body as z.infer<typeof repoOpenPrSchema>;
    let targetBase = base;
    if (!targetBase) {
      const repoInfo = await githubFetch(`/repos/${repo}`);
      if (!repoInfo.ok) {
        res.status(repoInfo.status).json(
          toolResponse.fail({ code: "github_error", message: repoInfo.text.slice(0, 300) }),
        );
        return;
      }
      targetBase = ((repoInfo.json as Record<string, unknown>)?.default_branch as string) ?? "main";
    }
    const pr = await githubFetch(`/repos/${repo}/pulls`, {
      method: "POST",
      body: { title, body: body ?? "", head, base: targetBase },
    });
    if (!pr.ok) {
      res.status(pr.status).json(
        toolResponse.fail({
          code: "github_pr_failed",
          message: `POST ${repo}/pulls: ${pr.text.slice(0, 300)}`,
          retry: pr.status >= 500,
        }),
      );
      return;
    }
    const obj = pr.json as Record<string, unknown>;
    res.json(
      toolResponse.ok({
        data: {
          repo,
          number: obj.number,
          url: obj.html_url,
          state: obj.state,
          head: (obj.head as Record<string, unknown> | undefined)?.ref,
          base: (obj.base as Record<string, unknown> | undefined)?.ref,
        },
        message: `Opened PR #${obj.number} — “${title}” (${head} → ${targetBase}).`,
        nextHint:
          "Tell the humans about the PR with paperclipAskHuman or post a comment on the originating issue with paperclipAddComment.",
      }),
    );
  });

  router.post("/agent-tools/memory-search", validate(memorySearchSchema), async (req, res) => {
    const { agentId, companyId } = requireAgentActor(req);
    const { query, limit } = req.body as z.infer<typeof memorySearchSchema>;
    const rows = await memory.search({
      companyId,
      agentId,
      query,
      limit: limit ?? 8,
    });
    if (rows.length === 0) {
      res.json(
        toolResponse.empty(
          `No memories matching “${query}” in any scope you can read (self + team + company).`,
          "Try a broader query, or write the fact now with paperclipMemoryWrite so future runs can find it.",
        ),
      );
      return;
    }
    const breakdown: Record<string, number> = { self: 0, team: 0, company: 0 };
    for (const r of rows) breakdown[r.scope] = (breakdown[r.scope] ?? 0) + 1;
    // Trimmed shape: 4 fields instead of 6. Drop writtenByAgentId (rarely
    // needed, adds noise) and use a shorter ISO date.
    const items = rows.map((r) => ({
      scope: r.scope,
      key: r.key || undefined,
      content: r.content,
      updatedAt: r.updatedAt.toISOString().slice(0, 10),
    }));
    res.json(
      toolResponse.list({
        items,
        breakdown,
        nextHint:
          "Use the matching content directly in your reasoning. If a memory is stale, overwrite it with paperclipMemoryWrite using the same scope+key.",
      }),
    );
  });

  router.post("/agent-tools/agent-stats", validate(agentStatsSchema), async (req, res) => {
    const { agentId, companyId } = requireAgentActor(req);
    const { scope, window } = req.body as z.infer<typeof agentStatsSchema>;
    // team scope = this agent's reports_to subtree; company = all agents.
    const managerId = scope === "company" ? null : agentId;
    const rows = await feed.leaderboard(companyId, managerId, window);
    if (rows.length === 0) {
      res.json(
        toolResponse.empty(
          `No agents found in your ${scope} over the last ${window}.`,
          "If you expected to see teammates here, check that you have direct or indirect reports.",
        ),
      );
      return;
    }
    // Trimmed row: keep the top signals. Drop reportsTo (agent already
    // knows the org chart via context), drop role (name is enough).
    const items = rows.map((r) => ({
      name: r.agentName,
      runsOk: r.heartbeatRunsOk,
      runsFailed: r.heartbeatRunsFailed,
      issues: r.issuesCreated,
      comments: r.commentsPosted,
      memories: r.memoriesWritten,
      asks: r.humanQuestionsAsked,
      // SLA signals — null when no finished runs in window.
      successPct: r.successRatePct,
      p50Ms: r.p50DurationMs,
      avgCents: r.avgCostCents,
    }));
    // Pre-compute aggregates so the agent doesn't have to sum in its head.
    const breakdown: Record<string, number> = {
      totalRuns: 0,
      totalFailures: 0,
      totalIssues: 0,
      totalComments: 0,
      totalMemories: 0,
      totalAsks: 0,
    };
    let idleCount = 0;
    for (const r of rows) {
      breakdown.totalRuns += r.heartbeatRunsOk;
      breakdown.totalFailures += r.heartbeatRunsFailed;
      breakdown.totalIssues += r.issuesCreated;
      breakdown.totalComments += r.commentsPosted;
      breakdown.totalMemories += r.memoriesWritten;
      breakdown.totalAsks += r.humanQuestionsAsked;
      if (
        r.heartbeatRunsOk === 0 &&
        r.issuesCreated === 0 &&
        r.commentsPosted === 0 &&
        r.memoriesWritten === 0
      ) {
        idleCount += 1;
      }
    }
    breakdown.idle = idleCount;
    const busiest = items[0]?.name ?? "(none)";
    res.json(
      toolResponse.list({
        items,
        breakdown,
        message: `Leaderboard over last ${window}, ${scope} scope. Busiest: ${busiest}. ${idleCount} idle agent(s).`,
        nextHint:
          idleCount > 0
            ? "Idle agents are good delegation targets. Use paperclipListAgents to find their id and paperclipCreateIssue to assign work."
            : "Everyone is busy. Consider prioritising with paperclipUpdateIssue or raising a blocker via paperclipAskHuman.",
      }),
    );
  });

  // ==========================================================
  // Integration tools (Google Ads, Facebook Ads, X, Reddit,
  // TikTok Ads, GitHub, WordPress, MakeUGC, SFMC, Firebase)
  // ==========================================================
  //
  // Shared pattern: resolve the calling agent's binding for the given
  // provider (with company-wide fallback), decrypt the credential
  // blob, call the provider driver, and return a tool envelope. On
  // error, mark the account with lastError so the UI shows it.

  const integrationSvc = integrationService(db);

  async function callProvider<Args>(
    req: Parameters<Parameters<Router["post"]>[1]>[0],
    res: Parameters<Parameters<Router["post"]>[1]>[1],
    provider: IntegrationProvider,
    args: Args,
    driver: (
      creds: Record<string, unknown>,
      meta: Record<string, unknown>,
      args: Args,
    ) => Promise<drivers.DriverResult>,
  ) {
    const { agentId, companyId } = requireAgentActor(req);
    const account = await integrationSvc.resolveForAgent(companyId, agentId, provider);
    if (!account) {
      res.json(
        toolResponse.fail({
          code: "integration_not_connected",
          message: `No ${provider} integration connected for this company. Ask an operator to connect ${provider} in Settings → Integrations, then bind it to this agent.`,
        }),
      );
      return;
    }
    let creds: Record<string, unknown>;
    try {
      const resolved = await integrationSvc.resolveCredentials(companyId, account.id);
      creds = resolved.credentials;
    } catch (err) {
      await integrationSvc.markError(
        companyId,
        account.id,
        err instanceof Error ? err.message : "failed to resolve credentials",
      );
      res.json(
        toolResponse.fail({
          code: "integration_credential_unreadable",
          message: `Could not read stored credentials for ${provider}. Ask an operator to re-enter the credentials in Settings → Integrations.`,
        }),
      );
      return;
    }
    const meta = (account.metadataJson ?? {}) as Record<string, unknown>;
    const result = await driver(creds, meta, args);
    if (!result.ok) {
      await integrationSvc.markError(companyId, account.id, result.error ?? "unknown error");
      res.json(
        toolResponse.fail({
          code: "integration_call_failed",
          message: `${provider} call failed: ${result.error ?? "unknown error"}. Check credentials and provider status. Re-enter tokens if they expired.`,
          retry: true,
        }),
      );
      return;
    }
    await integrationSvc.markVerified(companyId, account.id);
    res.json(
      toolResponse.ok({
        data: result.data,
        message: `${provider} call succeeded (account: ${account.label}).`,
      }),
    );
  }

  // ---- Google Ads ----
  router.post("/agent-tools/google-ads-create-campaign", async (req, res) => {
    const schema = z.object({
      name: z.string().min(1).max(200),
      budgetMicros: z.number().int().positive(),
      advertisingChannelType: z.string().optional(),
    });
    const args = schema.parse(req.body);
    await callProvider(req, res, "google_ads", args, drivers.googleAdsCreateCampaign);
  });

  router.post("/agent-tools/google-ads-get-performance", async (req, res) => {
    const schema = z.object({ days: z.number().int().min(1).max(90).optional() });
    const args = schema.parse(req.body ?? {});
    await callProvider(req, res, "google_ads", args, drivers.googleAdsGetPerformance);
  });

  // ---- Facebook Ads ----
  router.post("/agent-tools/facebook-ads-create-campaign", async (req, res) => {
    const schema = z.object({
      name: z.string().min(1).max(200),
      objective: z.string().min(1),
      dailyBudgetCents: z.number().int().positive(),
    });
    const args = schema.parse(req.body);
    await callProvider(req, res, "facebook_ads", args, drivers.facebookAdsCreateCampaign);
  });

  router.post("/agent-tools/facebook-ads-get-insights", async (req, res) => {
    const schema = z.object({ datePreset: z.string().optional() });
    const args = schema.parse(req.body ?? {});
    await callProvider(req, res, "facebook_ads", args, drivers.facebookAdsGetInsights);
  });

  // ---- X (Twitter) ----
  router.post("/agent-tools/x-post", async (req, res) => {
    const schema = z.object({ text: z.string().min(1).max(280) });
    const args = schema.parse(req.body);
    await callProvider(req, res, "x", args, drivers.xPost);
  });

  router.post("/agent-tools/x-search", async (req, res) => {
    const schema = z.object({
      query: z.string().min(1).max(512),
      maxResults: z.number().int().min(10).max(100).optional(),
    });
    const args = schema.parse(req.body);
    await callProvider(req, res, "x", args, drivers.xSearch);
  });

  // ---- Reddit ----
  router.post("/agent-tools/reddit-post", async (req, res) => {
    const schema = z.object({
      subreddit: z.string().min(1).max(80),
      title: z.string().min(1).max(300),
      text: z.string().max(40000).optional(),
      url: z.string().url().optional(),
      kind: z.enum(["self", "link"]).optional(),
    });
    const args = schema.parse(req.body);
    await callProvider(req, res, "reddit", args, drivers.redditPost);
  });

  // ---- TikTok Ads ----
  router.post("/agent-tools/tiktok-ads-create-campaign", async (req, res) => {
    const schema = z.object({
      name: z.string().min(1).max(200),
      objective: z.string().min(1),
      dailyBudgetUsd: z.number().positive(),
    });
    const args = schema.parse(req.body);
    await callProvider(req, res, "tiktok_ads", args, drivers.tiktokAdsCreateCampaign);
  });

  router.post("/agent-tools/tiktok-ads-get-report", async (req, res) => {
    const schema = z.object({ days: z.number().int().min(1).max(90).optional() });
    const args = schema.parse(req.body ?? {});
    await callProvider(req, res, "tiktok_ads", args, drivers.tiktokAdsGetReport);
  });

  // ---- GitHub ----
  router.post("/agent-tools/github-open-pr", async (req, res) => {
    const schema = z.object({
      owner: z.string().optional(),
      repo: z.string().optional(),
      title: z.string().min(1).max(256),
      head: z.string().min(1),
      base: z.string().min(1),
      body: z.string().max(60000).optional(),
      draft: z.boolean().optional(),
    });
    const args = schema.parse(req.body);
    await callProvider(req, res, "github", args, drivers.githubOpenPr);
  });

  router.post("/agent-tools/github-list-issues", async (req, res) => {
    const schema = z.object({
      owner: z.string().optional(),
      repo: z.string().optional(),
      state: z.enum(["open", "closed", "all"]).optional(),
      labels: z.string().optional(),
    });
    const args = schema.parse(req.body ?? {});
    await callProvider(req, res, "github", args, drivers.githubListIssues);
  });

  // ---- WordPress ----
  router.post("/agent-tools/wordpress-publish", async (req, res) => {
    const schema = z.object({
      title: z.string().min(1).max(300),
      content: z.string().min(1),
      status: z.enum(["draft", "publish", "pending"]).optional(),
      categories: z.array(z.number().int()).optional(),
      tags: z.array(z.number().int()).optional(),
    });
    const args = schema.parse(req.body);
    await callProvider(req, res, "wordpress", args, drivers.wordpressPublish);
  });

  // ---- MakeUGC ----
  router.post("/agent-tools/make-ugc-generate", async (req, res) => {
    const schema = z.object({
      script: z.string().min(1).max(10000),
      avatarId: z.string().optional(),
      voiceId: z.string().optional(),
    });
    const args = schema.parse(req.body);
    await callProvider(req, res, "make_ugc", args, drivers.makeUgcGenerate);
  });

  // ---- Salesforce Marketing Cloud ----
  router.post("/agent-tools/sfmc-send-email", async (req, res) => {
    const schema = z.object({
      triggeredSendKey: z.string().optional(),
      toAddress: z.string().email(),
      subscriberKey: z.string().optional(),
      attributes: z.record(z.unknown()).optional(),
    });
    const args = schema.parse(req.body);
    await callProvider(req, res, "sfmc", args, drivers.sfmcSendEmail);
  });

  // ---- Firebase (FCM) ----
  router.post("/agent-tools/firebase-push", async (req, res) => {
    const schema = z
      .object({
        token: z.string().optional(),
        topic: z.string().optional(),
        title: z.string().min(1).max(200),
        body: z.string().min(1).max(500),
        data: z.record(z.string()).optional(),
      })
      .refine((v) => !!v.token || !!v.topic, {
        message: "either token or topic is required",
      });
    const args = schema.parse(req.body);
    await callProvider(req, res, "firebase", args, drivers.firebasePush);
  });

  return router;
}

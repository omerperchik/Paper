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
import type { Db } from "@paperclipai/db";
import { toolResponse } from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { agentMemoryService } from "../services/agent-memory.js";
import { teamFeedService } from "../services/team-feed.js";
import { webSearch, formatSearchResultsForPrompt } from "../services/web-search.js";
import { unauthorized, unprocessable } from "../errors.js";

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
  const feed = teamFeedService(db);

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

  return router;
}

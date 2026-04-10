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
      res.json({
        query,
        count: results.length,
        results,
        formatted: formatSearchResultsForPrompt(query, results),
      });
    } catch (err) {
      res.status(502).json({
        error: "web_search_failed",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.post("/agent-tools/web-fetch", validate(webFetchSchema), async (req, res) => {
    requireAgentActor(req);
    const { url, maxBytes } = req.body as z.infer<typeof webFetchSchema>;

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
        res.status(502).json({
          error: "web_fetch_failed",
          status: response.status,
          message: `HTTP ${response.status} ${response.statusText}`,
        });
        return;
      }
      const contentType = response.headers.get("content-type") ?? "";
      const raw = await response.text();
      const text = /html|xml/i.test(contentType) ? htmlToText(raw) : raw;
      const cap = maxBytes ?? 12_000;
      const truncated = text.length > cap;
      res.json({
        url,
        contentType,
        status: response.status,
        truncated,
        text: truncated ? `${text.slice(0, cap)}…[truncated ${text.length - cap} chars]` : text,
      });
    } catch (err) {
      res.status(502).json({
        error: "web_fetch_failed",
        message: err instanceof Error ? err.message : String(err),
      });
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
    res.json({
      ok: true,
      memory: {
        id: memoryRow.id,
        scope: memoryRow.scope,
        key: memoryRow.key,
        updatedAt: memoryRow.updatedAt.toISOString(),
      },
    });
  });

  // ---------- git tools ----------

  router.post("/agent-tools/repo-list-files", validate(repoListSchema), async (req, res) => {
    requireAgentActor(req);
    const { repo, path, ref } = req.body as z.infer<typeof repoListSchema>;
    const cleanPath = (path ?? "").replace(/^\/+/, "");
    const qs = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const r = await githubFetch(`/repos/${repo}/contents/${encodeURI(cleanPath)}${qs}`);
    if (!r.ok) {
      res.status(r.status).json({ error: "github_error", status: r.status, message: r.text.slice(0, 500) });
      return;
    }
    const items = Array.isArray(r.json) ? r.json : [r.json];
    res.json({
      repo,
      path: cleanPath,
      items: items
        .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
        .map((x) => ({
          name: x.name,
          path: x.path,
          type: x.type,
          size: x.size,
          sha: x.sha,
        })),
    });
  });

  router.post("/agent-tools/repo-read-file", validate(repoReadSchema), async (req, res) => {
    requireAgentActor(req);
    const { repo, path, ref } = req.body as z.infer<typeof repoReadSchema>;
    const qs = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const r = await githubFetch(`/repos/${repo}/contents/${encodeURI(path)}${qs}`);
    if (!r.ok) {
      res.status(r.status).json({ error: "github_error", status: r.status, message: r.text.slice(0, 500) });
      return;
    }
    const obj = (r.json as Record<string, unknown>) ?? {};
    if (obj.type !== "file") {
      res.status(400).json({ error: "not_a_file", message: `path ${path} is not a file` });
      return;
    }
    const encoding = typeof obj.encoding === "string" ? obj.encoding : "base64";
    const contentB64 = typeof obj.content === "string" ? obj.content : "";
    let content: string;
    if (encoding === "base64") {
      content = Buffer.from(contentB64.replace(/\n/g, ""), "base64").toString("utf8");
    } else {
      content = contentB64;
    }
    const maxChars = 12_000;
    const truncated = content.length > maxChars;
    res.json({
      repo,
      path,
      sha: obj.sha,
      size: obj.size,
      truncated,
      content: truncated ? `${content.slice(0, maxChars)}…[truncated ${content.length - maxChars} chars]` : content,
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
        res.status(repoInfo.status).json({ error: "github_error", message: repoInfo.text.slice(0, 500) });
        return;
      }
      baseRef = ((repoInfo.json as Record<string, unknown>)?.default_branch as string) ?? "main";
    }

    // Ensure target branch exists. If it doesn't, create it from baseRef.
    const refProbe = await githubFetch(`/repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    if (!refProbe.ok && refProbe.status === 404) {
      const baseProbe = await githubFetch(`/repos/${repo}/git/ref/heads/${encodeURIComponent(baseRef)}`);
      if (!baseProbe.ok) {
        res.status(baseProbe.status).json({ error: "github_error", message: `base branch ${baseRef} not found: ${baseProbe.text.slice(0, 300)}` });
        return;
      }
      const baseSha = ((baseProbe.json as Record<string, unknown>)?.object as Record<string, unknown> | undefined)?.sha;
      if (typeof baseSha !== "string") {
        res.status(500).json({ error: "github_error", message: "could not resolve base branch sha" });
        return;
      }
      const createRef = await githubFetch(`/repos/${repo}/git/refs`, {
        method: "POST",
        body: { ref: `refs/heads/${branch}`, sha: baseSha },
      });
      if (!createRef.ok) {
        res.status(createRef.status).json({ error: "github_error", message: `failed to create branch: ${createRef.text.slice(0, 300)}` });
        return;
      }
    } else if (!refProbe.ok) {
      res.status(refProbe.status).json({ error: "github_error", message: refProbe.text.slice(0, 500) });
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
      res.status(put.status).json({ error: "github_error", status: put.status, message: put.text.slice(0, 500) });
      return;
    }
    const result = put.json as Record<string, unknown>;
    res.json({
      ok: true,
      repo,
      branch,
      path,
      commit: (result?.commit as Record<string, unknown> | undefined)?.sha,
      content: (result?.content as Record<string, unknown> | undefined)?.sha,
    });
  });

  router.post("/agent-tools/repo-open-pr", validate(repoOpenPrSchema), async (req, res) => {
    requireAgentActor(req);
    const { repo, title, body, head, base } = req.body as z.infer<typeof repoOpenPrSchema>;
    let targetBase = base;
    if (!targetBase) {
      const repoInfo = await githubFetch(`/repos/${repo}`);
      if (!repoInfo.ok) {
        res.status(repoInfo.status).json({ error: "github_error", message: repoInfo.text.slice(0, 500) });
        return;
      }
      targetBase = ((repoInfo.json as Record<string, unknown>)?.default_branch as string) ?? "main";
    }
    const pr = await githubFetch(`/repos/${repo}/pulls`, {
      method: "POST",
      body: { title, body: body ?? "", head, base: targetBase },
    });
    if (!pr.ok) {
      res.status(pr.status).json({ error: "github_error", status: pr.status, message: pr.text.slice(0, 500) });
      return;
    }
    const obj = pr.json as Record<string, unknown>;
    res.json({
      ok: true,
      repo,
      number: obj.number,
      url: obj.html_url,
      state: obj.state,
      head: (obj.head as Record<string, unknown> | undefined)?.ref,
      base: (obj.base as Record<string, unknown> | undefined)?.ref,
    });
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
    res.json({
      query,
      count: rows.length,
      results: rows.map((r) => ({
        id: r.id,
        scope: r.scope,
        key: r.key,
        content: r.content,
        writtenByAgentId: r.agentId,
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  });

  router.post("/agent-tools/agent-stats", validate(agentStatsSchema), async (req, res) => {
    const { agentId, companyId } = requireAgentActor(req);
    const { scope, window } = req.body as z.infer<typeof agentStatsSchema>;
    // team scope = this agent's reports_to subtree; company = all agents.
    const managerId = scope === "company" ? null : agentId;
    const rows = await feed.leaderboard(companyId, managerId, window);
    res.json({
      scope,
      window,
      count: rows.length,
      rows: rows.map((r) => ({
        agentId: r.agentId,
        agentName: r.agentName,
        role: r.role,
        reportsTo: r.reportsTo,
        heartbeatRunsOk: r.heartbeatRunsOk,
        heartbeatRunsFailed: r.heartbeatRunsFailed,
        issuesCreated: r.issuesCreated,
        commentsPosted: r.commentsPosted,
        memoriesWritten: r.memoriesWritten,
        humanQuestionsAsked: r.humanQuestionsAsked,
      })),
    });
  });

  return router;
}

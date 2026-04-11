// Agent playbooks — the learning loop.
//
// After every heartbeat run, a lightweight retrospective extracts a pattern
// (derived from the issue title/role/run-purpose) and upserts a row in
// agent_playbooks recording what the agent tried, how it went, and a one-line
// insight. At context-assembly time, top-N matching playbook rows are
// injected as "last time you did this:" hints.
//
// v1 pattern-matching is keyword-based. Upgrade to embedding similarity when
// the dataset is large enough to justify it.

import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentPlaybooks } from "@paperclipai/db";
import { embed } from "./embeddings.js";

export type PlaybookOutcome = "success" | "partial" | "failure";

export interface PlaybookRecord {
  id: string;
  pattern: string;
  approach: string;
  lastInsight: string;
  successCount: number;
  failureCount: number;
  partialCount: number;
  avgIterations: number;
  avgCostCents: number;
  lastOutcome: string | null;
  lastUsedAt: Date;
}

export interface RetroInput {
  companyId: string;
  agentId: string;
  agentRole: string | null;
  runId: string;
  pattern: string;
  approach: string;
  insight: string;
  outcome: PlaybookOutcome;
  iterations: number;
  costCents: number;
}

/**
 * Heuristic pattern extractor. Given an issue title + agent role + run
 * purpose, returns a stable snake_case pattern key. Keeps the vocabulary
 * small so the same real task clusters into the same playbook row.
 */
export function derivePattern(input: {
  agentRole?: string | null;
  issueTitle?: string | null;
  purpose?: string | null;
}): string {
  const parts: string[] = [];
  const role = (input.agentRole ?? "").toLowerCase().trim();
  if (role) parts.push(role.replace(/[^a-z0-9]+/g, "_"));

  const raw = (input.issueTitle ?? input.purpose ?? "").toLowerCase();
  // Keep salient verbs + nouns; drop stop-words.
  const STOP = new Set([
    "a","an","the","and","or","of","to","for","in","on","with","at","by",
    "from","as","is","are","be","it","this","that","do","make","please",
    "help","new","old","next","quick","simple","basic","need","want",
  ]);
  const tokens = raw
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t))
    .slice(0, 4);
  if (tokens.length > 0) parts.push(tokens.join("_"));
  if (parts.length === 0) return "general_work";
  return parts.join(":");
}

export function agentPlaybookService(db: Db) {
  return {
    async recordRetrospective(input: RetroInput): Promise<PlaybookRecord> {
      const now = new Date();
      const existing = await db
        .select()
        .from(agentPlaybooks)
        .where(
          and(
            eq(agentPlaybooks.agentId, input.agentId),
            eq(agentPlaybooks.pattern, input.pattern),
          ),
        )
        .limit(1)
        .then((r) => r[0] ?? null);

      // Best-effort: embed pattern + approach + insight so hybrid recall
      // can use the vector channel. Returns null if no embedding backend
      // is configured — that's fine, RRF degrades to keyword-only.
      const embeddingText = [input.pattern, input.approach, input.insight]
        .filter(Boolean)
        .join(" — ");
      const embedding = await embed(embeddingText).catch(() => null);

      if (existing) {
        const totalBefore =
          existing.successCount + existing.failureCount + existing.partialCount;
        const totalAfter = totalBefore + 1;
        const newAvgIter = Math.round(
          (existing.avgIterations * totalBefore + input.iterations) / totalAfter,
        );
        const newAvgCost = Math.round(
          (existing.avgCostCents * totalBefore + input.costCents) / totalAfter,
        );
        const updated = await db
          .update(agentPlaybooks)
          .set({
            approach: input.approach || existing.approach,
            lastInsight: input.insight || existing.lastInsight,
            successCount:
              existing.successCount + (input.outcome === "success" ? 1 : 0),
            failureCount:
              existing.failureCount + (input.outcome === "failure" ? 1 : 0),
            partialCount:
              existing.partialCount + (input.outcome === "partial" ? 1 : 0),
            avgIterations: newAvgIter,
            avgCostCents: newAvgCost,
            lastRunId: input.runId,
            lastOutcome: input.outcome,
            lastUsedAt: now,
            updatedAt: now,
            ...(embedding ? { embedding } : {}),
          })
          .where(eq(agentPlaybooks.id, existing.id))
          .returning()
          .then((r) => r[0]);
        return toRecord(updated);
      }

      const inserted = await db
        .insert(agentPlaybooks)
        .values({
          companyId: input.companyId,
          agentId: input.agentId,
          agentRole: input.agentRole,
          pattern: input.pattern,
          approach: input.approach,
          lastInsight: input.insight,
          successCount: input.outcome === "success" ? 1 : 0,
          failureCount: input.outcome === "failure" ? 1 : 0,
          partialCount: input.outcome === "partial" ? 1 : 0,
          avgIterations: input.iterations,
          avgCostCents: input.costCents,
          lastRunId: input.runId,
          lastOutcome: input.outcome,
          lastUsedAt: now,
          ...(embedding ? { embedding } : {}),
        })
        .returning()
        .then((r) => r[0]);
      return toRecord(inserted);
    },

    /**
     * Find the top-N playbook rows most relevant to the current task. Ranks by:
     *  1. Exact pattern match (highest)
     *  2. Fuzzy pattern keyword match (ILIKE on pattern + approach + insight)
     *  3. Recency (fallback)
     * Returns at most `limit` rows.
     */
    async findRelevant(input: {
      agentId: string;
      pattern: string;
      limit?: number;
    }): Promise<PlaybookRecord[]> {
      const limit = input.limit ?? 3;
      // Exact match first.
      const exact = await db
        .select()
        .from(agentPlaybooks)
        .where(
          and(
            eq(agentPlaybooks.agentId, input.agentId),
            eq(agentPlaybooks.pattern, input.pattern),
          ),
        )
        .limit(1);

      // Fuzzy — split the pattern into keywords and ILIKE match any.
      const keywords = input.pattern
        .split(/[_:]/)
        .filter((k) => k.length >= 3);

      const fuzzyRows =
        keywords.length > 0
          ? await db
              .select()
              .from(agentPlaybooks)
              .where(
                and(
                  eq(agentPlaybooks.agentId, input.agentId),
                  or(
                    ...keywords.map((k) =>
                      ilike(agentPlaybooks.pattern, `%${k}%`),
                    ),
                  ),
                ),
              )
              .orderBy(desc(agentPlaybooks.lastUsedAt))
              .limit(limit * 3)
          : [];

      const merged = new Map<string, typeof fuzzyRows[number]>();
      for (const r of exact) merged.set(r.id, r);
      for (const r of fuzzyRows) if (!merged.has(r.id)) merged.set(r.id, r);
      return Array.from(merged.values()).slice(0, limit).map(toRecord);
    },

    /**
     * Hybrid recall: combines a keyword channel (pg_trgm similarity over
     * pattern + approach + last_insight) with a vector channel (pgvector
     * cosine distance over the embedding column) using Reciprocal Rank
     * Fusion. RRF score = sum_channels 1/(K + rank_in_channel), K=60.
     *
     * Falls back to keyword-only when no embedding backend is configured
     * (embed() returns null) — RRF still works with one channel.
     *
     * Use this for "find playbooks relevant to this task" — strictly better
     * than findRelevant once embeddings are populated, and equivalent
     * (modulo trigram vs ilike) when they aren't.
     */
    async recallHybrid(input: {
      agentId: string;
      query: string;
      limit?: number;
    }): Promise<PlaybookRecord[]> {
      const limit = input.limit ?? 5;
      const RRF_K = 60;
      const POOL = limit * 4;

      // Channel 1: keyword via pg_trgm similarity over the concatenation.
      // Order by similarity desc; ties broken by recency.
      const keywordRows = await db
        .select({
          id: agentPlaybooks.id,
          row: agentPlaybooks,
          sim: sql<number>`greatest(
            similarity(${agentPlaybooks.pattern}, ${input.query}),
            similarity(${agentPlaybooks.approach}, ${input.query}),
            similarity(${agentPlaybooks.lastInsight}, ${input.query})
          )`.as("sim"),
        })
        .from(agentPlaybooks)
        .where(eq(agentPlaybooks.agentId, input.agentId))
        .orderBy(
          sql`greatest(
            similarity(${agentPlaybooks.pattern}, ${input.query}),
            similarity(${agentPlaybooks.approach}, ${input.query}),
            similarity(${agentPlaybooks.lastInsight}, ${input.query})
          ) desc`,
          desc(agentPlaybooks.lastUsedAt),
        )
        .limit(POOL);

      // Channel 2: vector cosine distance — only if embedding succeeds.
      let vectorRows: typeof keywordRows = [];
      const queryEmbedding = await embed(input.query).catch(() => null);
      if (queryEmbedding) {
        const literal = `[${queryEmbedding.join(",")}]`;
        vectorRows = (await db
          .select({
            id: agentPlaybooks.id,
            row: agentPlaybooks,
            sim: sql<number>`1 - (${agentPlaybooks.embedding} <=> ${literal}::vector)`.as("sim"),
          })
          .from(agentPlaybooks)
          .where(
            and(
              eq(agentPlaybooks.agentId, input.agentId),
              sql`${agentPlaybooks.embedding} is not null`,
            ),
          )
          .orderBy(sql`${agentPlaybooks.embedding} <=> ${literal}::vector`)
          .limit(POOL)) as typeof keywordRows;
      }

      // Reciprocal Rank Fusion across both channels.
      const scores = new Map<string, { score: number; row: typeof keywordRows[number]["row"] }>();
      const accumulate = (rows: typeof keywordRows) => {
        rows.forEach((r, idx) => {
          const rank = idx + 1;
          const inc = 1 / (RRF_K + rank);
          const prev = scores.get(r.id);
          if (prev) prev.score += inc;
          else scores.set(r.id, { score: inc, row: r.row });
        });
      };
      accumulate(keywordRows);
      accumulate(vectorRows);

      const ranked = Array.from(scores.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((s) => toRecord(s.row));
      return ranked;
    },
  };
}

function toRecord(row: {
  id: string;
  pattern: string;
  approach: string;
  lastInsight: string;
  successCount: number;
  failureCount: number;
  partialCount: number;
  avgIterations: number;
  avgCostCents: number;
  lastOutcome: string | null;
  lastUsedAt: Date;
}): PlaybookRecord {
  return {
    id: row.id,
    pattern: row.pattern,
    approach: row.approach,
    lastInsight: row.lastInsight,
    successCount: row.successCount,
    failureCount: row.failureCount,
    partialCount: row.partialCount,
    avgIterations: row.avgIterations,
    avgCostCents: row.avgCostCents,
    lastOutcome: row.lastOutcome,
    lastUsedAt: row.lastUsedAt,
  };
}

// ---------------------------------------------------------------------------
// Content Gap — Find content topics competitors cover that you do not
// ---------------------------------------------------------------------------

import type { PluginContext, ContentGapEntry } from "../types.js";
import { loadCompetitors, STATE_SCOPE } from "./competitor-tracker.js";

const CONTENT_TYPE_PATHS: Record<string, string[]> = {
  blog: ["/blog", "/articles", "/resources/blog"],
  docs: ["/docs", "/documentation", "/help"],
  guides: ["/guides", "/tutorials", "/resources/guides"],
  case_studies: ["/case-studies", "/customers", "/success-stories"],
  comparisons: ["/compare", "/vs", "/alternatives"],
};

/**
 * Extract topic signals from headings and text of stored snapshots.
 */
async function extractTopics(
  ctx: PluginContext,
  competitorId: string,
): Promise<Array<{ topic: string; url: string; contentType: string }>> {
  try {
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `snapshots:${competitorId}` });
    if (!raw) return [];

    const snapshots = JSON.parse(raw as string) as Array<{
      pages: Array<{ url: string; headings: string[]; textContent: string }>;
    }>;
    const latest = snapshots[snapshots.length - 1];
    if (!latest) return [];

    const topics: Array<{ topic: string; url: string; contentType: string }> = [];

    for (const page of latest.pages) {
      // Determine content type from URL
      let contentType = "general";
      for (const [type, paths] of Object.entries(CONTENT_TYPE_PATHS)) {
        if (paths.some((p) => page.url.includes(p))) {
          contentType = type;
          break;
        }
      }

      // Extract topics from headings
      for (const heading of page.headings) {
        if (heading.length > 10 && heading.length < 150) {
          topics.push({ topic: heading, url: page.url, contentType });
        }
      }

      // Extract topic signals from text (simple keyword phrase extraction)
      const sentences = page.textContent.split(/[.!?]+/).filter((s) => s.trim().length > 20 && s.trim().length < 150);
      for (const sentence of sentences.slice(0, 10)) {
        topics.push({ topic: sentence.trim(), url: page.url, contentType });
      }
    }

    return topics;
  } catch (err) {
    ctx.logger.warn("Failed to extract topics", { competitorId, error: String(err) });
    return [];
  }
}

/**
 * Extract own topics from own site snapshots or config.
 */
async function extractOwnTopics(ctx: PluginContext): Promise<Set<string>> {
  try {
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: "own-topics" });
    if (raw) {
      const topics = JSON.parse(raw as string) as string[];
      return new Set(topics.map((t) => t.toLowerCase()));
    }
  } catch { /* no own topics cached */ }
  return new Set();
}

function computeRelevance(topic: string, contentType: string): number {
  let score = 0.5;
  // Boost comparison and case study content
  if (contentType === "comparisons") score += 0.3;
  if (contentType === "case_studies") score += 0.2;
  if (contentType === "guides") score += 0.1;
  // Boost topics with actionable language
  if (/how to|guide|tutorial|best practices|tips/i.test(topic)) score += 0.15;
  // Cap at 1
  return Math.min(score, 1);
}

export function registerContentGapTools(ctx: PluginContext) {

  ctx.tools.register("competitive_content_gap", async ({ params }) => {
    const { competitorIds, contentTypes } = params as {
      competitorIds: string[];
      contentTypes?: string[];
    };

    if (!competitorIds || competitorIds.length === 0) {
      return { error: "'competitorIds' must contain at least one competitor ID." };
    }

    const competitors = await loadCompetitors(ctx);
    const ownTopics = await extractOwnTopics(ctx);

    const gaps: ContentGapEntry[] = [];

    for (const compId of competitorIds) {
      const comp = competitors.find((c) => c.id === compId);
      if (!comp) {
        ctx.logger.warn("Competitor not found, skipping", { competitorId: compId });
        continue;
      }

      const compTopics = await extractTopics(ctx, compId);

      for (const ct of compTopics) {
        // Filter by content type if specified
        if (contentTypes && contentTypes.length > 0 && !contentTypes.includes(ct.contentType)) {
          continue;
        }

        // Check if we already cover this topic (fuzzy match)
        const topicLower = ct.topic.toLowerCase();
        const alreadyCovered = [...ownTopics].some((own) => {
          // Simple overlap check: at least 60% word overlap
          const ownWords = new Set(own.split(/\s+/));
          const topicWords = topicLower.split(/\s+/);
          const overlap = topicWords.filter((w) => ownWords.has(w)).length;
          return topicWords.length > 0 && overlap / topicWords.length > 0.6;
        });

        if (!alreadyCovered) {
          gaps.push({
            topic: ct.topic,
            contentType: ct.contentType,
            competitorId: compId,
            competitorUrl: ct.url,
            relevanceScore: computeRelevance(ct.topic, ct.contentType),
          });
        }
      }
    }

    // Sort by relevance descending
    gaps.sort((a, b) => b.relevanceScore - a.relevanceScore);

    // Deduplicate similar topics
    const seen = new Set<string>();
    const deduped = gaps.filter((g) => {
      const key = g.topic.toLowerCase().slice(0, 50);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    ctx.logger.info("Content gap analysis completed", { totalGaps: deduped.length });

    return {
      gaps: deduped.slice(0, 50),
      totalGapsFound: deduped.length,
      byContentType: Object.fromEntries(
        Object.keys(CONTENT_TYPE_PATHS).map((t) => [t, deduped.filter((g) => g.contentType === t).length]),
      ),
    };
  });
}

// Activity entity extraction — gbrain-inspired back-links.
//
// After every activity_log row is created, scan its `details` JSON, action,
// and entity fields for things worth tracking — URLs, mentions, integration
// providers, campaign IDs, agent ids, issue ids — and insert one row per
// entity into activity_entities. The UI surfaces these as clickable pills
// next to each feed event, and the back-link API returns "everything we
// know about X" — a huge operator win that turns the feed from a flat log
// into a queryable knowledge graph.

import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { activityEntities, activityLog } from "@paperclipai/db";

export interface ExtractedEntity {
  type: string;
  key: string;
  label?: string;
}

const URL_RE = /(https?:\/\/[^\s)\]"']+)/gi;
const MENTION_RE = /(?:^|\s)@([a-z0-9_][a-z0-9_-]{1,40})/gi;
const PROVIDER_HINTS: Record<string, RegExp> = {
  google_ads: /\b(google[\s_-]?ads|gads|adwords)\b/i,
  facebook_ads: /\b(facebook[\s_-]?ads|meta[\s_-]?ads|fb[\s_-]?ads)\b/i,
  x: /\b(twitter|x\.com|tweeted?)\b/i,
  reddit: /\breddit\b/i,
  tiktok_ads: /\btiktok\b/i,
  wordpress: /\bwordpress\b/i,
  github: /\bgithub\b/i,
  firebase: /\bfirebase\b/i,
  sfmc: /\bsalesforce[\s_-]?marketing/i,
  make_ugc: /\bmake[\s_-]?ugc\b/i,
};

function pushUnique(out: ExtractedEntity[], e: ExtractedEntity) {
  const key = `${e.type}:${e.key.toLowerCase()}`;
  if (out.some((x) => `${x.type}:${x.key.toLowerCase()}` === key)) return;
  out.push({ ...e, key: e.key.toLowerCase() });
}

/**
 * Extract entities from an activity row's structured + free-text fields.
 * Pure function — no DB access, easy to unit test.
 */
export function extractEntities(input: {
  action?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  agentId?: string | null;
  details?: Record<string, unknown> | null;
}): ExtractedEntity[] {
  const out: ExtractedEntity[] = [];

  if (input.entityType && input.entityId) {
    pushUnique(out, {
      type: input.entityType,
      key: input.entityId,
    });
  }
  if (input.agentId) {
    pushUnique(out, { type: "agent", key: input.agentId });
  }

  // Walk the details JSON and pull strings out for regex scanning. Cap at
  // 10kb of stringified detail to bound work.
  let detailsText = "";
  if (input.details && typeof input.details === "object") {
    try {
      detailsText = JSON.stringify(input.details).slice(0, 10_000);
    } catch {
      detailsText = "";
    }
    // Also pick up structured "providerKey", "campaignId", "url", etc.
    const d = input.details as Record<string, unknown>;
    for (const [k, v] of Object.entries(d)) {
      if (typeof v !== "string" || v.length === 0 || v.length > 200) continue;
      const lk = k.toLowerCase();
      if (lk.includes("campaignid") || lk === "campaign_id") {
        pushUnique(out, { type: "campaign", key: v });
      } else if (lk.includes("adaccountid") || lk === "ad_account_id") {
        pushUnique(out, { type: "ad_account", key: v });
      } else if (lk === "provider") {
        pushUnique(out, { type: "provider", key: v });
      } else if (lk === "issueid" || lk === "issue_id") {
        pushUnique(out, { type: "issue", key: v });
      } else if (lk === "url" || lk === "href" || lk === "link") {
        const m = v.match(URL_RE);
        if (m) for (const u of m) pushUnique(out, { type: "url", key: u });
      }
    }
  }
  const haystack = [input.action ?? "", detailsText].join(" ");

  // URLs
  const urls = haystack.match(URL_RE) ?? [];
  for (const u of urls) {
    try {
      const parsed = new URL(u);
      pushUnique(out, { type: "url", key: parsed.href, label: parsed.hostname });
    } catch {
      // ignore
    }
  }

  // @mentions
  let m: RegExpExecArray | null;
  const mentionRe = new RegExp(MENTION_RE.source, "gi");
  while ((m = mentionRe.exec(haystack)) !== null) {
    pushUnique(out, { type: "mention", key: m[1], label: `@${m[1]}` });
  }

  // Provider hints
  for (const [provider, re] of Object.entries(PROVIDER_HINTS)) {
    if (re.test(haystack)) {
      pushUnique(out, { type: "provider", key: provider });
    }
  }

  return out;
}

export function activityEntitiesService(db: Db) {
  return {
    /** Persist extracted entities for an activity row. Best-effort, swallows errors. */
    async record(
      companyId: string,
      activityId: string,
      entities: ExtractedEntity[],
    ): Promise<number> {
      if (entities.length === 0) return 0;
      try {
        const rows = entities.map((e) => ({
          companyId,
          activityId,
          entityType: e.type,
          entityKey: e.key,
          entityLabel: e.label ?? null,
        }));
        await db.insert(activityEntities).values(rows);
        return rows.length;
      } catch {
        return 0;
      }
    },

    /** Return up to N entity rows for an activity. Used to render pills. */
    async forActivity(activityId: string) {
      return db
        .select()
        .from(activityEntities)
        .where(eq(activityEntities.activityId, activityId));
    },

    /**
     * Look up every activity row that has touched a given entity. Powers
     * the "everything we know about X" back-link drawer in the UI.
     */
    async backlinks(input: {
      companyId: string;
      type: string;
      key: string;
      limit?: number;
    }) {
      const limit = input.limit ?? 100;
      return db
        .select({
          activityId: activityEntities.activityId,
          entityType: activityEntities.entityType,
          entityKey: activityEntities.entityKey,
          entityLabel: activityEntities.entityLabel,
          activity: activityLog,
        })
        .from(activityEntities)
        .innerJoin(activityLog, eq(activityEntities.activityId, activityLog.id))
        .where(
          and(
            eq(activityEntities.companyId, input.companyId),
            eq(activityEntities.entityType, input.type),
            eq(activityEntities.entityKey, input.key.toLowerCase()),
          ),
        )
        .orderBy(desc(activityLog.createdAt))
        .limit(limit);
    },

    /** Aggregate counts of all entities seen in this company. For dashboards/autocomplete. */
    async topEntities(companyId: string, type?: string, limit = 50) {
      // Drizzle doesn't have first-class group-by builders for arbitrary
      // aggregates here; raw SQL is fine and faster.
      return db.execute(
        type
          ? // typed branch
            (await import("drizzle-orm")).sql`
              select entity_type, entity_key, entity_label,
                     count(*)::int as event_count,
                     max(created_at) as last_seen
              from ${activityEntities}
              where company_id = ${companyId}
                and entity_type = ${type}
              group by entity_type, entity_key, entity_label
              order by event_count desc, last_seen desc
              limit ${limit}
            `
          : (await import("drizzle-orm")).sql`
              select entity_type, entity_key, entity_label,
                     count(*)::int as event_count,
                     max(created_at) as last_seen
              from ${activityEntities}
              where company_id = ${companyId}
              group by entity_type, entity_key, entity_label
              order by event_count desc, last_seen desc
              limit ${limit}
            `,
      );
    },
  };
}

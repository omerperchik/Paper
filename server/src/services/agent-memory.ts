// Persistent memory service for agents. Backs paperclipMemoryWrite and
// paperclipMemorySearch. v1 uses plain ILIKE text search — upgrade to
// pgvector when this becomes the bottleneck. Scopes:
//   self    → visible only to the writing agent
//   team    → visible to writer's manager + direct reports (by reports_to)
//   company → visible to every agent in the company

import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentMemories, agents } from "@paperclipai/db";

export type MemoryScope = "self" | "team" | "company";

export interface WriteMemoryInput {
  companyId: string;
  agentId: string;
  scope: MemoryScope;
  key: string;
  content: string;
}

export interface SearchMemoryInput {
  companyId: string;
  agentId: string;
  query: string;
  limit: number;
}

export interface MemoryRecord {
  id: string;
  scope: string;
  key: string;
  content: string;
  agentId: string;
  updatedAt: Date;
}

export function agentMemoryService(db: Db) {
  return {
    /**
     * Upsert a memory. (agent_id, scope, key) is unique, so writing with the
     * same key overwrites the existing row. Pass a new key to make a new one.
     */
    async write(input: WriteMemoryInput): Promise<MemoryRecord> {
      const now = new Date();
      const key = input.key ?? "";
      const existing = await db
        .select()
        .from(agentMemories)
        .where(
          and(
            eq(agentMemories.agentId, input.agentId),
            eq(agentMemories.scope, input.scope),
            eq(agentMemories.key, key),
          ),
        )
        .limit(1)
        .then((rows) => rows[0] ?? null);

      if (existing) {
        const updated = await db
          .update(agentMemories)
          .set({ content: input.content, updatedAt: now })
          .where(eq(agentMemories.id, existing.id))
          .returning()
          .then((rows) => rows[0]);
        return {
          id: updated.id,
          scope: updated.scope,
          key: updated.key,
          content: updated.content,
          agentId: updated.agentId,
          updatedAt: updated.updatedAt,
        };
      }

      const inserted = await db
        .insert(agentMemories)
        .values({
          companyId: input.companyId,
          agentId: input.agentId,
          scope: input.scope,
          key,
          content: input.content,
        })
        .returning()
        .then((rows) => rows[0]);
      return {
        id: inserted.id,
        scope: inserted.scope,
        key: inserted.key,
        content: inserted.content,
        agentId: inserted.agentId,
        updatedAt: inserted.updatedAt,
      };
    },

    /**
     * Search memories visible to this agent. Visibility rules:
     *   - self    memories where agent_id = me
     *   - team    memories where the writer's manager chain touches me OR
     *             I manage the writer (reports_to) OR same manager
     *   - company memories where company_id = my company
     *
     * v1 uses a simple resolver: we fetch all candidate rows for the company
     * and filter in JS. Fine for small companies (<1k memories). Upgrade path:
     * materialized view or pgvector.
     */
    async search(input: SearchMemoryInput): Promise<MemoryRecord[]> {
      const qLike = `%${input.query.replace(/[%_]/g, "\\$&")}%`;

      // Pull candidates: all company-scope rows, all self rows where I'm the
      // agent, all team rows in my company (we'll filter by reports_to below).
      const rows = await db
        .select({
          id: agentMemories.id,
          scope: agentMemories.scope,
          key: agentMemories.key,
          content: agentMemories.content,
          agentId: agentMemories.agentId,
          updatedAt: agentMemories.updatedAt,
        })
        .from(agentMemories)
        .where(
          and(
            eq(agentMemories.companyId, input.companyId),
            or(ilike(agentMemories.content, qLike), ilike(agentMemories.key, qLike)),
          ),
        )
        .orderBy(desc(agentMemories.updatedAt))
        .limit(Math.max(input.limit * 4, 40));

      // Resolve team visibility by loading reports_to for relevant agents.
      const agentIds = Array.from(new Set(rows.map((r) => r.agentId)));
      if (agentIds.length === 0) return [];

      const agentRows = await db
        .select({ id: agents.id, reportsTo: agents.reportsTo })
        .from(agents)
        .where(sql`${agents.id} = ANY(${agentIds})`);
      const reportsToByAgent = new Map<string, string | null>();
      for (const a of agentRows) reportsToByAgent.set(a.id, a.reportsTo ?? null);

      const meReportsTo = reportsToByAgent.get(input.agentId) ?? null;

      const visible = rows.filter((r) => {
        if (r.scope === "company") return true;
        if (r.scope === "self") return r.agentId === input.agentId;
        if (r.scope === "team") {
          if (r.agentId === input.agentId) return true;
          const writerManager = reportsToByAgent.get(r.agentId) ?? null;
          // writer reports to me
          if (writerManager === input.agentId) return true;
          // I report to the writer
          if (meReportsTo === r.agentId) return true;
          // Same manager (peer team)
          if (meReportsTo && writerManager && meReportsTo === writerManager) return true;
          return false;
        }
        return false;
      });

      return visible.slice(0, input.limit);
    },
  };
}

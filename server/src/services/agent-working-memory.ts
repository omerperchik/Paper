// Persistent working memory for agents — the "live cursor" that survives
// across heartbeats. One row per agent; a structured scratchpad the agent
// reads at the top of every heartbeat and updates at the end.
//
// Different from agent_memories (grab-bag log of facts): this is the
// agent's current thinking state. Reading it is how the agent avoids
// re-inferring the world from scratch on every wake.

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agentWorkingMemory,
  type OpenThread,
  type RecentDecision,
  type ExpectedResponse,
  type MemoryTimelineEntry,
} from "@paperclipai/db";

export interface WorkingMemoryRecord {
  agentId: string;
  currentFocus: string;
  openThreads: OpenThread[];
  recentDecisions: RecentDecision[];
  expectedResponses: ExpectedResponse[];
  /** Mutable best-current-understanding paragraph (gbrain "compiled truth"). */
  compiled: string;
  /** Append-only evidence log capped at MAX_TIMELINE entries. */
  timeline: MemoryTimelineEntry[];
  updatedAt: Date;
}

export interface WorkingMemoryPatch {
  currentFocus?: string;
  openThreads?: OpenThread[];
  recentDecisions?: RecentDecision[];
  expectedResponses?: ExpectedResponse[];
  compiled?: string;
  /** When provided, these entries are appended to the existing timeline. */
  appendTimeline?: MemoryTimelineEntry[];
}

const MAX_OPEN_THREADS = 10;
const MAX_RECENT_DECISIONS = 10;
const MAX_EXPECTED_RESPONSES = 10;
const MAX_TIMELINE = 100;

function trim<T>(arr: T[] | undefined, max: number): T[] {
  if (!Array.isArray(arr)) return [];
  return arr.slice(-max);
}

export function agentWorkingMemoryService(db: Db) {
  return {
    async read(agentId: string): Promise<WorkingMemoryRecord | null> {
      const row = await db
        .select()
        .from(agentWorkingMemory)
        .where(eq(agentWorkingMemory.agentId, agentId))
        .limit(1)
        .then((r) => r[0] ?? null);
      if (!row) return null;
      return {
        agentId: row.agentId,
        currentFocus: row.currentFocus,
        openThreads: row.openThreads ?? [],
        recentDecisions: row.recentDecisions ?? [],
        expectedResponses: row.expectedResponses ?? [],
        compiled: row.compiled ?? "",
        timeline: row.timeline ?? [],
        updatedAt: row.updatedAt,
      };
    },

    /**
     * Upsert the agent's working memory. Unlike the memories service, this
     * is a full overwrite of the provided fields — the model should read,
     * reason about, and write back the complete state each heartbeat.
     */
    async upsert(input: {
      companyId: string;
      agentId: string;
      patch: WorkingMemoryPatch;
    }): Promise<WorkingMemoryRecord> {
      const now = new Date();
      const existing = await db
        .select()
        .from(agentWorkingMemory)
        .where(eq(agentWorkingMemory.agentId, input.agentId))
        .limit(1)
        .then((r) => r[0] ?? null);

      const existingTimeline = (existing?.timeline as MemoryTimelineEntry[] | null) ?? [];
      const appended = input.patch.appendTimeline ?? [];
      const nextTimeline = trim<MemoryTimelineEntry>(
        [...existingTimeline, ...appended],
        MAX_TIMELINE,
      );

      const merged = {
        currentFocus: input.patch.currentFocus ?? existing?.currentFocus ?? "",
        openThreads: trim(
          input.patch.openThreads ?? existing?.openThreads ?? [],
          MAX_OPEN_THREADS,
        ),
        recentDecisions: trim(
          input.patch.recentDecisions ?? existing?.recentDecisions ?? [],
          MAX_RECENT_DECISIONS,
        ),
        expectedResponses: trim(
          input.patch.expectedResponses ?? existing?.expectedResponses ?? [],
          MAX_EXPECTED_RESPONSES,
        ),
        compiled: input.patch.compiled ?? existing?.compiled ?? "",
        timeline: nextTimeline,
      };

      if (existing) {
        const updated = await db
          .update(agentWorkingMemory)
          .set({
            currentFocus: merged.currentFocus,
            openThreads: merged.openThreads,
            recentDecisions: merged.recentDecisions,
            expectedResponses: merged.expectedResponses,
            compiled: merged.compiled,
            timeline: merged.timeline,
            updatedAt: now,
          })
          .where(eq(agentWorkingMemory.id, existing.id))
          .returning()
          .then((r) => r[0]);
        return {
          agentId: updated.agentId,
          currentFocus: updated.currentFocus,
          openThreads: updated.openThreads ?? [],
          recentDecisions: updated.recentDecisions ?? [],
          expectedResponses: updated.expectedResponses ?? [],
          compiled: updated.compiled ?? "",
          timeline: updated.timeline ?? [],
          updatedAt: updated.updatedAt,
        };
      }

      const inserted = await db
        .insert(agentWorkingMemory)
        .values({
          companyId: input.companyId,
          agentId: input.agentId,
          currentFocus: merged.currentFocus,
          openThreads: merged.openThreads,
          recentDecisions: merged.recentDecisions,
          expectedResponses: merged.expectedResponses,
          compiled: merged.compiled,
          timeline: merged.timeline,
        })
        .returning()
        .then((r) => r[0]);
      return {
        agentId: inserted.agentId,
        currentFocus: inserted.currentFocus,
        openThreads: inserted.openThreads ?? [],
        recentDecisions: inserted.recentDecisions ?? [],
        expectedResponses: inserted.expectedResponses ?? [],
        compiled: inserted.compiled ?? "",
        timeline: inserted.timeline ?? [],
        updatedAt: inserted.updatedAt,
      };
    },
  };
}

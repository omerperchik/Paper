// Shared company world model. One row per company; every agent reads it at
// the top of every heartbeat. Only CEO-role agents can write (enforced here).
//
// This is the "context waterfall" primitive: a CEO flip of `strategy.currentFocus`
// shows up in every subordinate's next heartbeat context automatically. No
// chain-of-whispers via comments.

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  companyState,
  type StrategyBlock,
  type OkrEntry,
  type ConstraintsBlock,
  type PivotEntry,
  type TruthEntry,
  type OpenDecisionEntry,
} from "@paperclipai/db";

export interface CompanyStateRecord {
  companyId: string;
  version: number;
  strategy: StrategyBlock;
  okrs: OkrEntry[];
  constraints: ConstraintsBlock;
  recentPivots: PivotEntry[];
  knownTruths: TruthEntry[];
  openDecisions: OpenDecisionEntry[];
  updatedByAgentId: string | null;
  updatedAt: Date;
}

export interface CompanyStatePatch {
  strategy?: StrategyBlock;
  okrs?: OkrEntry[];
  constraints?: ConstraintsBlock;
  recentPivots?: PivotEntry[];
  knownTruths?: TruthEntry[];
  openDecisions?: OpenDecisionEntry[];
}

const MAX_PIVOTS = 10;
const MAX_TRUTHS = 30;
const MAX_OPEN_DECISIONS = 15;
const MAX_OKRS = 10;

function clip<T>(arr: T[] | undefined, max: number): T[] {
  if (!Array.isArray(arr)) return [];
  return arr.slice(-max);
}

export function companyStateService(db: Db) {
  return {
    async read(companyId: string): Promise<CompanyStateRecord | null> {
      const row = await db
        .select()
        .from(companyState)
        .where(eq(companyState.companyId, companyId))
        .limit(1)
        .then((r) => r[0] ?? null);
      if (!row) return null;
      return {
        companyId: row.companyId,
        version: row.version,
        strategy: row.strategy ?? {},
        okrs: row.okrs ?? [],
        constraints: row.constraints ?? {},
        recentPivots: row.recentPivots ?? [],
        knownTruths: row.knownTruths ?? [],
        openDecisions: row.openDecisions ?? [],
        updatedByAgentId: row.updatedByAgentId,
        updatedAt: row.updatedAt,
      };
    },

    /**
     * Upsert company state. Merges the patch into existing state.
     * Caller (route handler or tool dispatcher) must check that
     * `updatedByAgentId` is a CEO-role agent before invoking.
     */
    async upsert(input: {
      companyId: string;
      updatedByAgentId: string | null;
      patch: CompanyStatePatch;
    }): Promise<CompanyStateRecord> {
      const now = new Date();
      const existing = await db
        .select()
        .from(companyState)
        .where(eq(companyState.companyId, input.companyId))
        .limit(1)
        .then((r) => r[0] ?? null);

      const merged = {
        strategy: { ...(existing?.strategy ?? {}), ...(input.patch.strategy ?? {}) },
        okrs: clip(input.patch.okrs ?? existing?.okrs ?? [], MAX_OKRS),
        constraints: {
          ...(existing?.constraints ?? {}),
          ...(input.patch.constraints ?? {}),
        },
        recentPivots: clip(
          input.patch.recentPivots ?? existing?.recentPivots ?? [],
          MAX_PIVOTS,
        ),
        knownTruths: clip(
          input.patch.knownTruths ?? existing?.knownTruths ?? [],
          MAX_TRUTHS,
        ),
        openDecisions: clip(
          input.patch.openDecisions ?? existing?.openDecisions ?? [],
          MAX_OPEN_DECISIONS,
        ),
      };

      if (existing) {
        const updated = await db
          .update(companyState)
          .set({
            version: existing.version + 1,
            strategy: merged.strategy,
            okrs: merged.okrs,
            constraints: merged.constraints,
            recentPivots: merged.recentPivots,
            knownTruths: merged.knownTruths,
            openDecisions: merged.openDecisions,
            updatedByAgentId: input.updatedByAgentId,
            updatedAt: now,
          })
          .where(eq(companyState.id, existing.id))
          .returning()
          .then((r) => r[0]);
        return toRecord(updated);
      }
      const inserted = await db
        .insert(companyState)
        .values({
          companyId: input.companyId,
          version: 1,
          strategy: merged.strategy,
          okrs: merged.okrs,
          constraints: merged.constraints,
          recentPivots: merged.recentPivots,
          knownTruths: merged.knownTruths,
          openDecisions: merged.openDecisions,
          updatedByAgentId: input.updatedByAgentId,
        })
        .returning()
        .then((r) => r[0]);
      return toRecord(inserted);
    },
  };
}

function toRecord(row: {
  companyId: string;
  version: number;
  strategy: StrategyBlock | null;
  okrs: OkrEntry[] | null;
  constraints: ConstraintsBlock | null;
  recentPivots: PivotEntry[] | null;
  knownTruths: TruthEntry[] | null;
  openDecisions: OpenDecisionEntry[] | null;
  updatedByAgentId: string | null;
  updatedAt: Date;
}): CompanyStateRecord {
  return {
    companyId: row.companyId,
    version: row.version,
    strategy: row.strategy ?? {},
    okrs: row.okrs ?? [],
    constraints: row.constraints ?? {},
    recentPivots: row.recentPivots ?? [],
    knownTruths: row.knownTruths ?? [],
    openDecisions: row.openDecisions ?? [],
    updatedByAgentId: row.updatedByAgentId,
    updatedAt: row.updatedAt,
  };
}

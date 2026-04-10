// Integrations service — unified CRUD for external connectors.
//
// One `integration_accounts` row per (company, provider, label). The
// sensitive credential blob is stored JSON-stringified in a
// `company_secrets` row (local AES-256-GCM encrypted via secretService).
//
// Providers supported at launch (all go through the same shape):
//   google_ads | facebook_ads | x | reddit | tiktok_ads |
//   github | wordpress | make_ugc | sfmc | firebase
//
// Per-agent scoping lives in `integration_bindings`. When an agent
// calls a provider tool, the route looks up the binding for
// (agentId, provider) and resolves to a specific account; if the agent
// has no explicit binding, the route falls back to the first
// company-wide account for that provider.

import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  integrationAccounts,
  integrationBindings,
  integrationRequests,
  type IntegrationAccount,
  type IntegrationRequest,
} from "@paperclipai/db";
import { secretService } from "./secrets.js";
import { notFound, unprocessable } from "../errors.js";

export const SUPPORTED_PROVIDERS = [
  "google_ads",
  "facebook_ads",
  "x",
  "reddit",
  "tiktok_ads",
  "github",
  "wordpress",
  "make_ugc",
  "sfmc",
  "firebase",
] as const;

export type IntegrationProvider = (typeof SUPPORTED_PROVIDERS)[number];

export function isSupportedProvider(v: unknown): v is IntegrationProvider {
  return typeof v === "string" && (SUPPORTED_PROVIDERS as readonly string[]).includes(v);
}

export interface ProviderCredentials {
  [key: string]: unknown;
}

export interface CreateIntegrationInput {
  provider: IntegrationProvider;
  label: string;
  credentials: ProviderCredentials;
  metadata?: Record<string, unknown>;
}

// Public account shape — never includes credentials. Use
// `resolveCredentials` (server-side only) to get the decrypted blob.
export interface PublicIntegrationAccount {
  id: string;
  provider: IntegrationProvider;
  label: string;
  status: string;
  metadata: Record<string, unknown>;
  hasCredential: boolean;
  lastVerifiedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

function toPublic(row: IntegrationAccount): PublicIntegrationAccount {
  return {
    id: row.id,
    provider: row.provider as IntegrationProvider,
    label: row.label,
    status: row.status,
    metadata: (row.metadataJson ?? {}) as Record<string, unknown>,
    hasCredential: !!row.credentialSecretId,
    lastVerifiedAt: row.lastVerifiedAt ? row.lastVerifiedAt.toISOString() : null,
    lastError: row.lastError,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function credentialSecretName(provider: string, label: string): string {
  // Secret names are unique per (company, name). Make them predictable
  // and human-readable so operators can find them in the secrets UI.
  const safeLabel = label.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 40);
  return `integration:${provider}:${safeLabel}`;
}

export function integrationService(db: Db) {
  const secrets = secretService(db);

  async function list(companyId: string): Promise<PublicIntegrationAccount[]> {
    const rows = await db
      .select()
      .from(integrationAccounts)
      .where(eq(integrationAccounts.companyId, companyId));
    return rows.map(toPublic);
  }

  async function getById(
    companyId: string,
    id: string,
  ): Promise<IntegrationAccount | null> {
    const [row] = await db
      .select()
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.id, id),
          eq(integrationAccounts.companyId, companyId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async function create(
    companyId: string,
    input: CreateIntegrationInput,
    actor?: { userId?: string | null; agentId?: string | null },
  ): Promise<PublicIntegrationAccount> {
    if (!isSupportedProvider(input.provider)) {
      throw unprocessable(`Unsupported provider: ${input.provider}`);
    }
    if (!input.label || !input.label.trim()) {
      throw unprocessable("label is required");
    }
    if (!input.credentials || typeof input.credentials !== "object") {
      throw unprocessable("credentials must be an object");
    }

    // Dedupe by (company, provider, label). If an account already
    // exists, rotate its credential instead of creating a new row.
    const [existing] = await db
      .select()
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.companyId, companyId),
          eq(integrationAccounts.provider, input.provider),
          eq(integrationAccounts.label, input.label.trim()),
        ),
      )
      .limit(1);

    const secretName = credentialSecretName(input.provider, input.label.trim());
    const credentialValue = JSON.stringify(input.credentials);

    let credentialSecretId: string;
    if (existing && existing.credentialSecretId) {
      // Rotate the existing secret in place.
      await secrets.rotate(
        existing.credentialSecretId,
        { value: credentialValue },
        actor,
      );
      credentialSecretId = existing.credentialSecretId;
    } else {
      // Fresh create. secretService.create throws on conflict, so we
      // catch conflicts and fall back to rotate (handles orphaned
      // secrets from a previously-deleted integration row).
      try {
        const secret = await secrets.create(
          companyId,
          {
            name: secretName,
            provider: "local_encrypted",
            value: credentialValue,
            description: `Credential for integration ${input.provider}:${input.label}`,
          },
          actor,
        );
        credentialSecretId = secret.id;
      } catch (err) {
        // If the secret name already exists (orphan from a prior
        // integration_accounts row), rotate it instead.
        const byName = await secrets.getByName(companyId, secretName);
        if (!byName) throw err;
        await secrets.rotate(
          byName.id,
          { value: credentialValue },
          actor,
        );
        credentialSecretId = byName.id;
      }
    }

    if (existing) {
      const [updated] = await db
        .update(integrationAccounts)
        .set({
          credentialSecretId,
          metadataJson: input.metadata ?? existing.metadataJson ?? {},
          status: "connected",
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(integrationAccounts.id, existing.id))
        .returning();
      await autoFulfillRequestsForProvider(companyId, input.provider);
      return toPublic(updated);
    }

    const [inserted] = await db
      .insert(integrationAccounts)
      .values({
        companyId,
        provider: input.provider,
        label: input.label.trim(),
        status: "connected",
        credentialSecretId,
        metadataJson: input.metadata ?? {},
      })
      .returning();
    await autoFulfillRequestsForProvider(companyId, input.provider);
    return toPublic(inserted);
  }

  async function remove(companyId: string, id: string): Promise<void> {
    const row = await getById(companyId, id);
    if (!row) throw notFound("Integration not found");
    // Cascade handles bindings; we leave the secret in place (operator
    // can clean up in the Secrets UI if desired).
    await db.delete(integrationAccounts).where(eq(integrationAccounts.id, id));
  }

  async function resolveCredentials(
    companyId: string,
    accountId: string,
  ): Promise<{ account: IntegrationAccount; credentials: ProviderCredentials }> {
    const row = await getById(companyId, accountId);
    if (!row) throw notFound("Integration not found");
    if (!row.credentialSecretId) {
      throw unprocessable("Integration has no credential stored");
    }
    const raw = await secrets.resolveSecretValue(companyId, row.credentialSecretId, "latest");
    let parsed: ProviderCredentials;
    try {
      parsed = JSON.parse(raw) as ProviderCredentials;
    } catch {
      throw unprocessable("Credential blob is not valid JSON");
    }
    return { account: row, credentials: parsed };
  }

  // Find the integration account an agent should use for a given
  // provider. Priority:
  //   1. Explicit binding (agent_id, account.provider == provider)
  //   2. First company-wide account for that provider
  // Returns null if nothing is connected.
  async function resolveForAgent(
    companyId: string,
    agentId: string,
    provider: IntegrationProvider,
  ): Promise<IntegrationAccount | null> {
    // 1. Explicit binding
    const bound = await db
      .select({ account: integrationAccounts })
      .from(integrationBindings)
      .innerJoin(
        integrationAccounts,
        eq(integrationBindings.accountId, integrationAccounts.id),
      )
      .where(
        and(
          eq(integrationBindings.agentId, agentId),
          eq(integrationAccounts.provider, provider),
          eq(integrationAccounts.companyId, companyId),
        ),
      )
      .limit(1);
    if (bound[0]) return bound[0].account;

    // 2. Fall back to company-wide
    const [anyForCompany] = await db
      .select()
      .from(integrationAccounts)
      .where(
        and(
          eq(integrationAccounts.companyId, companyId),
          eq(integrationAccounts.provider, provider),
          eq(integrationAccounts.status, "connected"),
        ),
      )
      .limit(1);
    return anyForCompany ?? null;
  }

  async function bindAgent(
    companyId: string,
    agentId: string,
    accountId: string,
  ): Promise<void> {
    const account = await getById(companyId, accountId);
    if (!account) throw notFound("Integration not found");
    await db
      .insert(integrationBindings)
      .values({ agentId, accountId })
      .onConflictDoNothing();
  }

  async function unbindAgent(
    companyId: string,
    agentId: string,
    accountId: string,
  ): Promise<void> {
    const account = await getById(companyId, accountId);
    if (!account) throw notFound("Integration not found");
    await db
      .delete(integrationBindings)
      .where(
        and(
          eq(integrationBindings.agentId, agentId),
          eq(integrationBindings.accountId, accountId),
        ),
      );
  }

  async function listBindingsForAgent(
    companyId: string,
    agentId: string,
  ): Promise<PublicIntegrationAccount[]> {
    const rows = await db
      .select({ account: integrationAccounts })
      .from(integrationBindings)
      .innerJoin(
        integrationAccounts,
        eq(integrationBindings.accountId, integrationAccounts.id),
      )
      .where(
        and(
          eq(integrationBindings.agentId, agentId),
          eq(integrationAccounts.companyId, companyId),
        ),
      );
    return rows.map((r) => toPublic(r.account));
  }

  async function listAgentsForAccount(
    companyId: string,
    accountId: string,
  ): Promise<string[]> {
    const account = await getById(companyId, accountId);
    if (!account) return [];
    const rows = await db
      .select({ agentId: integrationBindings.agentId })
      .from(integrationBindings)
      .where(eq(integrationBindings.accountId, accountId));
    return rows.map((r) => r.agentId);
  }

  async function markError(
    companyId: string,
    accountId: string,
    error: string,
  ): Promise<void> {
    await db
      .update(integrationAccounts)
      .set({ status: "error", lastError: error, updatedAt: new Date() })
      .where(
        and(
          eq(integrationAccounts.id, accountId),
          eq(integrationAccounts.companyId, companyId),
        ),
      );
  }

  async function markVerified(companyId: string, accountId: string): Promise<void> {
    await db
      .update(integrationAccounts)
      .set({
        status: "connected",
        lastVerifiedAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationAccounts.id, accountId),
          eq(integrationAccounts.companyId, companyId),
        ),
      );
  }

  // ----- Integration requests -----

  async function requestIntegration(
    companyId: string,
    agentId: string,
    provider: string,
    reason: string,
  ): Promise<IntegrationRequest> {
    if (!isSupportedProvider(provider)) {
      throw unprocessable(
        `Unsupported provider: ${provider}. Valid: ${SUPPORTED_PROVIDERS.join(", ")}`,
      );
    }
    const trimmed = (reason ?? "").trim();
    if (!trimmed) {
      throw unprocessable("reason is required — tell the operator why this integration is needed");
    }
    // Dedupe: if there's already a pending request from the same agent
    // for the same provider, return it instead of inserting a duplicate.
    const [existing] = await db
      .select()
      .from(integrationRequests)
      .where(
        and(
          eq(integrationRequests.companyId, companyId),
          eq(integrationRequests.agentId, agentId),
          eq(integrationRequests.provider, provider),
          eq(integrationRequests.status, "pending"),
        ),
      )
      .limit(1);
    if (existing) return existing;
    const [inserted] = await db
      .insert(integrationRequests)
      .values({ companyId, agentId, provider, reason: trimmed })
      .returning();
    return inserted;
  }

  async function listRequests(
    companyId: string,
    status?: "pending" | "fulfilled" | "declined",
  ): Promise<IntegrationRequest[]> {
    const where = status
      ? and(eq(integrationRequests.companyId, companyId), eq(integrationRequests.status, status))
      : eq(integrationRequests.companyId, companyId);
    return db
      .select()
      .from(integrationRequests)
      .where(where)
      .orderBy(desc(integrationRequests.createdAt));
  }

  async function resolveRequest(
    companyId: string,
    requestId: string,
    status: "fulfilled" | "declined",
    resolvedBy?: string | null,
  ): Promise<void> {
    await db
      .update(integrationRequests)
      .set({ status, resolvedAt: new Date(), resolvedBy: resolvedBy ?? null })
      .where(
        and(
          eq(integrationRequests.id, requestId),
          eq(integrationRequests.companyId, companyId),
        ),
      );
  }

  // When an operator successfully creates an account for a provider,
  // auto-fulfill any pending requests for that provider from any agent
  // in the company. Called from create().
  async function autoFulfillRequestsForProvider(
    companyId: string,
    provider: string,
  ): Promise<void> {
    await db
      .update(integrationRequests)
      .set({ status: "fulfilled", resolvedAt: new Date() })
      .where(
        and(
          eq(integrationRequests.companyId, companyId),
          eq(integrationRequests.provider, provider),
          eq(integrationRequests.status, "pending"),
        ),
      );
  }

  return {
    list,
    getById,
    create,
    remove,
    resolveCredentials,
    resolveForAgent,
    bindAgent,
    unbindAgent,
    listBindingsForAgent,
    listAgentsForAccount,
    markError,
    markVerified,
    requestIntegration,
    listRequests,
    resolveRequest,
    autoFulfillRequestsForProvider,
  };
}

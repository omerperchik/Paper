// Client for /companies/:id/integrations.
//
// Matches the server surface in server/src/routes/integrations.ts and the
// catalog in server/src/services/integration-providers/catalog.ts.

import { api } from "./client";

export type IntegrationFieldKind = "text" | "password" | "url" | "textarea" | "select";

export interface IntegrationProviderField {
  key: string;
  label: string;
  kind: IntegrationFieldKind;
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface IntegrationProviderDescriptor {
  provider: string;
  name: string;
  category: "ads" | "social" | "dev" | "cms" | "content" | "email" | "messaging";
  description: string;
  authHint: string;
  docsUrl: string;
  defaultRoles: string[];
  credentialFields: IntegrationProviderField[];
  metadataFields: IntegrationProviderField[];
  tools: string[];
}

export interface IntegrationAccountDto {
  id: string;
  provider: string;
  label: string;
  status: string;
  metadata: Record<string, unknown>;
  hasCredential: boolean;
  lastVerifiedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  boundAgentIds: string[];
}

export interface CreateIntegrationBody {
  provider: string;
  label: string;
  credentials: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export const integrationsApi = {
  providers: (companyId: string) =>
    api.get<IntegrationProviderDescriptor[]>(
      `/companies/${companyId}/integrations/providers`,
    ),
  list: (companyId: string) =>
    api.get<IntegrationAccountDto[]>(`/companies/${companyId}/integrations`),
  create: (companyId: string, body: CreateIntegrationBody) =>
    api.post<IntegrationAccountDto>(`/companies/${companyId}/integrations`, body),
  remove: (companyId: string, id: string) =>
    api.delete<void>(`/companies/${companyId}/integrations/${id}`),
  bindAgent: (companyId: string, accountId: string, agentId: string) =>
    api.post<void>(
      `/companies/${companyId}/integrations/${accountId}/bindings`,
      { agentId },
    ),
  unbindAgent: (companyId: string, accountId: string, agentId: string) =>
    api.delete<void>(
      `/companies/${companyId}/integrations/${accountId}/bindings/${agentId}`,
    ),
  listForAgent: (companyId: string, agentId: string) =>
    api.get<IntegrationAccountDto[]>(
      `/companies/${companyId}/agents/${agentId}/integrations`,
    ),
};

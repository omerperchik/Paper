// Integrations UI — paste-token form driven by PROVIDER_CATALOG.
//
// Renders a grid of provider cards. Each card shows connection status and
// (if connected) lastError + bound agents. Clicking a card opens a modal
// with dynamic credential + metadata fields. Create, rotate (reuse label),
// disconnect, and per-agent binding are all exposed.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Plug, CheckCircle2, AlertCircle, Trash2, Link2, MessageSquare, X } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { agentsApi } from "../api/agents";
import {
  integrationsApi,
  type IntegrationProviderDescriptor,
  type IntegrationProviderField,
  type IntegrationAccountDto,
  type IntegrationRequestDto,
} from "../api/integrations";

interface Props {
  companyId: string;
}

export function IntegrationsSection({ companyId }: Props) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const providersQuery = useQuery({
    queryKey: ["integrations", "providers", companyId],
    queryFn: () => integrationsApi.providers(companyId),
  });
  const accountsQuery = useQuery({
    queryKey: ["integrations", "list", companyId],
    queryFn: () => integrationsApi.list(companyId),
  });
  const agentsQuery = useQuery({
    queryKey: ["integrations", "agents", companyId],
    queryFn: () => agentsApi.list(companyId),
  });
  const requestsQuery = useQuery({
    queryKey: ["integrations", "requests", companyId],
    queryFn: () => integrationsApi.listRequests(companyId, "pending"),
    refetchInterval: 30_000,
  });

  const [openProvider, setOpenProvider] = useState<IntegrationProviderDescriptor | null>(
    null,
  );
  const [editingAccount, setEditingAccount] = useState<IntegrationAccountDto | null>(
    null,
  );

  const byProvider = useMemo(() => {
    const map = new Map<string, IntegrationAccountDto[]>();
    for (const a of accountsQuery.data ?? []) {
      const arr = map.get(a.provider) ?? [];
      arr.push(a);
      map.set(a.provider, arr);
    }
    return map;
  }, [accountsQuery.data]);

  const createMutation = useMutation({
    mutationFn: (body: {
      provider: string;
      label: string;
      credentials: Record<string, unknown>;
      metadata: Record<string, unknown>;
    }) => integrationsApi.create(companyId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations", "list", companyId] });
      pushToast({ title: "Integration saved", tone: "success" });
      setOpenProvider(null);
      setEditingAccount(null);
    },
    onError: (err: unknown) => {
      pushToast({
        title: "Failed to save integration",
        body: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (accountId: string) => integrationsApi.remove(companyId, accountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations", "list", companyId] });
      pushToast({ title: "Integration disconnected", tone: "success" });
    },
  });

  const bindMutation = useMutation({
    mutationFn: ({ accountId, agentId }: { accountId: string; agentId: string }) =>
      integrationsApi.bindAgent(companyId, accountId, agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations", "list", companyId] });
    },
  });

  const unbindMutation = useMutation({
    mutationFn: ({ accountId, agentId }: { accountId: string; agentId: string }) =>
      integrationsApi.unbindAgent(companyId, accountId, agentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations", "list", companyId] });
    },
  });

  const declineRequestMutation = useMutation({
    mutationFn: (requestId: string) =>
      integrationsApi.resolveRequest(companyId, requestId, "declined"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["integrations", "requests", companyId] });
      pushToast({ title: "Request declined", tone: "success" });
    },
    onError: (err: unknown) => {
      pushToast({
        title: "Failed to decline request",
        body: err instanceof Error ? err.message : String(err),
        tone: "error",
      });
    },
  });

  const providers = providersQuery.data ?? [];
  const agents = agentsQuery.data ?? [];
  const pendingRequests: IntegrationRequestDto[] = requestsQuery.data ?? [];

  return (
    <div className="space-y-4" data-testid="company-settings-integrations-section">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Integrations
      </div>

      {pendingRequests.length > 0 ? (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3 space-y-2"
          data-testid="integration-requests-banner"
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessageSquare className="h-4 w-4 text-amber-500" />
            Agent requests ({pendingRequests.length})
          </div>
          <div className="space-y-2">
            {pendingRequests.map((req) => {
              const agent = agents.find((a) => a.id === req.agentId);
              const descriptor = providers.find((p) => p.provider === req.provider);
              return (
                <div
                  key={req.id}
                  className="rounded border border-border/60 bg-background p-2.5 text-xs space-y-1"
                  data-testid={`integration-request-${req.id}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {agent?.name ?? req.agentId.slice(0, 8)} needs{" "}
                        <span className="font-mono">
                          {descriptor?.name ?? req.provider}
                        </span>
                      </div>
                      <div className="mt-0.5 text-muted-foreground whitespace-pre-wrap">
                        {req.reason}
                      </div>
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {new Date(req.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {descriptor ? (
                        <Button
                          size="sm"
                          variant="default"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            setEditingAccount(null);
                            setOpenProvider(descriptor);
                          }}
                        >
                          Connect now
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => declineRequestMutation.mutate(req.id)}
                        disabled={declineRequestMutation.isPending}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="rounded-md border border-border px-4 py-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          Connect external services so your agents can create campaigns, post content, open
          PRs, and send messages. Tokens are stored encrypted.
        </p>

        {providersQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading providers...</div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {providers.map((p) => {
              const accounts = byProvider.get(p.provider) ?? [];
              const connected = accounts.length > 0;
              return (
                <div
                  key={p.provider}
                  className="rounded-md border border-border p-3 flex flex-col gap-2"
                  data-testid={`integration-card-${p.provider}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Plug className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="font-medium text-sm truncate">{p.name}</div>
                        {connected ? (
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        ) : null}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                        {p.description}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={connected ? "outline" : "default"}
                      onClick={() => {
                        setEditingAccount(null);
                        setOpenProvider(p);
                      }}
                    >
                      {connected ? "Add another" : "Connect"}
                    </Button>
                  </div>

                  {accounts.map((acc) => (
                    <div
                      key={acc.id}
                      className="rounded border border-border/60 bg-muted/20 p-2 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-mono truncate">{acc.label}</span>
                          {acc.status === "error" ? (
                            <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
                          ) : acc.status === "connected" ? (
                            <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingAccount(acc);
                              setOpenProvider(p);
                            }}
                            className="h-6 px-2 text-xs"
                          >
                            Rotate
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (confirm(`Disconnect ${p.name} (${acc.label})?`)) {
                                removeMutation.mutate(acc.id);
                              }
                            }}
                            className="h-6 px-2 text-xs text-destructive"
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      {acc.lastError ? (
                        <div className="text-destructive">{acc.lastError}</div>
                      ) : null}
                      <AgentBindingPicker
                        account={acc}
                        agents={agents.map((a) => ({ id: a.id, name: a.name }))}
                        onBind={(agentId) =>
                          bindMutation.mutate({ accountId: acc.id, agentId })
                        }
                        onUnbind={(agentId) =>
                          unbindMutation.mutate({ accountId: acc.id, agentId })
                        }
                      />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {openProvider ? (
        <IntegrationFormModal
          provider={openProvider}
          existing={editingAccount}
          onClose={() => {
            setOpenProvider(null);
            setEditingAccount(null);
          }}
          onSubmit={(payload) => createMutation.mutate(payload)}
          submitting={createMutation.isPending}
        />
      ) : null}
    </div>
  );
}

function AgentBindingPicker({
  account,
  agents,
  onBind,
  onUnbind,
}: {
  account: IntegrationAccountDto;
  agents: Array<{ id: string; name: string }>;
  onBind: (agentId: string) => void;
  onUnbind: (agentId: string) => void;
}) {
  const bound = new Set(account.boundAgentIds);
  const [value, setValue] = useState("");

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Link2 className="h-3 w-3 text-muted-foreground shrink-0" />
      {account.boundAgentIds.length === 0 ? (
        <span className="text-muted-foreground">No agents bound (company-wide)</span>
      ) : (
        account.boundAgentIds.map((id) => {
          const a = agents.find((x) => x.id === id);
          return (
            <button
              key={id}
              type="button"
              onClick={() => onUnbind(id)}
              className="rounded bg-muted px-1.5 py-0.5 hover:bg-destructive/20"
              title="Click to unbind"
            >
              {a?.name ?? id.slice(0, 8)} ×
            </button>
          );
        })
      )}
      <select
        value={value}
        onChange={(e) => {
          const id = e.target.value;
          if (id && !bound.has(id)) {
            onBind(id);
          }
          setValue("");
        }}
        className="rounded border border-border bg-transparent px-1 py-0.5 text-xs"
      >
        <option value="">+ bind agent</option>
        {agents
          .filter((a) => !bound.has(a.id))
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
      </select>
    </div>
  );
}

function IntegrationFormModal({
  provider,
  existing,
  onClose,
  onSubmit,
  submitting,
}: {
  provider: IntegrationProviderDescriptor;
  existing: IntegrationAccountDto | null;
  onClose: () => void;
  onSubmit: (payload: {
    provider: string;
    label: string;
    credentials: Record<string, unknown>;
    metadata: Record<string, unknown>;
  }) => void;
  submitting: boolean;
}) {
  const [label, setLabel] = useState(existing?.label ?? "default");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [metadata, setMetadata] = useState<Record<string, string>>(() => {
    const meta = existing?.metadata ?? {};
    const out: Record<string, string> = {};
    for (const f of provider.metadataFields) {
      const v = meta[f.key];
      if (v != null) out[f.key] = String(v);
    }
    return out;
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const creds: Record<string, unknown> = {};
    for (const f of provider.credentialFields) {
      const v = credentials[f.key];
      if (v != null && v !== "") creds[f.key] = v;
      else if (f.required) {
        alert(`${f.label} is required`);
        return;
      }
    }
    const meta: Record<string, unknown> = {};
    for (const f of provider.metadataFields) {
      const v = metadata[f.key];
      if (v != null && v !== "") meta[f.key] = v;
      else if (f.required) {
        alert(`${f.label} is required`);
        return;
      }
    }
    onSubmit({
      provider: provider.provider,
      label: label.trim() || "default",
      credentials: creds,
      metadata: meta,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-background p-5 space-y-4"
      >
        <div>
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4" />
            <h2 className="text-base font-semibold">
              {existing ? "Rotate" : "Connect"} {provider.name}
            </h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{provider.description}</p>
        </div>

        <div className="rounded-md bg-muted/40 p-3 text-xs space-y-1">
          <div className="font-medium">Where to get credentials</div>
          <div className="text-muted-foreground whitespace-pre-wrap">{provider.authHint}</div>
          {provider.docsUrl ? (
            <a
              href={provider.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline underline-offset-4"
            >
              Open docs
            </a>
          ) : null}
        </div>

        <div className="space-y-3">
          <label className="block">
            <div className="text-xs font-medium mb-1">Label</div>
            <input
              type="text"
              value={label}
              disabled={!!existing}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. 'production' or 'client-acme'"
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none disabled:opacity-60"
            />
            <div className="text-[11px] text-muted-foreground mt-0.5">
              Short name to identify this connection. You can have multiple labels per provider.
            </div>
          </label>

          {provider.credentialFields.length > 0 ? (
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Credentials
              </div>
              <div className="space-y-2">
                {provider.credentialFields.map((f) => (
                  <FieldInput
                    key={f.key}
                    field={f}
                    value={credentials[f.key] ?? ""}
                    onChange={(v) => setCredentials((c) => ({ ...c, [f.key]: v }))}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {provider.metadataFields.length > 0 ? (
            <div>
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-1">
                Settings
              </div>
              <div className="space-y-2">
                {provider.metadataFields.map((f) => (
                  <FieldInput
                    key={f.key}
                    field={f}
                    value={metadata[f.key] ?? ""}
                    onChange={(v) => setMetadata((m) => ({ ...m, [f.key]: v }))}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting ? "Saving..." : existing ? "Rotate" : "Connect"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: IntegrationProviderField;
  value: string;
  onChange: (v: string) => void;
}) {
  const common = "w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none font-mono";
  return (
    <label className="block">
      <div className="text-xs font-medium mb-0.5">
        {field.label}
        {field.required ? <span className="text-destructive"> *</span> : null}
      </div>
      {field.kind === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          rows={5}
          className={common}
        />
      ) : field.kind === "select" && field.options ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={common}
        >
          <option value="">-- select --</option>
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={field.kind === "password" ? "password" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          className={common}
          autoComplete="off"
          spellCheck={false}
        />
      )}
      {field.help ? (
        <div className="text-[11px] text-muted-foreground mt-0.5">{field.help}</div>
      ) : null}
    </label>
  );
}

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Building2, Globe, Palette, CreditCard, Save } from "lucide-react";

interface TenantBrandConfig {
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
}

interface TenantCompany {
  companyId: string;
  clientName: string;
  addedAt: string;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  domain?: string;
  brandConfig: TenantBrandConfig;
  companies: TenantCompany[];
}

async function fetchTenants(): Promise<Tenant[]> {
  const res = await fetch("/api/tenants");
  if (!res.ok) throw new Error("Failed to fetch tenants");
  return res.json();
}

export function TenantSettings() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Form state
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [domain, setDomain] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#6366f1");
  const [accentColor, setAccentColor] = useState("#8b5cf6");

  useEffect(() => {
    setBreadcrumbs([{ label: "Agency Settings" }]);
  }, [setBreadcrumbs]);

  const { data: tenants, isLoading } = useQuery({
    queryKey: ["tenants"],
    queryFn: fetchTenants,
  });

  // Auto-select first tenant and populate form
  useEffect(() => {
    if (tenants && tenants.length > 0 && !selectedTenantId) {
      setSelectedTenantId(tenants[0].id);
    }
  }, [tenants, selectedTenantId]);

  const selectedTenant = tenants?.find((t) => t.id === selectedTenantId);

  useEffect(() => {
    if (selectedTenant) {
      setName(selectedTenant.name);
      setSlug(selectedTenant.slug);
      setDomain(selectedTenant.domain ?? "");
      setLogoUrl(selectedTenant.brandConfig.logoUrl ?? "");
      setPrimaryColor(selectedTenant.brandConfig.primaryColor ?? "#6366f1");
      setAccentColor(selectedTenant.brandConfig.accentColor ?? "#8b5cf6");
    }
  }, [selectedTenant]);

  const handleSave = async () => {
    if (!selectedTenantId) return;
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`/api/tenants/${selectedTenantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          slug,
          domain: domain || undefined,
          brandConfig: {
            logoUrl: logoUrl || undefined,
            primaryColor,
            accentColor,
          },
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // handle error
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 rounded bg-muted/50" />
        <div className="h-64 rounded-lg bg-muted/30" />
      </div>
    );
  }

  if (!tenants || tenants.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Building2 className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h2 className="text-lg font-semibold">No tenants configured</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Create a tenant first from the Agency Dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-8">
      {/* Tenant selector */}
      {tenants.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Tenant:</span>
          <select
            value={selectedTenantId ?? ""}
            onChange={(e) => setSelectedTenantId(e.target.value)}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm"
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* General Settings */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">General</h3>
        </div>
        <div className="space-y-4 rounded-lg border border-border bg-card p-5">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Tenant Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Slug</label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary font-mono"
            />
          </div>
        </div>
      </section>

      {/* Custom Domain */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Globe className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Custom Domain</h3>
        </div>
        <div className="rounded-lg border border-border bg-card p-5">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Domain</label>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="app.youragency.com"
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <p className="text-xs text-muted-foreground/70 mt-1.5">
              Point a CNAME record to your Paperclip instance to use a custom domain.
            </p>
          </div>
        </div>
      </section>

      {/* Brand Config */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Palette className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Brand Config</h3>
        </div>
        <div className="space-y-4 rounded-lg border border-border bg-card p-5">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">Logo URL</label>
            <input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Primary Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="h-8 w-8 rounded border border-border cursor-pointer"
                />
                <input
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  className="flex-1 rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary font-mono"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">Accent Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="h-8 w-8 rounded border border-border cursor-pointer"
                />
                <input
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="flex-1 rounded-md border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary font-mono"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Billing (placeholder) */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Billing</h3>
        </div>
        <div className="rounded-lg border border-dashed border-border bg-card/50 p-8 text-center">
          <CreditCard className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Billing settings coming soon.</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Configure per-client billing, invoicing, and payment collection.
          </p>
        </div>
      </section>

      {/* Client List */}
      <section>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
          Clients ({selectedTenant?.companies.length ?? 0})
        </h3>
        {selectedTenant && selectedTenant.companies.length > 0 ? (
          <div className="rounded-lg border border-border overflow-hidden">
            {selectedTenant.companies.map((company, idx) => (
              <div
                key={company.companyId}
                className={`flex items-center justify-between px-4 py-3 text-sm ${idx > 0 ? "border-t border-border" : ""}`}
              >
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-muted/50 flex items-center justify-center">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium">{company.clientName}</p>
                    <p className="text-xs text-muted-foreground font-mono">{company.companyId.slice(0, 8)}</p>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">
                  Added {new Date(company.addedAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">No clients associated with this tenant.</p>
          </div>
        )}
      </section>

      {/* Save Button */}
      <div className="flex items-center gap-3 pt-2 pb-8">
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : "Save Changes"}
        </button>
        {saved && (
          <span className="text-sm text-emerald-400">Saved successfully</span>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { MetricCard } from "../components/MetricCard";
import { TenantClientCard } from "../components/TenantClientCard";
import { Building2, Users, DollarSign, TrendingUp, Target, Plus } from "lucide-react";

interface TenantCompany {
  companyId: string;
  clientName: string;
  addedAt: string;
}

interface TenantDashboardData {
  totalClients: number;
  totalSpendCents: number;
  totalRevenueCents: number;
  averageCacCents: number;
  activeClients: number;
  pausedClients: number;
}

interface Tenant {
  id: string;
  name: string;
  slug: string;
  companies: TenantCompany[];
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

async function fetchTenants(): Promise<Tenant[]> {
  const res = await fetch("/api/tenants");
  if (!res.ok) throw new Error("Failed to fetch tenants");
  return res.json();
}

async function fetchDashboard(tenantId: string): Promise<TenantDashboardData> {
  const res = await fetch(`/api/tenants/${tenantId}/dashboard`);
  if (!res.ok) throw new Error("Failed to fetch dashboard");
  return res.json();
}

export function TenantDashboard() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");

  useEffect(() => {
    setBreadcrumbs([{ label: "Agency Dashboard" }]);
  }, [setBreadcrumbs]);

  const { data: tenants, isLoading: tenantsLoading } = useQuery({
    queryKey: ["tenants"],
    queryFn: fetchTenants,
  });

  // Auto-select first tenant
  useEffect(() => {
    if (tenants && tenants.length > 0 && !selectedTenantId) {
      setSelectedTenantId(tenants[0].id);
    }
  }, [tenants, selectedTenantId]);

  const selectedTenant = tenants?.find((t) => t.id === selectedTenantId);

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ["tenant-dashboard", selectedTenantId],
    queryFn: () => fetchDashboard(selectedTenantId!),
    enabled: !!selectedTenantId,
  });

  const handleAddClient = async () => {
    if (!selectedTenantId || !newClientName.trim()) return;
    try {
      await fetch(`/api/tenants/${selectedTenantId}/companies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: crypto.randomUUID(), clientName: newClientName.trim() }),
      });
      setNewClientName("");
      setShowAddClient(false);
      // Refetch would happen via query invalidation in production
      window.location.reload();
    } catch {
      // handle error
    }
  };

  const handleRemoveClient = async (companyId: string) => {
    if (!selectedTenantId) return;
    try {
      await fetch(`/api/tenants/${selectedTenantId}/companies/${companyId}`, {
        method: "DELETE",
      });
      window.location.reload();
    } catch {
      // handle error
    }
  };

  if (tenantsLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 rounded bg-muted/50" />
        <div className="grid grid-cols-4 gap-2">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-24 rounded-lg bg-muted/30" />)}
        </div>
      </div>
    );
  }

  if (!tenants || tenants.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Building2 className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h2 className="text-lg font-semibold">No tenants configured</h2>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Create your first tenant to start managing multiple clients from a single dashboard.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Tenant selector (if multiple) */}
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

      {/* Aggregate Metrics */}
      {dashboard && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-1 sm:gap-2">
          <MetricCard
            icon={Users}
            value={dashboard.totalClients}
            label="Total Clients"
            description={
              <span>{dashboard.activeClients} active, {dashboard.pausedClients} paused</span>
            }
          />
          <MetricCard
            icon={DollarSign}
            value={formatCents(dashboard.totalSpendCents)}
            label="Total Spend"
            description={<span>Across all clients this month</span>}
          />
          <MetricCard
            icon={TrendingUp}
            value={formatCents(dashboard.totalRevenueCents)}
            label="Total Revenue"
            description={<span>Attributed revenue this month</span>}
          />
          <MetricCard
            icon={Target}
            value={formatCents(dashboard.averageCacCents)}
            label="Average CAC"
            description={<span>Across all client accounts</span>}
          />
        </div>
      )}

      {/* Client Cards */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Clients
          </h3>
          <button
            onClick={() => setShowAddClient(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Client
          </button>
        </div>

        {/* Add client inline form */}
        {showAddClient && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-card p-3">
            <input
              autoFocus
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              placeholder="Client name..."
              className="flex-1 rounded-md border border-border bg-transparent px-3 py-1.5 text-sm outline-none focus:border-primary"
              onKeyDown={(e) => e.key === "Enter" && handleAddClient()}
            />
            <button
              onClick={handleAddClient}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Add
            </button>
            <button
              onClick={() => { setShowAddClient(false); setNewClientName(""); }}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        )}

        {selectedTenant && selectedTenant.companies.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
            <Building2 className="h-8 w-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No clients yet. Add your first client above.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {selectedTenant?.companies.map((company) => (
              <TenantClientCard
                key={company.companyId}
                clientName={company.clientName}
                companyId={company.companyId}
                onRemove={() => handleRemoveClient(company.companyId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

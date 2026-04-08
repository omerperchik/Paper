import { randomUUID } from "node:crypto";

export interface TenantBrandConfig {
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
}

export interface TenantCompany {
  companyId: string;
  clientName: string;
  addedAt: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  domain?: string;
  brandConfig: TenantBrandConfig;
  companies: TenantCompany[];
  createdAt: string;
  updatedAt: string;
}

// In-memory store (swap for DB-backed persistence when ready)
const tenants = new Map<string, Tenant>();

export function tenantService() {
  return {
    async create(
      name: string,
      slug: string,
      domain?: string,
      brandConfig?: TenantBrandConfig,
    ): Promise<Tenant> {
      const existing = Array.from(tenants.values()).find((t) => t.slug === slug);
      if (existing) {
        throw new Error(`Tenant with slug "${slug}" already exists`);
      }

      const tenant: Tenant = {
        id: randomUUID(),
        name,
        slug,
        domain,
        brandConfig: brandConfig ?? {},
        companies: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      tenants.set(tenant.id, tenant);
      return tenant;
    },

    async get(tenantId: string): Promise<Tenant | null> {
      return tenants.get(tenantId) ?? null;
    },

    async list(): Promise<Tenant[]> {
      return Array.from(tenants.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    },

    async update(
      tenantId: string,
      updates: Partial<Pick<Tenant, "name" | "slug" | "domain" | "brandConfig">>,
    ): Promise<Tenant> {
      const tenant = tenants.get(tenantId);
      if (!tenant) throw new Error("Tenant not found");

      if (updates.name !== undefined) tenant.name = updates.name;
      if (updates.slug !== undefined) tenant.slug = updates.slug;
      if (updates.domain !== undefined) tenant.domain = updates.domain;
      if (updates.brandConfig !== undefined) {
        tenant.brandConfig = { ...tenant.brandConfig, ...updates.brandConfig };
      }
      tenant.updatedAt = new Date().toISOString();
      return tenant;
    },

    async addCompany(tenantId: string, companyId: string, clientName: string): Promise<TenantCompany> {
      const tenant = tenants.get(tenantId);
      if (!tenant) throw new Error("Tenant not found");

      const exists = tenant.companies.find((c) => c.companyId === companyId);
      if (exists) throw new Error("Company already associated with this tenant");

      const entry: TenantCompany = {
        companyId,
        clientName,
        addedAt: new Date().toISOString(),
      };
      tenant.companies.push(entry);
      tenant.updatedAt = new Date().toISOString();
      return entry;
    },

    async removeCompany(tenantId: string, companyId: string): Promise<void> {
      const tenant = tenants.get(tenantId);
      if (!tenant) throw new Error("Tenant not found");

      const idx = tenant.companies.findIndex((c) => c.companyId === companyId);
      if (idx === -1) throw new Error("Company not associated with this tenant");

      tenant.companies.splice(idx, 1);
      tenant.updatedAt = new Date().toISOString();
    },

    async getCompanies(tenantId: string): Promise<TenantCompany[]> {
      const tenant = tenants.get(tenantId);
      if (!tenant) throw new Error("Tenant not found");
      return tenant.companies;
    },

    async getByDomain(domain: string): Promise<Tenant | null> {
      return Array.from(tenants.values()).find((t) => t.domain === domain) ?? null;
    },

    async getAggregateMetrics(tenantId: string): Promise<{
      totalClients: number;
      totalSpendCents: number;
      totalRevenueCents: number;
      averageCacCents: number;
      activeClients: number;
      pausedClients: number;
    }> {
      const tenant = tenants.get(tenantId);
      if (!tenant) throw new Error("Tenant not found");

      const totalClients = tenant.companies.length;

      // Simulated aggregate metrics — replace with real DB aggregation
      const totalSpendCents = totalClients * 125000; // $1,250 avg per client
      const totalRevenueCents = totalClients * 340000; // $3,400 avg per client
      const averageCacCents = totalClients > 0 ? Math.round(totalSpendCents / Math.max(totalClients, 1)) : 0;

      return {
        totalClients,
        totalSpendCents,
        totalRevenueCents,
        averageCacCents,
        activeClients: totalClients,
        pausedClients: 0,
      };
    },
  };
}

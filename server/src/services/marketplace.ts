import { randomUUID } from "node:crypto";
import { getMarketplaceSeeds } from "./marketplace-seeds.js";

export type MarketplaceCategory = "skill" | "template" | "integration" | "agent_template";

export interface MarketplaceItem {
  id: string;
  name: string;
  slug: string;
  category: MarketplaceCategory;
  author: string;
  description: string;
  longDescription?: string;
  version: string;
  changelog?: string;
  icon?: string;
  thumbnail?: string;
  rating: number;
  ratingCount: number;
  installCount: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MarketplaceInstallation {
  itemId: string;
  companyId: string;
  installedAt: string;
}

// In-memory stores
const items = new Map<string, MarketplaceItem>();
const installations: MarketplaceInstallation[] = [];
let seeded = false;

function ensureSeeded() {
  if (seeded) return;
  seeded = true;
  for (const item of getMarketplaceSeeds()) {
    items.set(item.id, item);
  }
}

export function marketplaceService() {
  ensureSeeded();

  return {
    async list(
      filters?: { category?: MarketplaceCategory },
      search?: string,
      page = 1,
      limit = 20,
    ): Promise<{ items: MarketplaceItem[]; total: number; page: number; limit: number }> {
      let results = Array.from(items.values());

      if (filters?.category) {
        results = results.filter((i) => i.category === filters.category);
      }

      if (search) {
        const q = search.toLowerCase();
        results = results.filter(
          (i) =>
            i.name.toLowerCase().includes(q) ||
            i.description.toLowerCase().includes(q) ||
            i.tags.some((t) => t.toLowerCase().includes(q)),
        );
      }

      results.sort((a, b) => b.installCount - a.installCount);

      const total = results.length;
      const offset = (page - 1) * limit;
      const paged = results.slice(offset, offset + limit);

      return { items: paged, total, page, limit };
    },

    async get(itemId: string): Promise<MarketplaceItem | null> {
      return items.get(itemId) ?? null;
    },

    async publish(item: Omit<MarketplaceItem, "id" | "rating" | "ratingCount" | "installCount" | "createdAt" | "updatedAt">): Promise<MarketplaceItem> {
      const entry: MarketplaceItem = {
        ...item,
        id: randomUUID(),
        rating: 0,
        ratingCount: 0,
        installCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      items.set(entry.id, entry);
      return entry;
    },

    async update(itemId: string, updates: Partial<Pick<MarketplaceItem, "name" | "description" | "longDescription" | "version" | "changelog" | "icon" | "thumbnail" | "tags">>): Promise<MarketplaceItem> {
      const item = items.get(itemId);
      if (!item) throw new Error("Marketplace item not found");

      Object.assign(item, updates, { updatedAt: new Date().toISOString() });
      return item;
    },

    async install(itemId: string, companyId: string): Promise<MarketplaceInstallation> {
      const item = items.get(itemId);
      if (!item) throw new Error("Marketplace item not found");

      const existing = installations.find((i) => i.itemId === itemId && i.companyId === companyId);
      if (existing) throw new Error("Already installed");

      item.installCount += 1;
      const installation: MarketplaceInstallation = {
        itemId,
        companyId,
        installedAt: new Date().toISOString(),
      };
      installations.push(installation);
      return installation;
    },

    async uninstall(itemId: string, companyId: string): Promise<void> {
      const idx = installations.findIndex((i) => i.itemId === itemId && i.companyId === companyId);
      if (idx === -1) throw new Error("Not installed");

      installations.splice(idx, 1);
      const item = items.get(itemId);
      if (item && item.installCount > 0) item.installCount -= 1;
    },

    async rate(itemId: string, rating: number): Promise<MarketplaceItem> {
      const item = items.get(itemId);
      if (!item) throw new Error("Marketplace item not found");
      if (rating < 1 || rating > 5) throw new Error("Rating must be between 1 and 5");

      const totalRating = item.rating * item.ratingCount + rating;
      item.ratingCount += 1;
      item.rating = Math.round((totalRating / item.ratingCount) * 10) / 10;
      item.updatedAt = new Date().toISOString();
      return item;
    },

    async getInstalled(companyId: string): Promise<MarketplaceItem[]> {
      const installedIds = installations
        .filter((i) => i.companyId === companyId)
        .map((i) => i.itemId);
      return installedIds.map((id) => items.get(id)).filter(Boolean) as MarketplaceItem[];
    },

    async search(query: string): Promise<MarketplaceItem[]> {
      const q = query.toLowerCase();
      return Array.from(items.values()).filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          i.author.toLowerCase().includes(q) ||
          i.tags.some((t) => t.toLowerCase().includes(q)),
      );
    },
  };
}

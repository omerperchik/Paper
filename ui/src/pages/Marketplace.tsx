import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { MarketplaceCard } from "../components/MarketplaceCard";
import { MarketplaceDetail } from "../components/MarketplaceDetail";
import { Search, Store } from "lucide-react";

type Category = "all" | "skill" | "template" | "integration" | "agent_template";

interface MarketplaceItem {
  id: string;
  name: string;
  slug: string;
  category: string;
  author: string;
  description: string;
  longDescription?: string;
  version: string;
  changelog?: string;
  icon?: string;
  rating: number;
  ratingCount: number;
  installCount: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

interface MarketplaceResponse {
  items: MarketplaceItem[];
  total: number;
  page: number;
  limit: number;
}

const categories: { key: Category; label: string }[] = [
  { key: "all", label: "All" },
  { key: "skill", label: "Skills" },
  { key: "template", label: "Templates" },
  { key: "integration", label: "Integrations" },
  { key: "agent_template", label: "Agent Templates" },
];

async function fetchMarketplace(category?: string, search?: string): Promise<MarketplaceResponse> {
  const params = new URLSearchParams();
  if (category && category !== "all") params.set("category", category);
  if (search) params.set("search", search);
  const res = await fetch(`/api/marketplace?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch marketplace");
  return res.json();
}

async function fetchInstalled(companyId: string): Promise<MarketplaceItem[]> {
  const res = await fetch(`/api/companies/${companyId}/marketplace/installed`);
  if (!res.ok) return [];
  return res.json();
}

export function Marketplace() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompanyId } = useCompany();
  const [activeCategory, setActiveCategory] = useState<Category>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedItem, setSelectedItem] = useState<MarketplaceItem | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Marketplace" }]);
  }, [setBreadcrumbs]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const { data, isLoading } = useQuery({
    queryKey: ["marketplace", activeCategory, debouncedSearch],
    queryFn: () => fetchMarketplace(activeCategory, debouncedSearch),
  });

  const { data: installed } = useQuery({
    queryKey: ["marketplace-installed", selectedCompanyId],
    queryFn: () => fetchInstalled(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const installedIds = new Set(installed?.map((i) => i.id) ?? []);

  const handleInstall = async (itemId: string) => {
    if (!selectedCompanyId) return;
    try {
      await fetch(`/api/marketplace/${itemId}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompanyId }),
      });
      window.location.reload();
    } catch {
      // handle error
    }
  };

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search skills, templates, integrations..."
          className="w-full rounded-lg border border-border bg-card pl-10 pr-4 py-2.5 text-sm outline-none focus:border-primary transition-colors"
        />
      </div>

      {/* Category Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {categories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(cat.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeCategory === cat.key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-48 rounded-lg bg-muted/30 animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && data && data.items.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Store className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold">No items found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            {debouncedSearch
              ? `No results for "${debouncedSearch}". Try a different search.`
              : "No marketplace items available in this category."}
          </p>
        </div>
      )}

      {/* Items Grid */}
      {data && data.items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.items.map((item) => (
            <MarketplaceCard
              key={item.id}
              id={item.id}
              name={item.name}
              author={item.author}
              description={item.description}
              icon={item.icon}
              category={item.category}
              rating={item.rating}
              ratingCount={item.ratingCount}
              installCount={item.installCount}
              installed={installedIds.has(item.id)}
              onInstall={() => handleInstall(item.id)}
              onClick={() => setSelectedItem(item)}
            />
          ))}
        </div>
      )}

      {/* Results count */}
      {data && data.total > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Showing {data.items.length} of {data.total} items
        </p>
      )}

      {/* Detail Modal */}
      {selectedItem && (
        <MarketplaceDetail
          item={selectedItem}
          installed={installedIds.has(selectedItem.id)}
          onInstall={() => handleInstall(selectedItem.id)}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </div>
  );
}

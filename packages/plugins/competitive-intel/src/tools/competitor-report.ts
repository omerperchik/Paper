// ---------------------------------------------------------------------------
// Competitor Report — Generate comprehensive competitive intelligence reports
// ---------------------------------------------------------------------------

import type {
  PluginContext,
  Competitor,
  WebsiteSnapshot,
  AdSnapshot,
  PriceChangeRecord,
} from "../types.js";
import { loadCompetitors, STATE_SCOPE } from "./competitor-tracker.js";

interface ReportSection {
  title: string;
  data: unknown;
}

async function buildOverviewSection(
  ctx: PluginContext,
  competitor: Competitor,
): Promise<ReportSection> {
  let latestSnapshot: WebsiteSnapshot | null = null;
  try {
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `snapshots:${competitor.id}` });
    if (raw) {
      const snapshots = JSON.parse(raw as string) as WebsiteSnapshot[];
      latestSnapshot = snapshots[snapshots.length - 1] ?? null;
    }
  } catch { /* no data */ }

  return {
    title: "Overview",
    data: {
      name: competitor.name,
      domain: competitor.domain,
      addedAt: competitor.addedAt,
      lastScannedAt: competitor.lastScannedAt ?? "never",
      notes: competitor.notes ?? "",
      techStack: latestSnapshot
        ? [...new Set(latestSnapshot.pages.flatMap((p) => p.techSignals))]
        : [],
      pagesCrawled: latestSnapshot?.pages.length ?? 0,
    },
  };
}

async function buildPricingSection(
  ctx: PluginContext,
  competitor: Competitor,
): Promise<ReportSection> {
  let currentPricing: unknown[] = [];
  let changeHistory: PriceChangeRecord[] = [];

  try {
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `snapshots:${competitor.id}` });
    if (raw) {
      const snapshots = JSON.parse(raw as string) as WebsiteSnapshot[];
      const latest = snapshots[snapshots.length - 1];
      if (latest) {
        currentPricing = latest.pages.flatMap((p) => p.pricingTiers);
      }
    }
  } catch { /* no data */ }

  try {
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `price-history:${competitor.id}` });
    if (raw) changeHistory = JSON.parse(raw as string) ?? [];
  } catch { /* no data */ }

  return {
    title: "Pricing",
    data: {
      currentTiers: currentPricing,
      recentChanges: changeHistory.slice(-5),
      totalChangesRecorded: changeHistory.length,
    },
  };
}

async function buildFeaturesSection(
  ctx: PluginContext,
  competitor: Competitor,
): Promise<ReportSection> {
  let features: string[] = [];
  let headings: string[] = [];

  try {
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `snapshots:${competitor.id}` });
    if (raw) {
      const snapshots = JSON.parse(raw as string) as WebsiteSnapshot[];
      const latest = snapshots[snapshots.length - 1];
      if (latest) {
        features = [...new Set(latest.pages.flatMap((p) => p.features))];
        headings = [...new Set(latest.pages.flatMap((p) => p.headings))];
      }
    }
  } catch { /* no data */ }

  return {
    title: "Features & Messaging",
    data: {
      features,
      keyHeadings: headings.slice(0, 20),
    },
  };
}

async function buildContentSection(
  ctx: PluginContext,
  competitor: Competitor,
): Promise<ReportSection> {
  let pageCount = 0;
  let pages: Array<{ url: string; title?: string }> = [];

  try {
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `snapshots:${competitor.id}` });
    if (raw) {
      const snapshots = JSON.parse(raw as string) as WebsiteSnapshot[];
      const latest = snapshots[snapshots.length - 1];
      if (latest) {
        pageCount = latest.pages.length;
        pages = latest.pages.map((p) => ({ url: p.url, title: p.title }));
      }
    }
  } catch { /* no data */ }

  return {
    title: "Content",
    data: { pageCount, pages },
  };
}

async function buildAdsSection(
  ctx: PluginContext,
  competitor: Competitor,
): Promise<ReportSection> {
  let latestAds: AdSnapshot | null = null;

  try {
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `ads:${competitor.id}` });
    if (raw) {
      const history = JSON.parse(raw as string) as AdSnapshot[];
      latestAds = history[history.length - 1] ?? null;
    }
  } catch { /* no data */ }

  return {
    title: "Advertising",
    data: latestAds
      ? {
          platform: latestAds.platform,
          scannedAt: latestAds.scannedAt,
          totalAds: latestAds.ads.length,
          activeAds: latestAds.ads.filter((a) => a.status === "active").length,
          sampleAds: latestAds.ads.slice(0, 5),
        }
      : { message: "No ad data collected yet. Run competitive_scan_ads first." },
  };
}

async function buildChangesSection(
  ctx: PluginContext,
  competitor: Competitor,
): Promise<ReportSection> {
  let snapshotCount = 0;
  let firstScan: string | undefined;
  let lastScan: string | undefined;

  try {
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `snapshots:${competitor.id}` });
    if (raw) {
      const snapshots = JSON.parse(raw as string) as WebsiteSnapshot[];
      snapshotCount = snapshots.length;
      if (snapshots.length > 0) {
        firstScan = snapshots[0].scannedAt;
        lastScan = snapshots[snapshots.length - 1].scannedAt;
      }
    }
  } catch { /* no data */ }

  let priceChanges = 0;
  try {
    const raw = await ctx.state.get({ ...STATE_SCOPE, stateKey: `price-history:${competitor.id}` });
    if (raw) {
      const history = JSON.parse(raw as string) as PriceChangeRecord[];
      priceChanges = history.length;
    }
  } catch { /* no data */ }

  return {
    title: "Change Tracking",
    data: {
      snapshotsCollected: snapshotCount,
      firstScan,
      lastScan,
      pricingChangesDetected: priceChanges,
    },
  };
}

const SECTION_BUILDERS: Record<string, (ctx: PluginContext, c: Competitor) => Promise<ReportSection>> = {
  overview: buildOverviewSection,
  pricing: buildPricingSection,
  features: buildFeaturesSection,
  content: buildContentSection,
  ads: buildAdsSection,
  changes: buildChangesSection,
};

// SEO section is an alias for content
SECTION_BUILDERS["seo"] = buildContentSection;

export function registerCompetitorReportTools(ctx: PluginContext) {

  ctx.tools.register("competitive_full_report", async ({ params }) => {
    const { competitorIds, sections } = params as {
      competitorIds?: string[];
      sections?: string[];
    };

    const allCompetitors = await loadCompetitors(ctx);

    if (allCompetitors.length === 0) {
      return { error: "No competitors tracked. Add competitors first with competitive_add_competitor." };
    }

    const targetCompetitors = competitorIds
      ? allCompetitors.filter((c) => competitorIds.includes(c.id))
      : allCompetitors;

    if (targetCompetitors.length === 0) {
      return { error: "No matching competitors found for the provided IDs." };
    }

    const sectionKeys = sections && sections.length > 0
      ? sections
      : Object.keys(SECTION_BUILDERS);

    ctx.logger.info("Generating competitive report", {
      competitors: targetCompetitors.length,
      sections: sectionKeys,
    });

    const reports = await Promise.all(
      targetCompetitors.map(async (competitor) => {
        const reportSections: ReportSection[] = [];

        for (const sectionKey of sectionKeys) {
          const builder = SECTION_BUILDERS[sectionKey];
          if (builder) {
            try {
              const section = await builder(ctx, competitor);
              reportSections.push(section);
            } catch (err) {
              ctx.logger.warn("Failed to build report section", {
                competitor: competitor.name,
                section: sectionKey,
                error: String(err),
              });
              reportSections.push({
                title: sectionKey,
                data: { error: `Failed to generate section: ${String(err)}` },
              });
            }
          }
        }

        return {
          competitorId: competitor.id,
          competitorName: competitor.name,
          domain: competitor.domain,
          generatedAt: new Date().toISOString(),
          sections: reportSections,
        };
      }),
    );

    ctx.logger.info("Competitive report generated", { competitorCount: reports.length });

    return {
      reports,
      generatedAt: new Date().toISOString(),
      competitorsIncluded: reports.length,
      sectionsIncluded: sectionKeys,
    };
  });
}

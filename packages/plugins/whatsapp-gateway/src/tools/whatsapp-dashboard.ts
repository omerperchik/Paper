// ---------------------------------------------------------------------------
// Agent Tool: whatsapp_send_dashboard
// Send a formatted KPI dashboard summary to the chairman.
// ---------------------------------------------------------------------------

import type { PluginContext, DashboardMetric, DashboardSection } from "../types.js";
import type { WhatsAppClient } from "../services/whatsapp-client.js";
import type { DashboardRenderer } from "../services/dashboard-renderer.js";

export function registerDashboardTool(
  ctx: PluginContext,
  waClient: WhatsAppClient,
  renderer: DashboardRenderer,
): void {
  ctx.tools.register("whatsapp_send_dashboard", async ({ params }) => {
    const {
      dashboardType = "daily",
      title,
      metrics,
      sections,
      summary,
    } = params as {
      dashboardType?: "daily" | "weekly" | "campaign" | "cac" | "custom";
      title?: string;
      metrics: DashboardMetric[];
      sections?: DashboardSection[];
      summary?: string;
    };

    if (!metrics || !Array.isArray(metrics) || metrics.length === 0) {
      return { error: "At least one metric is required" };
    }

    try {
      const chairmanPhone = await waClient.getChairmanPhone();

      // Build title from type if not provided
      const dashTitle =
        title ??
        {
          daily: "Daily Marketing Report",
          weekly: "Weekly Marketing Report",
          campaign: "Campaign Performance",
          cac: "CAC Dashboard",
          custom: "Dashboard Report",
        }[dashboardType] ??
        "Dashboard Report";

      const text = renderer.renderDashboard(dashTitle, metrics, sections, summary);
      const { messageId } = await waClient.sendText(chairmanPhone, text);

      ctx.logger.info("Dashboard sent via agent tool", {
        dashboardType,
        metricsCount: metrics.length,
        messageId,
      });

      return {
        sent: true,
        messageId,
        dashboardType,
        metricsCount: metrics.length,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      ctx.logger.error("whatsapp_send_dashboard failed", { error: errMsg });
      return { error: errMsg };
    }
  });
}

// ---------------------------------------------------------------------------
// Dashboard Renderer — format KPI data as clean text for WhatsApp messages
// ---------------------------------------------------------------------------

import type { DashboardMetric, DashboardSection } from "../types.js";

/** Status indicator emojis for metric changes. */
const STATUS_ICONS: Record<string, string> = {
  up: "^",
  down: "v",
  flat: "=",
  alert: "(!)",
};

export class DashboardRenderer {
  /**
   * Render a full dashboard message.
   * WhatsApp has a 4096-character limit per message, so we keep it concise.
   */
  renderDashboard(
    title: string,
    metrics: DashboardMetric[],
    sections?: DashboardSection[],
    summary?: string,
  ): string {
    const lines: string[] = [];

    // Title
    lines.push(`*${title}*`);
    lines.push(this.divider());

    // Key metrics
    if (metrics.length > 0) {
      for (const metric of metrics) {
        lines.push(this.renderMetric(metric));
      }
      lines.push("");
    }

    // Additional sections
    if (sections && sections.length > 0) {
      for (const section of sections) {
        lines.push(`*${section.heading}*`);
        for (const row of section.rows) {
          lines.push(`  ${row.label}: ${row.value}`);
        }
        lines.push("");
      }
    }

    // Summary
    if (summary) {
      lines.push(this.divider());
      lines.push(summary);
    }

    // Timestamp
    lines.push("");
    lines.push(`_${new Date().toISOString().replace("T", " ").substring(0, 19)} UTC_`);

    return this.truncate(lines.join("\n"));
  }

  /** Render a single metric line. */
  private renderMetric(metric: DashboardMetric): string {
    const icon = metric.status ? ` ${STATUS_ICONS[metric.status] ?? ""}` : "";
    const change = metric.change ? ` (${metric.change})` : "";
    return `${metric.label}: *${metric.value}*${change}${icon}`;
  }

  /** Render a quick status report. */
  renderStatusReport(data: {
    agentCount: number;
    activeTaskCount: number;
    pendingApprovals: number;
    todaySpend: string;
    topAlert?: string;
  }): string {
    const lines = [
      "*Status Report*",
      this.divider(),
      `Agents active: *${data.agentCount}*`,
      `Tasks in progress: *${data.activeTaskCount}*`,
      `Pending approvals: *${data.pendingApprovals}*`,
      `Today's spend: *${data.todaySpend}*`,
    ];

    if (data.topAlert) {
      lines.push("");
      lines.push(`(!) *Alert:* ${data.topAlert}`);
    }

    return lines.join("\n");
  }

  /** Render the help message showing available commands. */
  renderHelp(): string {
    return [
      "*Available Commands*",
      this.divider(),
      '"status" - Quick status report',
      '"dashboard" - Full KPI dashboard',
      '"cac" - CAC breakdown by channel',
      '"spend" - Spend summary',
      '"agents" - List active agents',
      '"tasks" - List open tasks',
      '"pause campaign X" - Pause a campaign',
      '"resume campaign X" - Resume a campaign',
      '"approve all" - Approve all pending items',
      '"help" - Show this menu',
      "",
      "_You can also reply to approval requests with the buttons, or just type naturally._",
    ].join("\n");
  }

  /** Render a notification message. */
  renderNotification(
    type: string,
    title: string,
    body: string,
    actionRequired: boolean,
  ): string {
    const typeLabel = type.toUpperCase().replace("_", " ");
    const lines = [
      `*[${typeLabel}] ${title}*`,
      "",
      body,
    ];

    if (actionRequired) {
      lines.push("");
      lines.push("_Action required — please respond._");
    }

    return lines.join("\n");
  }

  // ---- Helpers ------------------------------------------------------------

  private divider(): string {
    return "----------------------------";
  }

  /** Truncate to WhatsApp's 4096 char limit. */
  private truncate(text: string, maxLength = 4000): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 20) + "\n\n_[truncated]_";
  }
}

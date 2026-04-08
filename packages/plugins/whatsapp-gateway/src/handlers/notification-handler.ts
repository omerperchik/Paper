// ---------------------------------------------------------------------------
// Notification Handler — format and send various notification types
// ---------------------------------------------------------------------------

import type { PluginContext, NotificationType } from "../types.js";
import type { WhatsAppClient } from "../services/whatsapp-client.js";
import type { DashboardRenderer } from "../services/dashboard-renderer.js";

export class NotificationHandler {
  private ctx: PluginContext;
  private waClient: WhatsAppClient;
  private renderer: DashboardRenderer;

  constructor(
    ctx: PluginContext,
    waClient: WhatsAppClient,
    renderer: DashboardRenderer,
  ) {
    this.ctx = ctx;
    this.waClient = waClient;
    this.renderer = renderer;
  }

  /** Send a notification to the chairman. */
  async sendNotification(params: {
    notificationType: NotificationType;
    title: string;
    body: string;
    taskId?: string;
    agentId?: string;
    actionRequired?: boolean;
  }): Promise<{ sent: boolean; messageId?: string }> {
    try {
      const chairmanPhone = await this.waClient.getChairmanPhone();
      const text = this.renderer.renderNotification(
        params.notificationType,
        params.title,
        params.body,
        params.actionRequired ?? false,
      );

      const { messageId } = await this.waClient.sendText(chairmanPhone, text);

      this.ctx.logger.info("Notification sent", {
        type: params.notificationType,
        title: params.title,
        messageId,
      });

      return { sent: true, messageId };
    } catch (err) {
      this.ctx.logger.error("Failed to send notification", {
        type: params.notificationType,
        title: params.title,
        error: err instanceof Error ? err.message : String(err),
      });
      return { sent: false };
    }
  }

  /** Send a budget alert notification. */
  async sendBudgetAlert(params: {
    channel: string;
    currentSpend: number;
    budget: number;
    percentUsed: number;
  }): Promise<void> {
    const body = [
      `Channel: ${params.channel}`,
      `Spend: $${params.currentSpend.toLocaleString()} / $${params.budget.toLocaleString()}`,
      `Usage: ${params.percentUsed.toFixed(1)}%`,
      "",
      params.percentUsed >= 100
        ? "Budget has been EXCEEDED. All spend on this channel has been paused."
        : params.percentUsed >= 90
          ? "Budget is critically close to the limit. Review immediately."
          : "Budget is approaching the limit. Consider adjusting allocation.",
    ].join("\n");

    await this.sendNotification({
      notificationType: "budget_alert",
      title: `Budget Alert: ${params.channel}`,
      body,
      actionRequired: params.percentUsed >= 90,
    });
  }

  /** Send an agent error notification. */
  async sendAgentError(params: {
    agentId: string;
    agentName: string;
    errorMessage: string;
    taskId?: string;
  }): Promise<void> {
    const body = [
      `Agent: ${params.agentName} (${params.agentId})`,
      params.taskId ? `Task: ${params.taskId}` : "",
      "",
      `Error: ${params.errorMessage}`,
    ]
      .filter(Boolean)
      .join("\n");

    await this.sendNotification({
      notificationType: "agent_error",
      title: `Agent Error: ${params.agentName}`,
      body,
      agentId: params.agentId,
      taskId: params.taskId,
      actionRequired: true,
    });
  }

  /** Send a milestone/success notification. */
  async sendMilestone(params: {
    title: string;
    description: string;
    agentId?: string;
  }): Promise<void> {
    await this.sendNotification({
      notificationType: "milestone",
      title: params.title,
      body: params.description,
      agentId: params.agentId,
      actionRequired: false,
    });
  }
}

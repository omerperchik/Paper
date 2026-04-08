// ---------------------------------------------------------------------------
// Agent Tool: whatsapp_send_notification
// Send a typed notification/alert to the chairman.
// ---------------------------------------------------------------------------

import type { PluginContext, NotificationType } from "../types.js";
import type { NotificationHandler } from "../handlers/notification-handler.js";

export function registerNotifyTool(
  ctx: PluginContext,
  notificationHandler: NotificationHandler,
): void {
  ctx.tools.register("whatsapp_send_notification", async ({ params }) => {
    const {
      notificationType = "info",
      title,
      body,
      taskId,
      agentId,
      actionRequired = false,
    } = params as {
      notificationType?: NotificationType;
      title: string;
      body: string;
      taskId?: string;
      agentId?: string;
      actionRequired?: boolean;
    };

    if (!title || !body) {
      return { error: "title and body are required" };
    }

    try {
      const result = await notificationHandler.sendNotification({
        notificationType,
        title,
        body,
        taskId,
        agentId,
        actionRequired,
      });

      return {
        sent: result.sent,
        messageId: result.messageId,
        notificationType,
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      ctx.logger.error("whatsapp_send_notification failed", { error: errMsg });
      return { error: errMsg };
    }
  });
}

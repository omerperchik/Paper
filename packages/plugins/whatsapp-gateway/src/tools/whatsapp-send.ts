// ---------------------------------------------------------------------------
// Agent Tool: whatsapp_send_message
// Send a text or template message to the chairman (or specified recipient).
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";
import type { WhatsAppClient } from "../services/whatsapp-client.js";

export function registerSendTool(ctx: PluginContext, waClient: WhatsAppClient): void {
  ctx.tools.register("whatsapp_send_message", async ({ params }) => {
    const {
      message,
      to,
      templateName,
      templateParams,
    } = params as {
      message: string;
      to?: string;
      templateName?: string;
      templateParams?: string[];
    };

    if (!message) {
      return { error: "message is required" };
    }

    try {
      const recipient = to ?? (await waClient.getChairmanPhone());

      // Template message
      if (templateName) {
        const components = templateParams?.length
          ? [
              {
                type: "body" as const,
                parameters: templateParams.map((text) => ({
                  type: "text" as const,
                  text,
                })),
              },
            ]
          : undefined;

        const { messageId } = await waClient.sendTemplate(
          recipient,
          templateName,
          "en",
          components,
        );

        ctx.logger.info("Template message sent via agent tool", {
          templateName,
          recipient,
          messageId,
        });

        return {
          sent: true,
          messageId,
          to: recipient,
          type: "template",
          templateName,
        };
      }

      // Plain text message
      const { messageId } = await waClient.sendText(recipient, message);

      ctx.logger.info("Text message sent via agent tool", {
        recipient,
        messageId,
        length: message.length,
      });

      return {
        sent: true,
        messageId,
        to: recipient,
        type: "text",
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      ctx.logger.error("whatsapp_send_message failed", { error: errMsg });
      return { error: errMsg };
    }
  });
}

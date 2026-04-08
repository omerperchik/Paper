// ---------------------------------------------------------------------------
// Agent Tool: whatsapp_send_message
// Send a text message to the chairman (or specified recipient).
// Updated for Baileys — no templates, just plain text.
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";
import type { WhatsAppClient } from "../services/whatsapp-client.js";

export function registerSendTool(ctx: PluginContext, waClient: WhatsAppClient): void {
  ctx.tools.register("whatsapp_send_message", async ({ params }) => {
    const {
      message,
      to,
    } = params as {
      message: string;
      to?: string;
    };

    if (!message) {
      return { error: "message is required" };
    }

    try {
      const recipient = to ?? (await waClient.getChairmanPhone());
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

// ---------------------------------------------------------------------------
// WhatsApp Cloud API Client
// Handles all outbound communication with the WhatsApp Cloud API v21.0
// ---------------------------------------------------------------------------

import type {
  PluginContext,
  WhatsAppOutboundMessage,
  WhatsAppTextMessage,
  WhatsAppTemplateMessage,
  WhatsAppInteractiveMessage,
  WhatsAppButton,
  WhatsAppMediaMessage,
  WhatsAppTemplateComponent,
} from "../types.js";

const API_VERSION = "v21.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

export class WhatsAppClient {
  private ctx: PluginContext;
  private phoneNumberId: string | null = null;
  private accessToken: string | null = null;

  constructor(ctx: PluginContext) {
    this.ctx = ctx;
  }

  // ---- Initialization -----------------------------------------------------

  /** Lazily resolve credentials from config/secrets. */
  private async ensureCredentials(): Promise<{ phoneNumberId: string; accessToken: string }> {
    if (this.phoneNumberId && this.accessToken) {
      return { phoneNumberId: this.phoneNumberId, accessToken: this.accessToken };
    }

    const phoneNumberId = (await this.ctx.config.get("whatsappPhoneNumberId")) as string | null;
    if (!phoneNumberId) {
      throw new Error("whatsappPhoneNumberId not configured");
    }

    const accessToken = await this.ctx.secrets.get("whatsappAccessTokenRef");
    if (!accessToken) {
      throw new Error("whatsappAccessTokenRef secret not configured");
    }

    this.phoneNumberId = phoneNumberId;
    this.accessToken = accessToken;
    return { phoneNumberId, accessToken };
  }

  /** Build the messages endpoint URL. */
  private async messagesUrl(): Promise<string> {
    const { phoneNumberId } = await this.ensureCredentials();
    return `${BASE_URL}/${phoneNumberId}/messages`;
  }

  /** Common headers for all API calls. */
  private async authHeaders(): Promise<Record<string, string>> {
    const { accessToken } = await this.ensureCredentials();
    return {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };
  }

  // ---- Send primitives ----------------------------------------------------

  /** Send a raw WhatsApp message payload and return the API response. */
  async send(payload: WhatsAppOutboundMessage): Promise<{ messageId: string; raw: unknown }> {
    const url = await this.messagesUrl();
    const headers = await this.authHeaders();

    this.ctx.logger.info("WhatsApp outbound message", {
      type: payload.type,
      to: payload.to,
    });

    try {
      const response = await this.ctx.http.post(url, {
        headers,
        body: JSON.stringify(payload),
      });

      const data = response.data as { messages?: Array<{ id: string }> };
      const messageId = data?.messages?.[0]?.id ?? "unknown";

      this.ctx.logger.info("WhatsApp message sent", { messageId });
      return { messageId, raw: data };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.ctx.logger.error("WhatsApp send failed", { error: errMsg });
      throw new Error(`WhatsApp API error: ${errMsg}`);
    }
  }

  // ---- High-level senders -------------------------------------------------

  /** Send a plain text message. */
  async sendText(to: string, text: string): Promise<{ messageId: string }> {
    const payload: WhatsAppTextMessage = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { body: text },
    };
    return this.send(payload);
  }

  /** Send a template message. */
  async sendTemplate(
    to: string,
    templateName: string,
    languageCode: string,
    components?: WhatsAppTemplateComponent[],
  ): Promise<{ messageId: string }> {
    const payload: WhatsAppTemplateMessage = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    };
    return this.send(payload);
  }

  /** Send an interactive button message (max 3 buttons per WhatsApp rules). */
  async sendInteractiveButtons(
    to: string,
    body: string,
    buttons: WhatsAppButton[],
    header?: string,
    footer?: string,
  ): Promise<{ messageId: string }> {
    if (buttons.length > 3) {
      this.ctx.logger.warn("WhatsApp allows max 3 buttons, truncating", {
        requested: buttons.length,
      });
    }

    const payload: WhatsAppInteractiveMessage = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body },
        action: {
          buttons: buttons.slice(0, 3),
        },
      },
    };

    if (header) {
      payload.interactive.header = { type: "text", text: header };
    }
    if (footer) {
      payload.interactive.footer = { text: footer };
    }

    return this.send(payload);
  }

  /** Send a media message (image, document, audio, video). */
  async sendMedia(
    to: string,
    mediaType: "image" | "document" | "audio" | "video",
    url: string,
    caption?: string,
    filename?: string,
  ): Promise<{ messageId: string }> {
    const payload: WhatsAppMediaMessage = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: mediaType,
    };

    switch (mediaType) {
      case "image":
        payload.image = { link: url, caption };
        break;
      case "document":
        payload.document = { link: url, caption, filename };
        break;
      case "audio":
        payload.audio = { link: url };
        break;
      case "video":
        payload.video = { link: url, caption };
        break;
    }

    return this.send(payload);
  }

  /** Mark a message as read (sends a read receipt). */
  async markAsRead(messageId: string): Promise<void> {
    const url = await this.messagesUrl();
    const headers = await this.authHeaders();

    try {
      await this.ctx.http.post(url, {
        headers,
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
        }),
      });
    } catch (err) {
      this.ctx.logger.warn("Failed to mark message as read", {
        messageId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---- Helpers ------------------------------------------------------------

  /** Get the chairman phone number from config. */
  async getChairmanPhone(): Promise<string> {
    const phone = (await this.ctx.config.get("chairmanPhoneNumber")) as string | null;
    if (!phone) {
      throw new Error("chairmanPhoneNumber not configured");
    }
    return phone;
  }
}

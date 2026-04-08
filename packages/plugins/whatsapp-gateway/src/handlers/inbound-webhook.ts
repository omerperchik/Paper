// ---------------------------------------------------------------------------
// Inbound Webhook Handler — verify + process incoming WhatsApp messages
// ---------------------------------------------------------------------------

import type {
  PluginContext,
  WebhookRequest,
  WebhookResponse,
  WhatsAppWebhookPayload,
  InboundMessage,
} from "../types.js";
import type { WhatsAppClient } from "../services/whatsapp-client.js";
import type { MessageRouter } from "../services/message-router.js";

export class InboundWebhookHandler {
  private ctx: PluginContext;
  private waClient: WhatsAppClient;
  private router: MessageRouter;

  constructor(
    ctx: PluginContext,
    waClient: WhatsAppClient,
    router: MessageRouter,
  ) {
    this.ctx = ctx;
    this.waClient = waClient;
    this.router = router;
  }

  /** Top-level webhook handler — dispatches GET (verify) and POST (message). */
  async handle(req: WebhookRequest): Promise<WebhookResponse> {
    if (req.method === "GET") {
      return this.handleVerification(req);
    }

    if (req.method === "POST") {
      return this.handleInbound(req);
    }

    return { status: 405, body: { error: "Method not allowed" } };
  }

  // ---- Verification handshake (GET) ---------------------------------------

  /**
   * WhatsApp sends a GET request to verify the webhook:
   *   ?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=<challenge>
   * We must return the challenge if the verify token matches.
   */
  private async handleVerification(req: WebhookRequest): Promise<WebhookResponse> {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (!mode || !token || !challenge) {
      this.ctx.logger.warn("Webhook verification missing parameters", { query: req.query });
      return { status: 400, body: { error: "Missing verification parameters" } };
    }

    const expectedToken = (await this.ctx.config.get("whatsappVerifyToken")) as string | null;
    if (!expectedToken) {
      this.ctx.logger.error("whatsappVerifyToken not configured");
      return { status: 500, body: { error: "Verify token not configured" } };
    }

    if (mode === "subscribe" && token === expectedToken) {
      this.ctx.logger.info("Webhook verification successful");
      // WhatsApp expects the raw challenge string as the response
      return {
        status: 200,
        headers: { "Content-Type": "text/plain" },
        body: challenge,
      };
    }

    this.ctx.logger.warn("Webhook verification failed — token mismatch");
    return { status: 403, body: { error: "Verification failed" } };
  }

  // ---- Inbound message processing (POST) ----------------------------------

  private async handleInbound(req: WebhookRequest): Promise<WebhookResponse> {
    // WhatsApp expects a 200 response quickly; we process asynchronously
    const payload = req.body as WhatsAppWebhookPayload;

    if (!payload?.entry) {
      this.ctx.logger.warn("Invalid webhook payload — no entry array");
      return { status: 400, body: { error: "Invalid payload" } };
    }

    // Process each entry/change
    for (const entry of payload.entry) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;

        const { messages, statuses } = change.value;

        // Process inbound messages
        if (messages && messages.length > 0) {
          for (const message of messages) {
            await this.processMessage(message);
          }
        }

        // Process status updates (sent/delivered/read)
        if (statuses && statuses.length > 0) {
          for (const status of statuses) {
            this.ctx.logger.info("Message status update", {
              messageId: status.id,
              status: status.status,
              recipient: status.recipient_id,
            });

            if (status.status === "failed" && status.errors) {
              this.ctx.logger.error("Message delivery failed", {
                messageId: status.id,
                errors: status.errors,
              });
            }
          }
        }
      }
    }

    return { status: 200, body: { status: "ok" } };
  }

  /** Process a single inbound message. */
  private async processMessage(message: InboundMessage): Promise<void> {
    this.ctx.logger.info("Processing inbound message", {
      id: message.id,
      from: message.from,
      type: message.type,
    });

    try {
      // Send read receipt
      await this.waClient.markAsRead(message.id);

      // Route to the appropriate handler
      const result = await this.router.route(message);

      this.ctx.logger.info("Message routed", {
        messageId: message.id,
        handler: result.handler,
        handled: result.handled,
      });

      // Emit telemetry
      await this.ctx.events.emit("whatsapp.message.processed", {
        messageId: message.id,
        from: message.from,
        type: message.type,
        handler: result.handler,
        handled: result.handled,
      });
    } catch (err) {
      this.ctx.logger.error("Failed to process inbound message", {
        messageId: message.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

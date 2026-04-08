// ---------------------------------------------------------------------------
// WhatsApp Gateway Plugin — worker entrypoint (Baileys-based)
// Communication backbone for the Paper marketing platform.
// Uses Baileys (WhatsApp Web protocol) — scan QR to connect.
// No Business API or third-party services needed.
// ---------------------------------------------------------------------------

import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import type { PluginWebhookInput } from "@paperclipai/plugin-sdk";

// Services
import { WhatsAppClient } from "./services/whatsapp-client.js";
import { SessionManager } from "./services/session-manager.js";
import { MessageRouter } from "./services/message-router.js";
import { ApprovalBridge } from "./services/approval-bridge.js";
import { CommandParser } from "./services/command-parser.js";
import { DashboardRenderer } from "./services/dashboard-renderer.js";

// Handlers
import { ApprovalHandler } from "./handlers/approval-handler.js";
import { CommandHandler } from "./handlers/command-handler.js";
import { NotificationHandler } from "./handlers/notification-handler.js";

// Tools
import { registerSendTool } from "./tools/whatsapp-send.js";
import { registerAskTool } from "./tools/whatsapp-ask.js";
import { registerApprovalTool } from "./tools/whatsapp-approval.js";
import { registerDashboardTool } from "./tools/whatsapp-dashboard.js";
import { registerNotifyTool } from "./tools/whatsapp-notify.js";

// Module-level references for onWebhook access
let _waClient: WhatsAppClient | null = null;

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("WhatsApp Gateway plugin starting up (Baileys mode)");

    // Cast ctx to our simplified type for service constructors
    const pctx = ctx as any;

    // ---- Initialize services ------------------------------------------------

    const waClient = new WhatsAppClient(pctx);
    _waClient = waClient;
    const sessions = new SessionManager(pctx);
    const approvalBridge = new ApprovalBridge(pctx, waClient);
    const commandParser = new CommandParser();
    const dashRenderer = new DashboardRenderer();
    const router = new MessageRouter(pctx, sessions, approvalBridge, commandParser);

    // ---- Initialize handlers ------------------------------------------------

    const approvalHandler = new ApprovalHandler(pctx, waClient, approvalBridge, sessions);
    const commandHandler = new CommandHandler(pctx, waClient, dashRenderer, approvalHandler);
    const notificationHandler = new NotificationHandler(pctx, waClient, dashRenderer);

    // ---- Wire up message handling -------------------------------------------

    waClient.setMessageHandler(async (message) => {
      ctx.logger.info("Processing inbound Baileys message", {
        from: message.fromPhone,
        type: message.type,
      });

      try {
        const result = await router.route(message);

        if (result.handler === "command" && result.result) {
          await commandHandler.execute(result.result as any, message.fromPhone);
        }

        ctx.logger.info("Message routed", {
          messageId: message.id,
          handler: result.handler,
          handled: String(result.handled),
        });
      } catch (err) {
        ctx.logger.error("Failed to process inbound message", {
          messageId: message.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // ---- Start Baileys connection -------------------------------------------

    void waClient.connect().catch((err) => {
      ctx.logger.error("Failed to start Baileys connection", {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // ---- Register tools -----------------------------------------------------

    registerSendTool(pctx, waClient);
    registerAskTool(pctx, waClient, sessions);
    registerApprovalTool(pctx, approvalHandler);
    registerDashboardTool(pctx, waClient, dashRenderer);
    registerNotifyTool(pctx, notificationHandler);

    // ---- Subscribe to platform events ---------------------------------------

    ctx.events.on("plugin.whatsapp.approval.resolved" as any, async (event: any) => {
      const { approvalId, taskId, agentId, status } = event;
      ctx.logger.info("Approval resolved", { approvalId, taskId, status });
    });

    ctx.events.on("issue.comment.created" as any, async (event: any) => {
      const { taskId, agentId, comment, tags } = event;
      if (!tags?.includes("chairman") && !tags?.includes("ceo")) return;

      ctx.logger.info("Forwarding tagged comment to chairman", { taskId, agentId });
      try {
        const chairmanPhone = await waClient.getChairmanPhone();
        const text = [
          `*Comment from ${agentId}*`,
          `Task: ${taskId}`,
          "",
          comment,
        ].join("\n");
        await waClient.sendText(chairmanPhone, text);
      } catch (err) {
        ctx.logger.error("Failed to forward comment to WhatsApp", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    });

    // ---- Register data providers --------------------------------------------

    ctx.data.register("whatsapp-status", async () => {
      const state = waClient.getConnectionState();
      return {
        status: state.status,
        connected: state.status === "connected",
        phone: state.phoneNumber ?? null,
        name: state.pushName ?? null,
        plugin: "whatsapp-gateway",
      };
    });

    ctx.logger.info("WhatsApp Gateway plugin initialized (Baileys mode)");
  },

  // ---- Webhook handler for QR/status/logout endpoints ----------------------

  async onWebhook(input: PluginWebhookInput) {
    const { endpointKey, rawBody, headers } = input;

    // Note: the host routes POST /api/plugins/:id/webhooks/:endpointKey here.
    // We parse the endpointKey to determine which endpoint was hit.
    // Webhook responses are not supported in the current SDK — we use data providers
    // and plugin streams for real-time QR code delivery instead.

    if (!_waClient) return;

    if (endpointKey === "whatsapp-qr" || endpointKey === "qr") {
      // QR data is delivered via the data provider instead
    }

    if (endpointKey === "whatsapp-logout" || endpointKey === "logout") {
      await _waClient.logout();
    }
  },

  async onHealth() {
    if (!_waClient) return { status: "ok" };
    const state = _waClient.getConnectionState();
    return {
      status: "ok",
      details: {
        whatsapp: state.status,
        connected: state.status === "connected",
        phone: state.phoneNumber ?? null,
      },
    } as any;
  },
});

export default plugin;
runWorker(plugin, import.meta.url);

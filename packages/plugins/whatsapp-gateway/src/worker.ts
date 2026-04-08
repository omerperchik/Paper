// ---------------------------------------------------------------------------
// WhatsApp Gateway Plugin — worker entrypoint
// Communication backbone for the Paper marketing platform.
// All human communication flows through WhatsApp: questions, approvals,
// dashboards, commands, and notifications.
// ---------------------------------------------------------------------------

import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

// Services
import { WhatsAppClient } from "./services/whatsapp-client.js";
import { SessionManager } from "./services/session-manager.js";
import { MessageRouter } from "./services/message-router.js";
import { ApprovalBridge } from "./services/approval-bridge.js";
import { CommandParser } from "./services/command-parser.js";
import { DashboardRenderer } from "./services/dashboard-renderer.js";

// Handlers
import { InboundWebhookHandler } from "./handlers/inbound-webhook.js";
import { ApprovalHandler } from "./handlers/approval-handler.js";
import { CommandHandler } from "./handlers/command-handler.js";
import { NotificationHandler } from "./handlers/notification-handler.js";

// Tools
import { registerSendTool } from "./tools/whatsapp-send.js";
import { registerAskTool } from "./tools/whatsapp-ask.js";
import { registerApprovalTool } from "./tools/whatsapp-approval.js";
import { registerDashboardTool } from "./tools/whatsapp-dashboard.js";
import { registerNotifyTool } from "./tools/whatsapp-notify.js";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("WhatsApp Gateway plugin starting up");

    // ---- Initialize services ------------------------------------------------

    const waClient = new WhatsAppClient(ctx);
    const sessions = new SessionManager(ctx);
    const approvalBridge = new ApprovalBridge(ctx, waClient);
    const commandParser = new CommandParser();
    const dashRenderer = new DashboardRenderer();
    const router = new MessageRouter(ctx, sessions, approvalBridge, commandParser);

    // ---- Initialize handlers ------------------------------------------------

    const webhookHandler = new InboundWebhookHandler(ctx, waClient, router);
    const approvalHandler = new ApprovalHandler(ctx, waClient, approvalBridge, sessions);
    const commandHandler = new CommandHandler(ctx, waClient, dashRenderer, approvalHandler);
    const notificationHandler = new NotificationHandler(ctx, waClient, dashRenderer);

    // ---- Register tools -----------------------------------------------------

    registerSendTool(ctx, waClient);
    registerAskTool(ctx, waClient, sessions);
    registerApprovalTool(ctx, approvalHandler);
    registerDashboardTool(ctx, waClient, dashRenderer);
    registerNotifyTool(ctx, notificationHandler);

    // ---- Register webhook ---------------------------------------------------

    ctx.webhooks.register("/whatsapp/inbound", async (req) => {
      return webhookHandler.handle(req);
    });

    // ---- Subscribe to platform events ---------------------------------------

    // When an approval is resolved (approved/rejected), emit notification
    ctx.events.on("approval.resolved", async (event) => {
      const { approvalId, taskId, agentId, status } = event as unknown as {
        approvalId: string;
        taskId: string;
        agentId: string;
        status: string;
      };
      ctx.logger.info("Approval resolved", { approvalId, taskId, status });
      // The approval bridge already sent a confirmation to the chairman.
      // Here we emit a platform-wide event for other plugins to consume.
      await ctx.events.emit("whatsapp.approval.resolved", {
        approvalId,
        taskId,
        agentId,
        status,
      });
    });

    // Agent errors — forward to chairman
    ctx.events.on("agent.error", async (event) => {
      const { agentId, agentName, error: errorMsg, taskId } = event as unknown as {
        agentId: string;
        agentName?: string;
        error: string;
        taskId?: string;
      };
      ctx.logger.warn("Agent error received, forwarding to WhatsApp", { agentId, taskId });
      await notificationHandler.sendAgentError({
        agentId,
        agentName: (agentName as string) ?? agentId,
        errorMessage: typeof errorMsg === "string" ? errorMsg : JSON.stringify(errorMsg),
        taskId,
      });
    });

    // Budget alerts — forward to chairman
    ctx.events.on("budget.alert", async (event) => {
      const { channel, currentSpend, budget, percentUsed } = event as unknown as {
        channel: string;
        currentSpend: number;
        budget: number;
        percentUsed: number;
      };
      ctx.logger.warn("Budget alert received, forwarding to WhatsApp", { channel, percentUsed });
      await notificationHandler.sendBudgetAlert({ channel, currentSpend, budget, percentUsed });
    });

    // Task comments tagged for chairman — forward to WhatsApp
    ctx.events.on("issue.comment.created", async (event) => {
      const { taskId, agentId, comment, tags } = event as unknown as {
        taskId: string;
        agentId: string;
        comment: string;
        tags?: string[];
      };

      // Only forward if tagged for chairman
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

    // Handle routed commands from the message router
    ctx.events.on("whatsapp.message.processed", async (event) => {
      const { handler } = event as unknown as { handler: string; messageId: string };
      // If a command was parsed by the router, it returned the result but
      // didn't execute it. We handle execution here via the command handler.
      // In practice, the router returns the ParsedCommand and we execute it.
      // This is handled inline in the router for now.
      if (handler === "command") {
        ctx.logger.info("Command processed via message router");
      }
    });

    // ---- Register data providers --------------------------------------------

    ctx.data.register("whatsapp-status", async () => {
      return {
        status: "connected",
        plugin: "whatsapp-gateway",
      };
    });

    ctx.logger.info("WhatsApp Gateway plugin initialized successfully");
  },

  async onHealth() {
    return { status: "ok" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);

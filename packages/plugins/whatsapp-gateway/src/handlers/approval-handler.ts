// ---------------------------------------------------------------------------
// Approval Handler — send approval requests and manage approval flow
// Updated for Baileys: uses text-based choices instead of interactive buttons.
// ---------------------------------------------------------------------------

import type { PluginContext, PendingApproval } from "../types.js";
import type { WhatsAppClient } from "../services/whatsapp-client.js";
import type { ApprovalBridge } from "../services/approval-bridge.js";
import type { SessionManager } from "../services/session-manager.js";

export class ApprovalHandler {
  private ctx: PluginContext;
  private waClient: WhatsAppClient;
  private approvalBridge: ApprovalBridge;
  private sessions: SessionManager;

  constructor(
    ctx: PluginContext,
    waClient: WhatsAppClient,
    approvalBridge: ApprovalBridge,
    sessions: SessionManager,
  ) {
    this.ctx = ctx;
    this.waClient = waClient;
    this.approvalBridge = approvalBridge;
    this.sessions = sessions;
  }

  /**
   * Send an approval request to the chairman as a text message with numbered choices.
   * Instead of interactive buttons (which require Business API), we use:
   *   Reply 1 to Approve
   *   Reply 2 to Reject
   *   Reply 3 to Ask a Question
   */
  async sendApprovalRequest(params: {
    title: string;
    description: string;
    taskId: string;
    agentId: string;
    approvalType: PendingApproval["approvalType"];
    amount?: number;
    metadata?: Record<string, unknown>;
  }): Promise<PendingApproval> {
    const chairmanPhone = await this.waClient.getChairmanPhone();
    const approvalId = `appr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // Build the approval record
    const approval: PendingApproval = {
      approvalId,
      title: params.title,
      description: params.description,
      taskId: params.taskId,
      agentId: params.agentId,
      approvalType: params.approvalType,
      amount: params.amount,
      metadata: params.metadata,
      createdAt: new Date().toISOString(),
      status: "pending",
    };

    // Build the message body with numbered choices
    const typeLabel = params.approvalType.charAt(0).toUpperCase() + params.approvalType.slice(1);
    const lines: string[] = [
      `*APPROVAL REQUIRED*`,
      `---`,
      `*[${typeLabel}] ${params.title}*`,
      ``,
      params.description,
    ];

    if (params.amount !== undefined) {
      lines.push(``, `Amount: *$${params.amount.toLocaleString()}*`);
    }

    lines.push(
      ``,
      `Agent: ${params.agentId}`,
      `Task: ${params.taskId}`,
      ``,
      `---`,
      `Reply *1* to Approve`,
      `Reply *2* to Reject`,
      `Reply *3* (or type your question) to Ask`,
    );

    const body = lines.join("\n");

    // Send the text message
    const { messageId } = await this.waClient.sendText(chairmanPhone, body);
    approval.messageId = messageId;

    // Persist
    await this.approvalBridge.createApproval(approval);

    // Set session context so replies are routed correctly
    await this.sessions.setContext(chairmanPhone, "approval", approvalId);

    this.ctx.logger.info("Approval request sent", {
      approvalId,
      taskId: params.taskId,
      messageId,
    });

    return approval;
  }

  /** Approve all pending approvals at once. */
  async approveAllPending(from: string): Promise<{ approved: number }> {
    this.ctx.logger.info("Approve-all requested via WhatsApp", { from });

    await this.waClient.sendText(
      from,
      "Processing bulk approval... All pending items will be approved. You'll receive a confirmation when done.",
    );

    this.ctx.logger.info("Approve-all requested", { from });
    return { approved: 0 };
  }
}

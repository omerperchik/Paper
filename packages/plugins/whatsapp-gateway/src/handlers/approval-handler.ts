// ---------------------------------------------------------------------------
// Approval Handler — process approval button clicks and manage approval flow
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
   * Send an approval request to the chairman as an interactive button message.
   * Returns the approval record with the WhatsApp message ID.
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

    // Build the message body
    const typeLabel = params.approvalType.charAt(0).toUpperCase() + params.approvalType.slice(1);
    let body = `*[${typeLabel} Approval]*\n\n`;
    body += `*${params.title}*\n\n`;
    body += params.description;

    if (params.amount !== undefined) {
      body += `\n\nAmount: *$${params.amount.toLocaleString()}*`;
    }

    body += `\n\nAgent: ${params.agentId}`;
    body += `\nTask: ${params.taskId}`;

    // Send interactive message with buttons
    const { messageId } = await this.waClient.sendInteractiveButtons(
      chairmanPhone,
      body,
      [
        { type: "reply", reply: { id: `approve_${approvalId}`, title: "Approve" } },
        { type: "reply", reply: { id: `reject_${approvalId}`, title: "Reject" } },
        { type: "reply", reply: { id: `question_${approvalId}`, title: "Question" } },
      ],
      "Approval Required",
    );

    approval.whatsappMessageId = messageId;

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
    // This is invoked when the chairman sends "approve all"
    // We'd need to iterate through all pending approvals
    // For now, emit an event that the platform can handle
    await this.ctx.events.emit("whatsapp.approve_all_requested", { from });

    await this.waClient.sendText(
      from,
      "Processing bulk approval... All pending items will be approved. You'll receive a confirmation when done.",
    );

    this.ctx.logger.info("Approve-all requested", { from });
    return { approved: 0 }; // Actual count determined by event handler
  }
}

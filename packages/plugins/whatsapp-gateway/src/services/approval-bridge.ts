// ---------------------------------------------------------------------------
// Approval Bridge — convert WhatsApp replies into Paperclip approval actions
// Updated for Baileys — text-based responses instead of button clicks.
// ---------------------------------------------------------------------------

import type {
  PluginContext,
  PendingApproval,
  StateKey,
} from "../types.js";
import type { WhatsAppClient } from "./whatsapp-client.js";

export class ApprovalBridge {
  private ctx: PluginContext;
  private waClient: WhatsAppClient;

  constructor(ctx: PluginContext, waClient: WhatsAppClient) {
    this.ctx = ctx;
    this.waClient = waClient;
  }

  private approvalKey(approvalId: string): StateKey {
    return {
      scopeKind: "instance",
      namespace: "whatsapp-gateway",
      stateKey: `approval:${approvalId}`,
    };
  }

  private approvalIndexKey(): StateKey {
    return {
      scopeKind: "instance",
      namespace: "whatsapp-gateway",
      stateKey: "approval:index",
    };
  }

  async createApproval(approval: PendingApproval): Promise<void> {
    await this.ctx.state.set(this.approvalKey(approval.approvalId), approval);

    const index = await this.getApprovalIndex();
    index.push(approval.approvalId);
    await this.ctx.state.set(this.approvalIndexKey(), index);

    this.ctx.logger.info("Approval created", {
      approvalId: approval.approvalId,
      title: approval.title,
      taskId: approval.taskId,
    });
  }

  async getApproval(approvalId: string): Promise<PendingApproval | null> {
    const raw = await this.ctx.state.get(this.approvalKey(approvalId));
    if (!raw) return null;
    try {
      return typeof raw === "string" ? JSON.parse(raw) : (raw as PendingApproval);
    } catch {
      this.ctx.logger.warn("Corrupt approval state", { approvalId });
      return null;
    }
  }

  async updateApproval(approval: PendingApproval): Promise<void> {
    await this.ctx.state.set(this.approvalKey(approval.approvalId), approval);
  }

  private async getApprovalIndex(): Promise<string[]> {
    const raw = await this.ctx.state.get(this.approvalIndexKey());
    if (!raw) return [];
    try {
      return typeof raw === "string" ? JSON.parse(raw) : (raw as string[]);
    } catch {
      return [];
    }
  }

  async handleButtonResponse(
    approvalId: string,
    action: "approve" | "reject" | "question",
    from: string,
  ): Promise<{ success: boolean; message: string }> {
    const approval = await this.getApproval(approvalId);
    if (!approval) {
      this.ctx.logger.warn("Approval not found for response", { approvalId });
      await this.waClient.sendText(from, "Sorry, I couldn't find that approval request. It may have expired.");
      return { success: false, message: "Approval not found" };
    }

    if (approval.status !== "pending" && approval.status !== "question") {
      await this.waClient.sendText(from, `This approval was already ${approval.status}. No action taken.`);
      return { success: false, message: `Already ${approval.status}` };
    }

    switch (action) {
      case "approve": {
        approval.status = "approved";
        await this.updateApproval(approval);
        await this.waClient.sendText(from, `Approved: ${approval.title}\nThe agent has been notified and will proceed.`);
        this.ctx.logger.info("Approval approved", { approvalId, taskId: approval.taskId });
        return { success: true, message: "Approved" };
      }

      case "reject": {
        approval.status = "rejected";
        await this.updateApproval(approval);
        await this.waClient.sendText(from, `Rejected: ${approval.title}\nThe agent has been notified.`);
        this.ctx.logger.info("Approval rejected", { approvalId, taskId: approval.taskId });
        return { success: true, message: "Rejected" };
      }

      case "question": {
        approval.status = "question";
        await this.updateApproval(approval);
        await this.waClient.sendText(from, `Please type your question about: ${approval.title}\nI'll forward it to the agent.`);
        this.ctx.logger.info("Approval question requested", { approvalId });
        return { success: true, message: "Awaiting question text" };
      }

      default:
        return { success: false, message: `Unknown action: ${action}` };
    }
  }

  async handleTextFollowUp(
    approvalId: string,
    text: string,
    from: string,
  ): Promise<{ success: boolean }> {
    const approval = await this.getApproval(approvalId);
    if (!approval) {
      await this.waClient.sendText(from, "Could not find the related approval. Please try again.");
      return { success: false };
    }

    approval.responseText = text;
    approval.status = "pending";
    await this.updateApproval(approval);

    await this.waClient.sendText(
      from,
      "Got it. I've forwarded your question to the agent. You'll get an updated request once they respond.",
    );

    this.ctx.logger.info("Approval follow-up question sent to agent", {
      approvalId,
      taskId: approval.taskId,
    });

    return { success: true };
  }
}

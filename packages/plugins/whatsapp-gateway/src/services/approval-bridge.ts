// ---------------------------------------------------------------------------
// Approval Bridge — convert WhatsApp replies into Paperclip approval actions
// ---------------------------------------------------------------------------

import type {
  PluginContext,
  PendingApproval,
  StateKey,
} from "../types.js";
import type { WhatsAppClient } from "./whatsapp-client.js";

const SCOPE_KIND = "plugin";
const SCOPE_ID = "whatsapp-gateway";

export class ApprovalBridge {
  private ctx: PluginContext;
  private waClient: WhatsAppClient;

  constructor(ctx: PluginContext, waClient: WhatsAppClient) {
    this.ctx = ctx;
    this.waClient = waClient;
  }

  // ---- State helpers ------------------------------------------------------

  private approvalKey(approvalId: string): StateKey {
    return {
      scopeKind: SCOPE_KIND,
      scopeId: SCOPE_ID,
      stateKey: `approval:${approvalId}`,
    };
  }

  private approvalIndexKey(): StateKey {
    return {
      scopeKind: SCOPE_KIND,
      scopeId: SCOPE_ID,
      stateKey: "approval:index",
    };
  }

  // ---- CRUD ---------------------------------------------------------------

  /** Store a new pending approval. */
  async createApproval(approval: PendingApproval): Promise<void> {
    await this.ctx.state.set(
      this.approvalKey(approval.approvalId),
      JSON.stringify(approval),
    );

    // Maintain an index of pending approval IDs
    const index = await this.getApprovalIndex();
    index.push(approval.approvalId);
    await this.ctx.state.set(this.approvalIndexKey(), JSON.stringify(index));

    this.ctx.logger.info("Approval created", {
      approvalId: approval.approvalId,
      title: approval.title,
      taskId: approval.taskId,
    });
  }

  /** Get a pending approval by ID. */
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

  /** Update an existing approval. */
  async updateApproval(approval: PendingApproval): Promise<void> {
    await this.ctx.state.set(
      this.approvalKey(approval.approvalId),
      JSON.stringify(approval),
    );
  }

  /** Get the list of all pending approval IDs. */
  private async getApprovalIndex(): Promise<string[]> {
    const raw = await this.ctx.state.get(this.approvalIndexKey());
    if (!raw) return [];
    try {
      return typeof raw === "string" ? JSON.parse(raw) : (raw as string[]);
    } catch {
      return [];
    }
  }

  // ---- Button response handling -------------------------------------------

  /** Handle an approval button click (approve, reject, question). */
  async handleButtonResponse(
    approvalId: string,
    action: "approve" | "reject" | "question",
    from: string,
  ): Promise<{ success: boolean; message: string }> {
    const approval = await this.getApproval(approvalId);
    if (!approval) {
      this.ctx.logger.warn("Approval not found for button response", { approvalId });
      await this.waClient.sendText(from, "Sorry, I couldn't find that approval request. It may have expired.");
      return { success: false, message: "Approval not found" };
    }

    if (approval.status !== "pending") {
      await this.waClient.sendText(
        from,
        `This approval was already ${approval.status}. No action taken.`,
      );
      return { success: false, message: `Already ${approval.status}` };
    }

    switch (action) {
      case "approve": {
        approval.status = "approved";
        await this.updateApproval(approval);

        await this.ctx.events.emit("approval.resolved", {
          approvalId: approval.approvalId,
          taskId: approval.taskId,
          agentId: approval.agentId,
          status: "approved",
          resolvedBy: from,
        });

        await this.waClient.sendText(
          from,
          `Approved: ${approval.title}\nThe agent has been notified and will proceed.`,
        );

        this.ctx.logger.info("Approval approved", { approvalId, taskId: approval.taskId });
        return { success: true, message: "Approved" };
      }

      case "reject": {
        approval.status = "rejected";
        await this.updateApproval(approval);

        await this.ctx.events.emit("approval.resolved", {
          approvalId: approval.approvalId,
          taskId: approval.taskId,
          agentId: approval.agentId,
          status: "rejected",
          resolvedBy: from,
        });

        await this.waClient.sendText(
          from,
          `Rejected: ${approval.title}\nThe agent has been notified.`,
        );

        this.ctx.logger.info("Approval rejected", { approvalId, taskId: approval.taskId });
        return { success: true, message: "Rejected" };
      }

      case "question": {
        approval.status = "question";
        await this.updateApproval(approval);

        await this.waClient.sendText(
          from,
          `Please type your question about: ${approval.title}\nI'll forward it to the agent.`,
        );

        this.ctx.logger.info("Approval question requested", { approvalId });
        return { success: true, message: "Awaiting question text" };
      }

      default:
        return { success: false, message: `Unknown action: ${action}` };
    }
  }

  /** Handle a text follow-up to an approval (the chairman typed a question). */
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
    // Reset status back to pending — agent needs to address the question and re-submit
    approval.status = "pending";
    await this.updateApproval(approval);

    await this.ctx.events.emit("approval.question", {
      approvalId: approval.approvalId,
      taskId: approval.taskId,
      agentId: approval.agentId,
      question: text,
      from,
    });

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

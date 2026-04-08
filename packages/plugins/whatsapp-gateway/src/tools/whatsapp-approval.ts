// ---------------------------------------------------------------------------
// Agent Tool: whatsapp_request_approval
// Send an approval request with interactive Approve/Reject/Question buttons.
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";
import type { ApprovalHandler } from "../handlers/approval-handler.js";

export function registerApprovalTool(
  ctx: PluginContext,
  approvalHandler: ApprovalHandler,
): void {
  ctx.tools.register("whatsapp_request_approval", async ({ params }) => {
    const {
      title,
      description,
      taskId,
      agentId,
      approvalType = "general",
      amount,
      metadata,
    } = params as {
      title: string;
      description: string;
      taskId: string;
      agentId: string;
      approvalType?: "spend" | "publish" | "strategy" | "hire" | "general";
      amount?: number;
      metadata?: Record<string, unknown>;
    };

    if (!title || !description || !taskId || !agentId) {
      return { error: "title, description, taskId, and agentId are required" };
    }

    try {
      const approval = await approvalHandler.sendApprovalRequest({
        title,
        description,
        taskId,
        agentId,
        approvalType,
        amount,
        metadata,
      });

      ctx.logger.info("Approval request sent via agent tool", {
        approvalId: approval.approvalId,
        taskId,
        agentId,
      });

      return {
        sent: true,
        approvalId: approval.approvalId,
        status: "pending",
        note: "The chairman has received the approval request with Approve/Reject/Question buttons. You will be notified of the decision via an event.",
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      ctx.logger.error("whatsapp_request_approval failed", { error: errMsg });
      return { error: errMsg };
    }
  });
}

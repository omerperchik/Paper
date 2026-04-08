// ---------------------------------------------------------------------------
// Agent Tool: whatsapp_ask_chairman
// Send a question, store the pending question, and wait for the reply.
// ---------------------------------------------------------------------------

import type { PluginContext, PendingQuestion, StateKey } from "../types.js";
import type { WhatsAppClient } from "../services/whatsapp-client.js";
import type { SessionManager } from "../services/session-manager.js";

function questionKey(questionId: string): StateKey {
  return { scopeKind: "instance", namespace: "whatsapp-gateway", stateKey: `question:${questionId}` };
}

function questionIndexKey(): StateKey {
  return { scopeKind: "instance", namespace: "whatsapp-gateway", stateKey: "question:index" };
}

export function registerAskTool(
  ctx: PluginContext,
  waClient: WhatsAppClient,
  sessions: SessionManager,
): void {
  ctx.tools.register("whatsapp_ask_chairman", async ({ params }) => {
    const {
      question,
      context: questionContext,
      taskId,
      agentId,
      urgency = "normal",
      timeoutMinutes = 60,
    } = params as {
      question: string;
      context?: string;
      taskId: string;
      agentId: string;
      urgency?: "low" | "normal" | "high" | "critical";
      timeoutMinutes?: number;
    };

    if (!question || !taskId || !agentId) {
      return { error: "question, taskId, and agentId are required" };
    }

    try {
      const chairmanPhone = await waClient.getChairmanPhone();
      const questionId = `q_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      const urgencyLabel = urgency === "critical" ? "(!) URGENT" : urgency === "high" ? "HIGH PRIORITY" : "";
      let messageBody = "";
      if (urgencyLabel) {
        messageBody += `*${urgencyLabel}*\n\n`;
      }
      messageBody += `*Question from agent ${agentId}:*\n\n`;
      messageBody += question;
      if (questionContext) {
        messageBody += `\n\n_Context: ${questionContext}_`;
      }
      messageBody += `\n\nTask: ${taskId}`;
      messageBody += "\n\n_Reply to this message with your answer._";

      const { messageId } = await waClient.sendText(chairmanPhone, messageBody);

      const pending: PendingQuestion = {
        questionId,
        question,
        context: questionContext,
        taskId,
        agentId,
        urgency,
        messageId,
        createdAt: new Date().toISOString(),
        timeoutAt: new Date(Date.now() + timeoutMinutes * 60 * 1000).toISOString(),
        status: "pending",
      };

      await ctx.state.set(questionKey(questionId), pending);

      const indexRaw = await ctx.state.get(questionIndexKey());
      const index: string[] = indexRaw
        ? typeof indexRaw === "string" ? JSON.parse(indexRaw) : (indexRaw as string[])
        : [];
      index.push(questionId);
      await ctx.state.set(questionIndexKey(), index);

      await sessions.setContext(chairmanPhone, "question", questionId);

      ctx.logger.info("Question sent to chairman", { questionId, taskId, agentId, messageId });

      return {
        sent: true,
        questionId,
        messageId,
        status: "pending",
        note: "The chairman has been asked. Their reply will be posted as a comment on your task.",
      };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      ctx.logger.error("whatsapp_ask_chairman failed", { error: errMsg });
      return { error: errMsg };
    }
  });

  // Listen for answers coming back from the message router
  ctx.events.on("plugin.whatsapp.question.answered" as any, async (event: any) => {
    const { questionId, answer, from } = event;

    const raw = await ctx.state.get(questionKey(questionId));
    if (!raw) {
      ctx.logger.warn("Answer received for unknown question", { questionId });
      return;
    }

    const pending: PendingQuestion = typeof raw === "string" ? JSON.parse(raw) : (raw as PendingQuestion);
    pending.status = "answered";
    pending.answer = answer;
    await ctx.state.set(questionKey(questionId), pending);

    await waClient.sendText(from, `Got it. Your answer has been forwarded to agent ${pending.agentId}.`);

    ctx.logger.info("Question answered", {
      questionId,
      taskId: pending.taskId,
      agentId: pending.agentId,
    });
  });
}

// ---------------------------------------------------------------------------
// Message Router — route inbound WhatsApp messages to the correct handler
// Updated for Baileys — uses our normalised InboundMessage type.
// ---------------------------------------------------------------------------

import type { PluginContext, InboundMessage, ConversationSession } from "../types.js";
import type { SessionManager } from "./session-manager.js";
import type { ApprovalBridge } from "./approval-bridge.js";
import type { CommandParser } from "./command-parser.js";

export interface RouteResult {
  handled: boolean;
  handler: string;
  result?: unknown;
}

export class MessageRouter {
  private ctx: PluginContext;
  private sessions: SessionManager;
  private approvalBridge: ApprovalBridge;
  private commandParser: CommandParser;

  constructor(
    ctx: PluginContext,
    sessions: SessionManager,
    approvalBridge: ApprovalBridge,
    commandParser: CommandParser,
  ) {
    this.ctx = ctx;
    this.sessions = sessions;
    this.approvalBridge = approvalBridge;
    this.commandParser = commandParser;
  }

  /** Main routing logic for an inbound message. */
  async route(message: InboundMessage): Promise<RouteResult> {
    const session = await this.sessions.recordInboundMessage(message.fromPhone);

    this.ctx.logger.info("Routing inbound message", {
      from: message.fromPhone,
      type: message.type,
      context: session.currentContext,
    });

    // Only handle text messages (Baileys doesn't have button replies like Business API)
    if (message.type === "text" && message.text) {
      return this.routeTextMessage(message, session);
    }

    // Unhandled message types
    this.ctx.logger.info("Non-text message type, ignoring", { type: message.type });
    return { handled: false, handler: "none" };
  }

  /** Route a text message based on session context. */
  private async routeTextMessage(
    message: InboundMessage,
    session: ConversationSession,
  ): Promise<RouteResult> {
    const text = message.text!.trim();

    // If we're in an approval context, check for approval responses (1/2/3)
    if (session.currentContext === "approval" && session.pendingItemId) {
      return this.routeApprovalResponse(text, message, session);
    }

    // If we're in a question context, treat this as an answer to a pending question
    if (session.currentContext === "question" && session.pendingItemId) {
      await (this.ctx.events as any).emit("plugin.whatsapp.question.answered", "_global_", {
        questionId: session.pendingItemId,
        answer: text,
        from: message.fromPhone,
      });
      await this.sessions.clearContext(message.fromPhone);
      return { handled: true, handler: "question_answer" };
    }

    // Otherwise, try to parse as a command
    const command = this.commandParser.parse(text);
    if (command) {
      return {
        handled: true,
        handler: "command",
        result: command,
      };
    }

    // Unrecognized text — log it
    this.ctx.logger.info("Unhandled text message", {
      from: message.fromPhone,
      text,
      messageId: message.id,
    });

    return { handled: false, handler: "unhandled_text" };
  }

  /**
   * Route an approval response.
   * Since Baileys doesn't have interactive buttons, we use text-based responses:
   *   "1" or "approve" → approve
   *   "2" or "reject"  → reject
   *   "3" or "question" → ask a question (next message is the question text)
   *   anything else while in approval context → treat as question text
   */
  private async routeApprovalResponse(
    text: string,
    message: InboundMessage,
    session: ConversationSession,
  ): Promise<RouteResult> {
    const approvalId = session.pendingItemId!;
    const lower = text.toLowerCase().trim();

    // Direct approve/reject/question responses
    if (lower === "1" || lower === "approve" || lower === "yes" || lower === "approved") {
      const result = await this.approvalBridge.handleButtonResponse(
        approvalId,
        "approve",
        message.fromPhone,
      );
      await this.sessions.clearContext(message.fromPhone);
      return { handled: true, handler: "approval_approve", result };
    }

    if (lower === "2" || lower === "reject" || lower === "no" || lower === "rejected") {
      const result = await this.approvalBridge.handleButtonResponse(
        approvalId,
        "reject",
        message.fromPhone,
      );
      await this.sessions.clearContext(message.fromPhone);
      return { handled: true, handler: "approval_reject", result };
    }

    if (lower === "3" || lower === "question" || lower === "?") {
      // Set up to receive the question text in the next message
      const result = await this.approvalBridge.handleButtonResponse(
        approvalId,
        "question",
        message.fromPhone,
      );
      // Keep the approval context — next message will be the question text
      return { handled: true, handler: "approval_question_prompt", result };
    }

    // Anything else while in approval context → treat as a follow-up question
    const result = await this.approvalBridge.handleTextFollowUp(
      approvalId,
      text,
      message.fromPhone,
    );
    await this.sessions.clearContext(message.fromPhone);
    return { handled: true, handler: "approval_followup", result };
  }
}

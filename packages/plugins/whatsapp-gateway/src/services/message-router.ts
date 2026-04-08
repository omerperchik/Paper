// ---------------------------------------------------------------------------
// Message Router — route inbound WhatsApp messages to the correct handler
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
    const session = await this.sessions.recordInboundMessage(message.from);

    this.ctx.logger.info("Routing inbound message", {
      from: message.from,
      type: message.type,
      context: session.currentContext,
    });

    // 1. Interactive button replies — always route to approval handler
    if (message.type === "interactive" || message.type === "button") {
      return this.routeButtonReply(message, session);
    }

    // 2. Text messages — route based on current context
    if (message.type === "text" && message.text?.body) {
      return this.routeTextMessage(message, session);
    }

    // 3. Unhandled message types
    this.ctx.logger.info("Unhandled message type, ignoring", { type: message.type });
    return { handled: false, handler: "none" };
  }

  /** Route an interactive button reply (approval accept/reject/question). */
  private async routeButtonReply(
    message: InboundMessage,
    session: ConversationSession,
  ): Promise<RouteResult> {
    let buttonId: string | undefined;
    let buttonTitle: string | undefined;

    if (message.interactive?.button_reply) {
      buttonId = message.interactive.button_reply.id;
      buttonTitle = message.interactive.button_reply.title;
    } else if (message.interactive?.list_reply) {
      buttonId = message.interactive.list_reply.id;
      buttonTitle = message.interactive.list_reply.title;
    } else if (message.button) {
      buttonId = message.button.payload;
      buttonTitle = message.button.text;
    }

    if (!buttonId) {
      this.ctx.logger.warn("Button reply without ID", { message });
      return { handled: false, handler: "button" };
    }

    this.ctx.logger.info("Routing button reply", { buttonId, buttonTitle });

    // Button IDs follow the pattern: approve_<approvalId>, reject_<approvalId>, question_<approvalId>
    const [action, ...idParts] = buttonId.split("_");
    const approvalId = idParts.join("_");

    if (["approve", "reject", "question"].includes(action) && approvalId) {
      const result = await this.approvalBridge.handleButtonResponse(
        approvalId,
        action as "approve" | "reject" | "question",
        message.from,
      );

      // If the action is "question", set context so the next text reply is captured
      if (action === "question") {
        await this.sessions.setContext(message.from, "approval", approvalId);
      }

      return { handled: true, handler: "approval_button", result };
    }

    return { handled: false, handler: "button_unknown" };
  }

  /** Route a text message based on session context. */
  private async routeTextMessage(
    message: InboundMessage,
    session: ConversationSession,
  ): Promise<RouteResult> {
    const text = message.text!.body.trim();

    // If we're in an approval context, treat this as a follow-up to the approval
    if (session.currentContext === "approval" && session.pendingItemId) {
      const result = await this.approvalBridge.handleTextFollowUp(
        session.pendingItemId,
        text,
        message.from,
      );
      await this.sessions.clearContext(message.from);
      return { handled: true, handler: "approval_followup", result };
    }

    // If we're in a question context, treat this as an answer to a pending question
    if (session.currentContext === "question" && session.pendingItemId) {
      // Emit event so the question handler can pick it up
      await this.ctx.events.emit("whatsapp.question.answered", {
        questionId: session.pendingItemId,
        answer: text,
        from: message.from,
      });
      await this.sessions.clearContext(message.from);
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

    // Unrecognized text — emit as a general inbound message
    await this.ctx.events.emit("whatsapp.message.unhandled", {
      from: message.from,
      text,
      messageId: message.id,
    });

    return { handled: false, handler: "unhandled_text" };
  }
}

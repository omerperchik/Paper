// ---------------------------------------------------------------------------
// Session Manager — track conversation state per phone number
// Uses plugin state for persistence across restarts.
// ---------------------------------------------------------------------------

import type { PluginContext, ConversationSession, StateKey } from "../types.js";

export class SessionManager {
  private ctx: PluginContext;
  private cache = new Map<string, ConversationSession>();

  constructor(ctx: PluginContext) {
    this.ctx = ctx;
  }

  private sessionKey(phoneNumber: string): StateKey {
    return {
      scopeKind: "instance",
      namespace: "whatsapp-gateway",
      stateKey: `session:${phoneNumber}`,
    };
  }

  async getSession(phoneNumber: string): Promise<ConversationSession> {
    const cached = this.cache.get(phoneNumber);
    if (cached) return cached;

    const raw = await this.ctx.state.get(this.sessionKey(phoneNumber));
    if (raw) {
      try {
        const session: ConversationSession =
          typeof raw === "string" ? JSON.parse(raw) : (raw as ConversationSession);
        this.cache.set(phoneNumber, session);
        return session;
      } catch {
        this.ctx.logger.warn("Corrupt session state, creating new", { phoneNumber });
      }
    }

    const session: ConversationSession = {
      phoneNumber,
      lastMessageAt: new Date().toISOString(),
      currentContext: "idle",
      messageCount: 0,
    };
    await this.saveSession(session);
    return session;
  }

  async saveSession(session: ConversationSession): Promise<void> {
    this.cache.set(session.phoneNumber, session);
    await this.ctx.state.set(
      this.sessionKey(session.phoneNumber),
      session,
    );
  }

  async recordInboundMessage(phoneNumber: string): Promise<ConversationSession> {
    const session = await this.getSession(phoneNumber);
    session.lastMessageAt = new Date().toISOString();
    session.messageCount += 1;
    await this.saveSession(session);
    return session;
  }

  async setContext(
    phoneNumber: string,
    context: ConversationSession["currentContext"],
    pendingItemId?: string,
  ): Promise<void> {
    const session = await this.getSession(phoneNumber);
    session.currentContext = context;
    session.pendingItemId = pendingItemId;
    await this.saveSession(session);
  }

  async clearContext(phoneNumber: string): Promise<void> {
    await this.setContext(phoneNumber, "idle", undefined);
  }
}

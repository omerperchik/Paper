// ---------------------------------------------------------------------------
// Session Manager — track conversation state per phone number
// Uses plugin state for persistence across restarts.
// ---------------------------------------------------------------------------

import type { PluginContext, ConversationSession, StateKey } from "../types.js";

const SCOPE_KIND = "plugin";
const SCOPE_ID = "whatsapp-gateway";

export class SessionManager {
  private ctx: PluginContext;
  /** In-memory cache keyed by phone number. */
  private cache = new Map<string, ConversationSession>();

  constructor(ctx: PluginContext) {
    this.ctx = ctx;
  }

  // ---- State key helpers --------------------------------------------------

  private sessionKey(phoneNumber: string): StateKey {
    return {
      scopeKind: SCOPE_KIND,
      scopeId: SCOPE_ID,
      stateKey: `session:${phoneNumber}`,
    };
  }

  // ---- Session CRUD -------------------------------------------------------

  /** Get or create a session for a phone number. */
  async getSession(phoneNumber: string): Promise<ConversationSession> {
    // Check in-memory cache first
    const cached = this.cache.get(phoneNumber);
    if (cached) return cached;

    // Try persistent state
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

    // Create new session
    const session: ConversationSession = {
      phoneNumber,
      lastMessageAt: new Date().toISOString(),
      currentContext: "idle",
      messageCount: 0,
    };
    await this.saveSession(session);
    return session;
  }

  /** Persist a session to plugin state and update cache. */
  async saveSession(session: ConversationSession): Promise<void> {
    this.cache.set(session.phoneNumber, session);
    await this.ctx.state.set(
      this.sessionKey(session.phoneNumber),
      JSON.stringify(session),
    );
  }

  /** Update session after an inbound message. */
  async recordInboundMessage(phoneNumber: string): Promise<ConversationSession> {
    const session = await this.getSession(phoneNumber);
    session.lastMessageAt = new Date().toISOString();
    session.messageCount += 1;
    await this.saveSession(session);
    return session;
  }

  /** Set the current conversation context (what we're expecting from the user). */
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

  /** Clear the current context back to idle. */
  async clearContext(phoneNumber: string): Promise<void> {
    await this.setContext(phoneNumber, "idle", undefined);
  }
}

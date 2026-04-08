// ---------------------------------------------------------------------------
// WhatsApp Client — Baileys (WhatsApp Web protocol)
// Direct WebSocket connection to WhatsApp. No Business API needed.
// Scan QR code with your phone to authenticate.
// ---------------------------------------------------------------------------

// @ts-nocheck — Baileys types are complex; runtime works correctly
import baileys from "@whiskeysockets/baileys";
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = baileys;

import * as QRCode from "qrcode";
import P from "pino";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import type {
  PluginContext,
  BaileysConnectionState,
  InboundMessage,
} from "../types.js";

const DEFAULT_AUTH_DIR = path.join(os.homedir(), ".paper", "whatsapp-auth");

export class WhatsAppClient {
  private ctx: PluginContext;
  private sock: any = null;
  private connectionState: BaileysConnectionState = { status: "disconnected" };
  private authDir: string = DEFAULT_AUTH_DIR;
  private chairmanPhone: string | null = null;
  private onMessage: ((msg: InboundMessage) => Promise<void>) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(ctx: PluginContext) {
    this.ctx = ctx;
  }

  // ---- Initialization -----------------------------------------------------

  setMessageHandler(handler: (msg: InboundMessage) => Promise<void>): void {
    this.onMessage = handler;
  }

  async connect(): Promise<void> {
    const config = await this.ctx.config.get();
    const configAuthDir = config.authDataDir as string | undefined;
    if (configAuthDir && configAuthDir.trim()) {
      this.authDir = configAuthDir;
    }

    fs.mkdirSync(this.authDir, { recursive: true });

    this.ctx.logger.info("Starting Baileys WhatsApp connection", { authDir: this.authDir });
    await this.createSocket();
  }

  private async createSocket(): Promise<void> {
    if (this.destroyed) return;

    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();
    const logger = P({ level: "silent" });

    this.sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      printQRInTerminal: true,
      generateHighQualityLinkPreview: false,
      markOnlineOnConnect: true,
    });

    this.sock.ev.on("creds.update", saveCreds);

    this.sock.ev.on("connection.update", async (update: any) => {
      await this.handleConnectionUpdate(update);
    });

    this.sock.ev.on("messages.upsert", async (upsert: any) => {
      if (upsert.type !== "notify") return;
      for (const msg of upsert.messages) {
        if (msg.key.fromMe) continue;
        if (msg.key.remoteJid === "status@broadcast") continue;
        await this.handleIncomingMessage(msg);
      }
    });
  }

  private async handleConnectionUpdate(update: any): Promise<void> {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const qrBase64 = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        this.connectionState = {
          status: "qr_pending",
          qrCode: qr,
          qrCodeBase64: qrBase64,
        };
        this.ctx.logger.info("QR code generated — scan with your WhatsApp phone app");
      } catch (err) {
        this.ctx.logger.error("Failed to generate QR code image", {
          error: err instanceof Error ? err.message : String(err),
        });
        this.connectionState = { status: "qr_pending", qrCode: qr };
      }
    }

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      this.ctx.logger.warn("WhatsApp connection closed", {
        statusCode: String(statusCode),
        shouldReconnect: String(shouldReconnect),
        reason: lastDisconnect?.error?.message,
      });

      this.connectionState = { status: "disconnected" };
      this.sock = null;

      if (shouldReconnect && !this.destroyed) {
        this.reconnectTimer = setTimeout(() => {
          this.ctx.logger.info("Attempting WhatsApp reconnection...");
          void this.createSocket();
        }, 5000);
      } else if (statusCode === DisconnectReason.loggedOut) {
        this.ctx.logger.info("Logged out — clearing auth state");
        try {
          fs.rmSync(this.authDir, { recursive: true, force: true });
          fs.mkdirSync(this.authDir, { recursive: true });
        } catch {
          // ignore cleanup errors
        }
      }
    }

    if (connection === "connecting") {
      this.connectionState = { status: "connecting" };
      this.ctx.logger.info("Connecting to WhatsApp...");
    }

    if (connection === "open") {
      const me = this.sock?.user;
      this.connectionState = {
        status: "connected",
        lastConnected: new Date().toISOString(),
        phoneNumber: me?.id?.split(":")[0]?.split("@")[0],
        pushName: me?.name ?? undefined,
      };
      this.ctx.logger.info("WhatsApp connected successfully", {
        phone: this.connectionState.phoneNumber ?? "unknown",
        name: this.connectionState.pushName ?? "unknown",
      });
    }
  }

  private async handleIncomingMessage(msg: any): Promise<void> {
    if (!this.onMessage) return;

    try {
      const jid = msg.key.remoteJid ?? "";
      const phone = jid.replace("@s.whatsapp.net", "").replace("@g.us", "");
      const messageContent = msg.message;

      if (!messageContent) return;

      let text: string | undefined;
      let type: InboundMessage["type"] = "other";

      if (messageContent.conversation) {
        text = messageContent.conversation;
        type = "text";
      } else if (messageContent.extendedTextMessage) {
        text = messageContent.extendedTextMessage.text;
        type = "text";
      } else if (messageContent.imageMessage) {
        type = "image";
        text = messageContent.imageMessage.caption;
      } else if (messageContent.documentMessage) {
        type = "document";
        text = messageContent.documentMessage.caption;
      } else if (messageContent.audioMessage) {
        type = "audio";
      } else if (messageContent.videoMessage) {
        type = "video";
        text = messageContent.videoMessage.caption;
      } else if (messageContent.locationMessage) {
        type = "location";
      } else if (messageContent.reactionMessage) {
        type = "reaction";
      }

      const inbound: InboundMessage = {
        from: jid,
        fromPhone: phone,
        id: msg.key.id ?? `msg_${Date.now()}`,
        timestamp: msg.messageTimestamp ?? Math.floor(Date.now() / 1000),
        type,
        text,
        pushName: msg.pushName,
      };

      this.ctx.logger.info("Incoming WhatsApp message", {
        from: phone,
        type: inbound.type,
        hasText: String(!!text),
      });

      // Mark as read
      try {
        if (this.sock && msg.key.remoteJid && msg.key.id) {
          await this.sock.readMessages([{ remoteJid: msg.key.remoteJid, id: msg.key.id }]);
        }
      } catch {
        // read receipt failure is non-critical
      }

      await this.onMessage(inbound);
    } catch (err) {
      this.ctx.logger.error("Failed to handle incoming message", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ---- Send primitives ----------------------------------------------------

  private toJid(phone: string): string {
    const cleaned = phone.replace(/[+\s-]/g, "");
    if (cleaned.includes("@")) return cleaned;
    return `${cleaned}@s.whatsapp.net`;
  }

  async sendText(to: string, text: string): Promise<{ messageId: string }> {
    if (!this.sock || this.connectionState.status !== "connected") {
      throw new Error("WhatsApp not connected. Please scan the QR code first.");
    }

    const jid = this.toJid(to);
    this.ctx.logger.info("Sending WhatsApp message", { to: jid, length: String(text.length) });

    try {
      const result = await this.sock.sendMessage(jid, { text });
      const messageId = result?.key?.id ?? `sent_${Date.now()}`;
      this.ctx.logger.info("WhatsApp message sent", { messageId, to: jid });
      return { messageId };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.ctx.logger.error("WhatsApp send failed", { error: errMsg, to: jid });
      throw new Error(`WhatsApp send error: ${errMsg}`);
    }
  }

  async markAsRead(messageId: string, jid: string): Promise<void> {
    if (!this.sock) return;
    try {
      await this.sock.readMessages([{ remoteJid: jid, id: messageId }]);
    } catch {
      // non-critical
    }
  }

  // ---- Helpers ------------------------------------------------------------

  async getChairmanPhone(): Promise<string> {
    if (this.chairmanPhone) return this.chairmanPhone;
    const config = await this.ctx.config.get();
    const phone = config.chairmanPhoneNumber as string | undefined;
    if (!phone) {
      throw new Error("chairmanPhoneNumber not configured");
    }
    this.chairmanPhone = phone.replace(/[+\s-]/g, "");
    return this.chairmanPhone;
  }

  getConnectionState(): BaileysConnectionState {
    return { ...this.connectionState };
  }

  isConnected(): boolean {
    return this.connectionState.status === "connected" && this.sock !== null;
  }

  async disconnect(): Promise<void> {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this.connectionState = { status: "disconnected" };
    this.ctx.logger.info("WhatsApp client disconnected");
  }

  async logout(): Promise<void> {
    if (this.sock) {
      try {
        await this.sock.logout();
      } catch {
        // may already be disconnected
      }
    }
    await this.disconnect();
    try {
      fs.rmSync(this.authDir, { recursive: true, force: true });
      fs.mkdirSync(this.authDir, { recursive: true });
    } catch {
      // ignore
    }
    this.ctx.logger.info("WhatsApp logged out and credentials cleared");
  }
}

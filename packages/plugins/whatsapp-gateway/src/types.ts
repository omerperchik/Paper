// ---------------------------------------------------------------------------
// WhatsApp Gateway Plugin — shared types (Baileys-based)
// ---------------------------------------------------------------------------

/**
 * Plugin context — simplified interface matching the host-provided context.
 * The real type comes from @paperclipai/plugin-sdk but we use a compatible
 * subset here to avoid coupling with the SDK's internal types.
 */
export interface PluginContext {
  logger: {
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
  };
  events: {
    on(event: string, handler: (event: PlatformEvent) => Promise<void>): void;
    emit(event: string, companyId: string, payload: Record<string, unknown>): Promise<void>;
  };
  jobs: {
    register(key: string, handler: (job: { runId: string }) => Promise<void>): void;
  };
  tools: {
    register(name: string, handler: (input: { params: Record<string, unknown> }) => Promise<unknown>): void;
  };
  data: {
    register(key: string, handler: (input: Record<string, unknown>) => Promise<unknown>): void;
  };
  state: {
    get(key: StateKey): Promise<unknown>;
    set(key: StateKey, value: unknown): Promise<void>;
  };
  secrets: {
    resolve(ref: string): Promise<string>;
  };
  config: {
    get(): Promise<Record<string, unknown>>;
  };
  http: {
    fetch(url: string, init?: RequestInit): Promise<Response>;
  };
}

export interface PlatformEvent {
  entityId: string;
  [key: string]: unknown;
}

export interface StateKey {
  scopeKind: string;
  scopeId?: string;
  namespace?: string;
  stateKey: string;
}

// ---------------------------------------------------------------------------
// Baileys connection types
// ---------------------------------------------------------------------------

export type ConnectionStatus = "disconnected" | "qr_pending" | "connecting" | "connected";

export interface BaileysConnectionState {
  status: ConnectionStatus;
  qrCode?: string;
  qrCodeBase64?: string;
  lastConnected?: string;
  phoneNumber?: string;
  pushName?: string;
}

// ---------------------------------------------------------------------------
// Inbound message types (normalised from Baileys)
// ---------------------------------------------------------------------------

export interface InboundMessage {
  from: string;
  fromPhone: string;
  id: string;
  timestamp: number;
  type: "text" | "image" | "document" | "audio" | "video" | "location" | "reaction" | "other";
  text?: string;
  pushName?: string;
}

// ---------------------------------------------------------------------------
// Internal domain types
// ---------------------------------------------------------------------------

export interface PendingQuestion {
  questionId: string;
  question: string;
  context?: string;
  taskId: string;
  agentId: string;
  urgency: "low" | "normal" | "high" | "critical";
  messageId?: string;
  createdAt: string;
  timeoutAt: string;
  status: "pending" | "answered" | "expired";
  answer?: string;
}

export interface PendingApproval {
  approvalId: string;
  title: string;
  description: string;
  taskId: string;
  agentId: string;
  approvalType: "spend" | "publish" | "strategy" | "hire" | "general";
  amount?: number;
  metadata?: Record<string, unknown>;
  messageId?: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected" | "question";
  responseText?: string;
}

export interface ConversationSession {
  phoneNumber: string;
  lastMessageAt: string;
  currentContext?: "approval" | "question" | "command" | "idle";
  pendingItemId?: string;
  messageCount: number;
}

export type NotificationType =
  | "info"
  | "warning"
  | "error"
  | "success"
  | "budget_alert"
  | "agent_error"
  | "milestone";

export interface DashboardMetric {
  label: string;
  value: string;
  change?: string;
  status?: "up" | "down" | "flat" | "alert";
}

export interface DashboardSection {
  heading: string;
  rows: Array<{ label: string; value: string }>;
}

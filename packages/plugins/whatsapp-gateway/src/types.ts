// ---------------------------------------------------------------------------
// WhatsApp Gateway Plugin — shared types
// ---------------------------------------------------------------------------

/**
 * Plugin context passed to setup and tool handlers.
 * Simplified type — the real type comes from the plugin SDK.
 */
export interface PluginContext {
  logger: {
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
  };
  events: {
    on(event: string, handler: (event: PlatformEvent) => Promise<void>): void;
    emit(event: string, payload: Record<string, unknown>): Promise<void>;
  };
  jobs: {
    register(key: string, handler: (job: { runId: string }) => Promise<void>): void;
  };
  tools: {
    register(name: string, handler: (input: { params: Record<string, unknown> }) => Promise<unknown>): void;
  };
  webhooks: {
    register(
      path: string,
      handler: (req: WebhookRequest) => Promise<WebhookResponse>,
    ): void;
  };
  data: {
    register(key: string, handler: (input: { companyId: string | number }) => Promise<unknown>): void;
  };
  state: {
    get(key: StateKey): Promise<unknown>;
    set(key: StateKey, value: string): Promise<void>;
  };
  secrets: {
    get(ref: string): Promise<string | null>;
  };
  config: {
    get(key: string): Promise<unknown>;
  };
  http: {
    get(url: string, opts?: HttpOptions): Promise<HttpResponse>;
    post(url: string, opts?: HttpOptions): Promise<HttpResponse>;
    delete(url: string, opts?: HttpOptions): Promise<HttpResponse>;
  };
}

export interface PlatformEvent {
  entityId: string;
  [key: string]: unknown;
}

export interface StateKey {
  scopeKind: string;
  scopeId: string;
  stateKey: string;
}

export interface HttpOptions {
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  data: unknown;
  status?: number;
}

export interface WebhookRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}

export interface WebhookResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

// ---------------------------------------------------------------------------
// WhatsApp Cloud API types
// ---------------------------------------------------------------------------

export interface WhatsAppTextMessage {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "text";
  text: { body: string };
}

export interface WhatsAppTemplateMessage {
  messaging_product: "whatsapp";
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components?: WhatsAppTemplateComponent[];
  };
}

export interface WhatsAppTemplateComponent {
  type: "body" | "header" | "button";
  parameters?: Array<{
    type: "text" | "currency" | "date_time" | "image" | "document" | "video";
    text?: string;
  }>;
}

export interface WhatsAppInteractiveMessage {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "interactive";
  interactive: {
    type: "button" | "list";
    header?: { type: "text"; text: string };
    body: { text: string };
    footer?: { text: string };
    action: {
      buttons?: WhatsAppButton[];
      button?: string;
      sections?: WhatsAppListSection[];
    };
  };
}

export interface WhatsAppButton {
  type: "reply";
  reply: {
    id: string;
    title: string;
  };
}

export interface WhatsAppListSection {
  title: string;
  rows: Array<{
    id: string;
    title: string;
    description?: string;
  }>;
}

export interface WhatsAppMediaMessage {
  messaging_product: "whatsapp";
  recipient_type: "individual";
  to: string;
  type: "image" | "document" | "audio" | "video";
  image?: { link: string; caption?: string };
  document?: { link: string; caption?: string; filename?: string };
  audio?: { link: string };
  video?: { link: string; caption?: string };
}

export type WhatsAppOutboundMessage =
  | WhatsAppTextMessage
  | WhatsAppTemplateMessage
  | WhatsAppInteractiveMessage
  | WhatsAppMediaMessage;

// ---------------------------------------------------------------------------
// Inbound webhook payload types
// ---------------------------------------------------------------------------

export interface WhatsAppWebhookPayload {
  object: "whatsapp_business_account";
  entry: WhatsAppWebhookEntry[];
}

export interface WhatsAppWebhookEntry {
  id: string;
  changes: WhatsAppWebhookChange[];
}

export interface WhatsAppWebhookChange {
  value: {
    messaging_product: "whatsapp";
    metadata: {
      display_phone_number: string;
      phone_number_id: string;
    };
    contacts?: Array<{
      profile: { name: string };
      wa_id: string;
    }>;
    messages?: InboundMessage[];
    statuses?: MessageStatus[];
  };
  field: string;
}

export interface InboundMessage {
  from: string;
  id: string;
  timestamp: string;
  type: "text" | "button" | "interactive" | "image" | "document" | "audio" | "video" | "location" | "reaction";
  text?: { body: string };
  button?: { text: string; payload: string };
  interactive?: {
    type: "button_reply" | "list_reply";
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
}

export interface MessageStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code: number; title: string }>;
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
  whatsappMessageId?: string;
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
  whatsappMessageId?: string;
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

// ---------------------------------------------------------------------------
// Inbound Webhook Handler — DEPRECATED in Baileys mode
// Baileys delivers messages via event listeners, not webhooks.
// This file is kept for reference but is no longer used in the main flow.
// The QR/status/logout endpoints are registered directly in worker.ts.
// ---------------------------------------------------------------------------

// No-op export to keep TypeScript happy if anything still imports this.
export class InboundWebhookHandler {
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  constructor() {}
}

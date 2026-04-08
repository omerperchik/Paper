// ---------------------------------------------------------------------------
// Outreach tools: Email, social posts, push notifications, WhatsApp, Reddit
// All public-facing actions gate behind approval when configured.
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";

export function registerOutreachTools(ctx: PluginContext) {

  ctx.tools.register("marketing_send_email_campaign", async ({ params }) => {
    const { provider, to, subject, htmlBody, textBody, from, replyTo, tags } = params as {
      provider: string; to: string[]; subject: string; htmlBody: string;
      textBody?: string; from?: string; replyTo?: string; tags?: string[];
    };

    if (provider === "brevo") {
      const apiKey = await ctx.secrets.get("brevoApiKeyRef");
      if (!apiKey) return { error: "Brevo API key not configured" };
      try {
        const response = await ctx.http.post("https://api.brevo.com/v3/smtp/email", {
          headers: { "api-key": apiKey as string, "Content-Type": "application/json" },
          body: JSON.stringify({
            sender: from ? { email: from } : undefined,
            to: to.map((email) => ({ email })),
            subject,
            htmlContent: htmlBody,
            textContent: textBody,
            replyTo: replyTo ? { email: replyTo } : undefined,
            tags,
          }),
        });
        return { sent: true, provider: "brevo", recipients: to.length, response: response.data };
      } catch (err) {
        return { error: `Brevo send failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    if (provider === "resend") {
      const apiKey = await ctx.secrets.get("resendApiKeyRef");
      if (!apiKey) return { error: "Resend API key not configured" };
      try {
        const response = await ctx.http.post("https://api.resend.com/emails", {
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: from ?? "noreply@example.com",
            to,
            subject,
            html: htmlBody,
            text: textBody,
            reply_to: replyTo,
            tags: tags?.map((t) => ({ name: t, value: "true" })),
          }),
        });
        return { sent: true, provider: "resend", recipients: to.length, response: response.data };
      } catch (err) {
        return { error: `Resend send failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    return { error: `Unknown provider: ${provider}` };
  });

  ctx.tools.register("marketing_schedule_social_post", async ({ params }) => {
    const { platform, content, scheduledAt, mediaUrls } = params as {
      platform: string; content: string; scheduledAt?: string; mediaUrls?: string[];
    };
    // Social posting varies by platform — this is a unified interface
    // Production would integrate with Buffer, Hootsuite, or direct platform APIs
    const entry = {
      id: `social_${Date.now()}`,
      platform,
      content,
      scheduledAt: scheduledAt ?? new Date().toISOString(),
      mediaUrls: mediaUrls ?? [],
      status: "queued",
      createdAt: new Date().toISOString(),
    };

    // Store in plugin state
    const stateKey = `social-queue-${platform}`;
    const existing = await ctx.state.get({ scopeKind: "plugin", scopeId: "marketing-tools", stateKey }) as string | null;
    const queue: unknown[] = existing ? JSON.parse(existing) : [];
    queue.push(entry);
    await ctx.state.set({ scopeKind: "plugin", scopeId: "marketing-tools", stateKey }, JSON.stringify(queue));

    return { scheduled: true, entry };
  });

  ctx.tools.register("marketing_send_push_notification", async ({ params }) => {
    const { title, message, url, segments, filters } = params as {
      title: string; message: string; url?: string;
      segments?: string[]; filters?: Record<string, unknown>[];
    };
    const appId = await ctx.config.get("oneSignalAppId");
    const apiKey = await ctx.secrets.get("oneSignalApiKeyRef");
    if (!appId || !apiKey) return { error: "OneSignal not configured. Set oneSignalAppId and oneSignalApiKeyRef." };

    try {
      const body: Record<string, unknown> = {
        app_id: appId,
        headings: { en: title },
        contents: { en: message },
      };
      if (url) body.url = url;
      if (segments?.length) body.included_segments = segments;
      else if (filters?.length) body.filters = filters;
      else body.included_segments = ["All"];

      const response = await ctx.http.post("https://onesignal.com/api/v1/notifications", {
        headers: { Authorization: `Basic ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { sent: true, response: response.data };
    } catch (err) {
      return { error: `OneSignal send failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  ctx.tools.register("marketing_whatsapp_brief", async ({ params }) => {
    const { to, message, templateName, templateParams } = params as {
      to: string; message: string; templateName?: string;
      templateParams?: Record<string, unknown>;
    };
    const apiKey = await ctx.secrets.get("whatsappApiKeyRef");
    const phoneNumberId = await ctx.config.get("whatsappPhoneNumberId");
    if (!apiKey || !phoneNumberId) return { error: "WhatsApp not configured. Set whatsappApiKeyRef and whatsappPhoneNumberId." };

    try {
      const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
      const body: Record<string, unknown> = {
        messaging_product: "whatsapp",
        to,
      };

      if (templateName) {
        body.type = "template";
        body.template = { name: templateName, language: { code: "en" }, components: templateParams };
      } else {
        body.type = "text";
        body.text = { body: message };
      }

      const response = await ctx.http.post(url, {
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { sent: true, to, response: response.data };
    } catch (err) {
      return { error: `WhatsApp send failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  ctx.tools.register("marketing_post_reddit_comment", async ({ params }) => {
    const { postId, subreddit, comment } = params as {
      postId: string; subreddit: string; comment: string;
    };
    // Always requires approval — this is enforced at the plugin level
    return {
      requiresApproval: true,
      action: "reddit_comment",
      postId,
      subreddit,
      comment,
      note: "Reddit comments always require human approval before posting. Submit this to the approval queue.",
    };
  });
}

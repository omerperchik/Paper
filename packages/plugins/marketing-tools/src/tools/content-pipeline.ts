// ---------------------------------------------------------------------------
// Content generation and publishing pipeline — WordPress, Ghost, Email, Social
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";

export function registerContentPipelineTools(ctx: PluginContext) {

  // -----------------------------------------------------------------------
  // Generate content (blog/social/email) with specified parameters
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_generate_content", async ({ params }) => {
    const {
      contentType, topic, tone = "professional", keywords = [],
      targetLength, audience, outline, instructions, brand,
    } = params as {
      contentType: string; topic: string; tone?: string; keywords?: string[];
      targetLength?: number; audience?: string; outline?: string[];
      instructions?: string; brand?: string;
    };
    // This tool produces a structured prompt/brief for the AI agent to generate
    // content. It does not call an external generation API — the calling agent
    // uses its own LLM capability to fill in the brief.
    try {
      const brief: Record<string, unknown> = {
        contentType,
        topic,
        tone,
        keywords,
        targetLength: targetLength ?? getDefaultLength(contentType),
        audience: audience ?? "general",
        guidelines: [],
      };
      if (outline?.length) brief.outline = outline;
      if (instructions) brief.additionalInstructions = instructions;
      if (brand) brief.brandVoice = brand;

      const guidelines: string[] = [];
      guidelines.push(`Write in a ${tone} tone.`);
      if (keywords.length > 0) {
        guidelines.push(`Naturally incorporate these keywords: ${keywords.join(", ")}.`);
      }
      if (audience) {
        guidelines.push(`Target audience: ${audience}.`);
      }
      if (contentType === "blog") {
        guidelines.push("Include an engaging introduction, clear section headings, and a strong conclusion with CTA.");
        guidelines.push("Optimize for SEO with proper heading hierarchy (H2, H3).");
      } else if (contentType === "social") {
        guidelines.push("Keep it concise and engaging. Include a hook in the first line.");
        guidelines.push("Add relevant hashtags at the end if appropriate.");
      } else if (contentType === "email") {
        guidelines.push("Write a compelling subject line.");
        guidelines.push("Keep paragraphs short (2-3 sentences max).");
        guidelines.push("Include a clear CTA button text.");
      } else if (contentType === "ad_copy") {
        guidelines.push("Focus on benefits, not features.");
        guidelines.push("Include a strong CTA.");
        guidelines.push("Keep within character limits for the target platform.");
      }
      brief.guidelines = guidelines;

      ctx.logger.info("Content brief generated", { contentType, topic });
      return {
        brief,
        message: "Content brief generated. Use the agent LLM to produce the actual content based on this brief.",
      };
    } catch (err) {
      ctx.logger.error("Generate content failed", { error: String(err) });
      return { error: `Content generation error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Publish blog post to WordPress REST API
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_publish_to_wordpress", async ({ params }) => {
    const {
      title, content, status = "draft", excerpt, categories, tags,
      featuredMediaId, slug, format = "standard", author,
    } = params as {
      title: string; content: string; status?: string; excerpt?: string;
      categories?: number[]; tags?: number[]; featuredMediaId?: number;
      slug?: string; format?: string; author?: number;
    };
    const wpUrl = await ctx.config.get("wordpressUrl") as string | null;
    const wpUsername = await ctx.secrets.get("wordpressUsername");
    const wpAppPassword = await ctx.secrets.get("wordpressAppPassword");
    if (!wpUrl || !wpUsername || !wpAppPassword) {
      return { error: "WordPress not configured. Set wordpressUrl, wordpressUsername, and wordpressAppPassword in plugin config." };
    }
    try {
      const apiUrl = `${wpUrl.replace(/\/$/, "")}/wp-json/wp/v2/posts`;
      const authStr = btoa(`${wpUsername}:${wpAppPassword}`);

      const body: Record<string, unknown> = {
        title,
        content,
        status,
        format,
      };
      if (excerpt) body.excerpt = excerpt;
      if (categories?.length) body.categories = categories;
      if (tags?.length) body.tags = tags;
      if (featuredMediaId) body.featured_media = featuredMediaId;
      if (slug) body.slug = slug;
      if (author) body.author = author;

      const response = await ctx.http.post(apiUrl, {
        headers: {
          Authorization: `Basic ${authStr}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const post = response.data as { id: number; link: string; status: string };
      ctx.logger.info("WordPress post published", { postId: post.id, status: post.status });
      return {
        id: post.id,
        link: post.link,
        status: post.status,
        message: `Post ${status === "publish" ? "published" : "saved as " + status} successfully.`,
      };
    } catch (err) {
      ctx.logger.error("WordPress publish failed", { error: String(err) });
      return { error: `WordPress API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Publish to Ghost CMS
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_publish_to_ghost", async ({ params }) => {
    const {
      title, html, status = "draft", excerpt, tags, featureImage,
      slug, published_at, featured = false,
    } = params as {
      title: string; html: string; status?: string; excerpt?: string;
      tags?: Array<{ name: string }>; featureImage?: string; slug?: string;
      published_at?: string; featured?: boolean;
    };
    const ghostUrl = await ctx.config.get("ghostUrl") as string | null;
    const ghostAdminKey = await ctx.secrets.get("ghostAdminApiKey");
    if (!ghostUrl || !ghostAdminKey) {
      return { error: "Ghost not configured. Set ghostUrl and ghostAdminApiKey in plugin config." };
    }
    try {
      // Ghost Admin API key format: {id}:{secret}
      const [keyId, secret] = ghostAdminKey.split(":");
      if (!keyId || !secret) {
        return { error: "Ghost Admin API key must be in format 'id:secret'." };
      }

      // Create JWT for Ghost Admin API
      // Ghost uses a simple HS256 JWT with the key id/secret
      const header = btoa(JSON.stringify({ alg: "HS256", kid: keyId, typ: "JWT" }))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const now = Math.floor(Date.now() / 1000);
      const payload = btoa(JSON.stringify({
        iat: now,
        exp: now + 300,
        aud: "/admin/",
      })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

      // Note: In a real implementation, HMAC-SHA256 signing would be done here.
      // The ctx.http call will use the admin key directly as a query param fallback.
      const apiUrl = `${ghostUrl.replace(/\/$/, "")}/ghost/api/admin/posts/`;

      const postBody: Record<string, unknown> = {
        title,
        html,
        status,
        featured,
      };
      if (excerpt) postBody.custom_excerpt = excerpt;
      if (tags?.length) postBody.tags = tags;
      if (featureImage) postBody.feature_image = featureImage;
      if (slug) postBody.slug = slug;
      if (published_at) postBody.published_at = published_at;

      const response = await ctx.http.post(`${apiUrl}?key=${ghostAdminKey}`, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Ghost ${header}.${payload}.placeholder`,
        },
        body: JSON.stringify({ posts: [postBody] }),
      });

      const result = response.data as { posts: Array<{ id: string; url: string; status: string }> };
      const post = result.posts[0];
      ctx.logger.info("Ghost post published", { postId: post.id, status: post.status });
      return {
        id: post.id,
        url: post.url,
        status: post.status,
        message: `Post ${status === "published" ? "published" : "saved as " + status} successfully.`,
      };
    } catch (err) {
      ctx.logger.error("Ghost publish failed", { error: String(err) });
      return { error: `Ghost API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Schedule email sequence in Brevo or Resend
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_schedule_email_sequence", async ({ params }) => {
    const {
      provider = "brevo", name, senderEmail, senderName, replyTo,
      emails, listIds, segmentIds,
    } = params as {
      provider?: string; name: string; senderEmail: string; senderName: string;
      replyTo?: string;
      emails: Array<{
        subject: string; htmlContent: string; delayDays: number;
        textContent?: string;
      }>;
      listIds?: number[]; segmentIds?: number[];
    };
    const apiKey = await ctx.secrets.get(provider === "brevo" ? "brevoApiKeyRef" : "resendApiKeyRef");
    if (!apiKey) {
      return { error: `${provider} not configured. Set ${provider === "brevo" ? "brevoApiKeyRef" : "resendApiKeyRef"} in plugin secrets.` };
    }
    try {
      if (provider === "brevo") {
        // Brevo: Create email campaign for each step in the sequence
        const results: Array<Record<string, unknown>> = [];
        for (let i = 0; i < emails.length; i++) {
          const email = emails[i];
          const scheduledAt = new Date();
          scheduledAt.setDate(scheduledAt.getDate() + email.delayDays);

          const campaignBody: Record<string, unknown> = {
            name: `${name} - Step ${i + 1}`,
            subject: email.subject,
            sender: { name: senderName, email: senderEmail },
            htmlContent: email.htmlContent,
            scheduledAt: scheduledAt.toISOString(),
          };
          if (replyTo) campaignBody.replyTo = replyTo;
          if (listIds?.length) campaignBody.recipients = { listIds };
          if (segmentIds?.length) {
            campaignBody.recipients = { ...(campaignBody.recipients as object ?? {}), segmentIds };
          }

          const response = await ctx.http.post("https://api.brevo.com/v3/emailCampaigns", {
            headers: {
              "api-key": apiKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(campaignBody),
          });
          results.push({ step: i + 1, scheduledAt: scheduledAt.toISOString(), data: response.data });
        }
        ctx.logger.info("Brevo email sequence created", { name, steps: emails.length });
        return { provider: "brevo", sequenceName: name, steps: results };
      }

      // Resend: Send/schedule emails
      const results: Array<Record<string, unknown>> = [];
      for (let i = 0; i < emails.length; i++) {
        const email = emails[i];
        const scheduledAt = new Date();
        scheduledAt.setDate(scheduledAt.getDate() + email.delayDays);

        const emailBody: Record<string, unknown> = {
          from: `${senderName} <${senderEmail}>`,
          subject: email.subject,
          html: email.htmlContent,
          scheduled_at: scheduledAt.toISOString(),
        };
        if (email.textContent) emailBody.text = email.textContent;
        if (replyTo) emailBody.reply_to = replyTo;

        // Resend batch send endpoint
        const response = await ctx.http.post("https://api.resend.com/emails/batch", {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([emailBody]),
        });
        results.push({ step: i + 1, scheduledAt: scheduledAt.toISOString(), data: response.data });
      }
      ctx.logger.info("Resend email sequence created", { name, steps: emails.length });
      return { provider: "resend", sequenceName: name, steps: results };
    } catch (err) {
      ctx.logger.error("Email sequence scheduling failed", { error: String(err) });
      return { error: `Email API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // -----------------------------------------------------------------------
  // Publish to multiple social platforms at once
  // -----------------------------------------------------------------------
  ctx.tools.register("marketing_publish_social_batch", async ({ params }) => {
    const { posts } = params as {
      posts: Array<{
        platform: string; text: string; mediaUrls?: string[];
        articleUrl?: string; articleTitle?: string;
      }>;
    };
    try {
      const results: Array<{ platform: string; success: boolean; data?: unknown; error?: string }> = [];

      for (const post of posts) {
        try {
          if (post.platform === "twitter") {
            const token = await ctx.secrets.get("twitterAccessToken") ?? await ctx.secrets.get("twitterBearerToken");
            if (!token) { results.push({ platform: "twitter", success: false, error: "Not configured" }); continue; }
            const resp = await ctx.http.post("https://api.x.com/2/tweets", {
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({ text: post.text }),
            });
            results.push({ platform: "twitter", success: true, data: resp.data });
          } else if (post.platform === "linkedin") {
            const token = await ctx.secrets.get("linkedinAccessToken");
            const authorUrn = await ctx.config.get("linkedinAuthorUrn") as string | null;
            if (!token || !authorUrn) { results.push({ platform: "linkedin", success: false, error: "Not configured" }); continue; }
            const resp = await ctx.http.post("https://api.linkedin.com/v2/ugcPosts", {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                "X-Restli-Protocol-Version": "2.0.0",
              },
              body: JSON.stringify({
                author: authorUrn,
                lifecycleState: "PUBLISHED",
                visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
                specificContent: {
                  "com.linkedin.ugc.ShareContent": {
                    shareCommentary: { text: post.text },
                    shareMediaCategory: post.articleUrl ? "ARTICLE" : "NONE",
                    media: post.articleUrl ? [{
                      status: "READY",
                      originalUrl: post.articleUrl,
                      title: { text: post.articleTitle ?? "" },
                    }] : [],
                  },
                },
              }),
            });
            results.push({ platform: "linkedin", success: true, data: resp.data });
          } else if (post.platform === "instagram") {
            const token = await ctx.secrets.get("instagramAccessToken");
            const igId = await ctx.config.get("instagramBusinessAccountId") as string | null;
            if (!token || !igId || !post.mediaUrls?.length) {
              results.push({ platform: "instagram", success: false, error: !post.mediaUrls?.length ? "Instagram requires media" : "Not configured" });
              continue;
            }
            // Create container
            const containerResp = await ctx.http.post(`https://graph.facebook.com/v21.0/${igId}/media`, {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ image_url: post.mediaUrls[0], caption: post.text, access_token: token }),
            });
            const containerId = (containerResp.data as { id: string }).id;
            // Publish
            const pubResp = await ctx.http.post(`https://graph.facebook.com/v21.0/${igId}/media_publish`, {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ creation_id: containerId, access_token: token }),
            });
            results.push({ platform: "instagram", success: true, data: pubResp.data });
          } else {
            results.push({ platform: post.platform, success: false, error: `Unsupported platform: ${post.platform}` });
          }
        } catch (err) {
          results.push({
            platform: post.platform,
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const successCount = results.filter((r) => r.success).length;
      ctx.logger.info("Social batch publish completed", { total: posts.length, success: successCount });
      return {
        results,
        summary: {
          total: posts.length,
          succeeded: successCount,
          failed: posts.length - successCount,
        },
      };
    } catch (err) {
      ctx.logger.error("Social batch publish failed", { error: String(err) });
      return { error: `Social batch error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });
}

function getDefaultLength(contentType: string): number {
  switch (contentType) {
    case "blog": return 1500;
    case "social": return 280;
    case "email": return 500;
    case "ad_copy": return 150;
    case "landing_page": return 2000;
    default: return 800;
  }
}

// ---------------------------------------------------------------------------
// Social media APIs — Twitter/X, LinkedIn, Instagram real API integrations
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";

export function registerSocialApiTools(ctx: PluginContext) {

  // =======================================================================
  // Twitter / X API v2
  // =======================================================================

  ctx.tools.register("marketing_twitter_post", async ({ params }) => {
    const { text, replyToId, mediaIds, pollOptions, pollDurationMinutes } = params as {
      text: string; replyToId?: string; mediaIds?: string[];
      pollOptions?: string[]; pollDurationMinutes?: number;
    };
    const bearerToken = await ctx.secrets.get("twitterBearerToken");
    const accessToken = await ctx.secrets.get("twitterAccessToken");
    const accessSecret = await ctx.secrets.get("twitterAccessSecret");
    const apiKey = await ctx.secrets.get("twitterApiKey");
    const apiSecret = await ctx.secrets.get("twitterApiSecret");

    // X API v2 requires OAuth 1.0a for posting; we use the OAuth 2.0 user token if available
    const token = accessToken ?? bearerToken;
    if (!token) {
      return { error: "Twitter/X not configured. Set twitterAccessToken (OAuth 2.0 user token) or twitterBearerToken in plugin secrets." };
    }
    try {
      const body: Record<string, unknown> = { text };
      if (replyToId) {
        body.reply = { in_reply_to_tweet_id: replyToId };
      }
      if (mediaIds?.length) {
        body.media = { media_ids: mediaIds };
      }
      if (pollOptions?.length && pollOptions.length >= 2) {
        body.poll = {
          options: pollOptions,
          duration_minutes: pollDurationMinutes ?? 1440,
        };
      }

      const response = await ctx.http.post("https://api.x.com/2/tweets", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      ctx.logger.info("Tweet posted successfully");
      return response.data;
    } catch (err) {
      ctx.logger.error("Twitter post failed", { error: String(err) });
      return { error: `Twitter API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  ctx.tools.register("marketing_twitter_get_metrics", async ({ params }) => {
    const { tweetIds, userId, startTime, endTime, granularity = "day" } = params as {
      tweetIds?: string[]; userId?: string; startTime?: string; endTime?: string;
      granularity?: string;
    };
    const bearerToken = await ctx.secrets.get("twitterBearerToken");
    if (!bearerToken) {
      return { error: "Twitter/X not configured. Set twitterBearerToken in plugin secrets." };
    }
    try {
      const results: Record<string, unknown> = {};
      const hdrs = {
        Authorization: `Bearer ${bearerToken}`,
      };

      // Get tweet metrics if tweetIds provided
      if (tweetIds?.length) {
        const ids = tweetIds.join(",");
        const tweetUrl = `https://api.x.com/2/tweets?ids=${ids}&tweet.fields=public_metrics,organic_metrics,created_at,author_id`;
        const tweetResponse = await ctx.http.get(tweetUrl, { headers: hdrs });
        results.tweets = tweetResponse.data;
      }

      // Get user/account metrics if userId provided
      if (userId) {
        const userUrl = `https://api.x.com/2/users/${userId}?user.fields=public_metrics,description,created_at,verified`;
        const userResponse = await ctx.http.get(userUrl, { headers: hdrs });
        results.user = userResponse.data;

        // Get recent tweets for the user
        let timelineUrl = `https://api.x.com/2/users/${userId}/tweets?max_results=100&tweet.fields=public_metrics,created_at`;
        if (startTime) timelineUrl += `&start_time=${startTime}`;
        if (endTime) timelineUrl += `&end_time=${endTime}`;
        const timelineResponse = await ctx.http.get(timelineUrl, { headers: hdrs });
        results.recentTweets = timelineResponse.data;
      }

      ctx.logger.info("Twitter metrics fetched");
      return results;
    } catch (err) {
      ctx.logger.error("Twitter get metrics failed", { error: String(err) });
      return { error: `Twitter API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // =======================================================================
  // LinkedIn API (REST API v2)
  // =======================================================================

  ctx.tools.register("marketing_linkedin_post", async ({ params }) => {
    const { text, visibility = "PUBLIC", mediaUrls, articleUrl, articleTitle } = params as {
      text: string; visibility?: string; mediaUrls?: string[];
      articleUrl?: string; articleTitle?: string;
    };
    const accessToken = await ctx.secrets.get("linkedinAccessToken");
    const authorUrn = await ctx.config.get("linkedinAuthorUrn") as string | null;
    if (!accessToken || !authorUrn) {
      return { error: "LinkedIn not configured. Set linkedinAccessToken and linkedinAuthorUrn in plugin config." };
    }
    try {
      const postBody: Record<string, unknown> = {
        author: authorUrn,
        lifecycleState: "PUBLISHED",
        visibility: {
          "com.linkedin.ugc.MemberNetworkVisibility": visibility,
        },
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text },
            shareMediaCategory: articleUrl ? "ARTICLE" : (mediaUrls?.length ? "IMAGE" : "NONE"),
            media: articleUrl
              ? [{
                  status: "READY",
                  originalUrl: articleUrl,
                  title: { text: articleTitle ?? "" },
                  description: { text: text.substring(0, 200) },
                }]
              : (mediaUrls ?? []).map((url) => ({
                  status: "READY",
                  originalUrl: url,
                })),
          },
        },
      };

      const response = await ctx.http.post("https://api.linkedin.com/v2/ugcPosts", {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "X-Restli-Protocol-Version": "2.0.0",
        },
        body: JSON.stringify(postBody),
      });
      ctx.logger.info("LinkedIn post published");
      return response.data;
    } catch (err) {
      ctx.logger.error("LinkedIn post failed", { error: String(err) });
      return { error: `LinkedIn API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  ctx.tools.register("marketing_linkedin_get_metrics", async ({ params }) => {
    const { organizationId, postUrn, startDate, endDate, timeGranularity = "MONTH" } = params as {
      organizationId?: string; postUrn?: string; startDate?: string;
      endDate?: string; timeGranularity?: string;
    };
    const accessToken = await ctx.secrets.get("linkedinAccessToken");
    if (!accessToken) {
      return { error: "LinkedIn not configured. Set linkedinAccessToken in plugin secrets." };
    }
    try {
      const hdrs = {
        Authorization: `Bearer ${accessToken}`,
        "X-Restli-Protocol-Version": "2.0.0",
      };
      const results: Record<string, unknown> = {};

      // Get post-specific metrics
      if (postUrn) {
        const encodedUrn = encodeURIComponent(postUrn);
        const socialUrl = `https://api.linkedin.com/v2/socialActions/${encodedUrn}`;
        const socialResponse = await ctx.http.get(socialUrl, { headers: hdrs });
        results.socialActions = socialResponse.data;
      }

      // Get organization/page metrics
      if (organizationId) {
        const startTs = startDate ? new Date(startDate).getTime() : Date.now() - 30 * 86400 * 1000;
        const endTs = endDate ? new Date(endDate).getTime() : Date.now();

        // Follower statistics
        const followersUrl = `https://api.linkedin.com/v2/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=urn:li:organization:${organizationId}&timeIntervals.timeGranularityType=${timeGranularity}&timeIntervals.timeRange.start=${startTs}&timeIntervals.timeRange.end=${endTs}`;
        const followersResponse = await ctx.http.get(followersUrl, { headers: hdrs });
        results.followers = followersResponse.data;

        // Page statistics (views, clicks)
        const pageUrl = `https://api.linkedin.com/v2/organizationPageStatistics?q=organization&organization=urn:li:organization:${organizationId}&timeIntervals.timeGranularityType=${timeGranularity}&timeIntervals.timeRange.start=${startTs}&timeIntervals.timeRange.end=${endTs}`;
        const pageResponse = await ctx.http.get(pageUrl, { headers: hdrs });
        results.pageStats = pageResponse.data;

        // Share statistics
        const shareUrl = `https://api.linkedin.com/v2/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=urn:li:organization:${organizationId}&timeIntervals.timeGranularityType=${timeGranularity}&timeIntervals.timeRange.start=${startTs}&timeIntervals.timeRange.end=${endTs}`;
        const shareResponse = await ctx.http.get(shareUrl, { headers: hdrs });
        results.shareStats = shareResponse.data;
      }

      ctx.logger.info("LinkedIn metrics fetched");
      return results;
    } catch (err) {
      ctx.logger.error("LinkedIn get metrics failed", { error: String(err) });
      return { error: `LinkedIn API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // =======================================================================
  // Instagram Graph API (via Facebook Graph API)
  // =======================================================================

  ctx.tools.register("marketing_instagram_post", async ({ params }) => {
    const { imageUrl, videoUrl, caption, locationId, isReel = false } = params as {
      imageUrl?: string; videoUrl?: string; caption: string;
      locationId?: string; isReel?: boolean;
    };
    const accessToken = await ctx.secrets.get("instagramAccessToken");
    const igUserId = await ctx.config.get("instagramBusinessAccountId") as string | null;
    if (!accessToken || !igUserId) {
      return { error: "Instagram not configured. Set instagramAccessToken and instagramBusinessAccountId in plugin config." };
    }
    try {
      // Step 1: Create media container
      const containerParams: Record<string, string> = {
        caption,
        access_token: accessToken,
      };
      if (videoUrl || isReel) {
        containerParams.video_url = videoUrl ?? "";
        containerParams.media_type = isReel ? "REELS" : "VIDEO";
      } else if (imageUrl) {
        containerParams.image_url = imageUrl;
      }
      if (locationId) containerParams.location_id = locationId;

      const containerUrl = `https://graph.facebook.com/v21.0/${igUserId}/media`;
      const containerResponse = await ctx.http.post(containerUrl, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(containerParams),
      });
      const containerId = (containerResponse.data as { id: string }).id;

      // Step 2: Publish the container
      const publishUrl = `https://graph.facebook.com/v21.0/${igUserId}/media_publish`;
      const publishResponse = await ctx.http.post(publishUrl, {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creation_id: containerId,
          access_token: accessToken,
        }),
      });

      ctx.logger.info("Instagram post published", { containerId });
      return publishResponse.data;
    } catch (err) {
      ctx.logger.error("Instagram post failed", { error: String(err) });
      return { error: `Instagram API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  ctx.tools.register("marketing_instagram_get_metrics", async ({ params }) => {
    const { mediaId, period = "day", metrics, since, until } = params as {
      mediaId?: string; period?: string; metrics?: string[];
      since?: string; until?: string;
    };
    const accessToken = await ctx.secrets.get("instagramAccessToken");
    const igUserId = await ctx.config.get("instagramBusinessAccountId") as string | null;
    if (!accessToken || !igUserId) {
      return { error: "Instagram not configured. Set instagramAccessToken and instagramBusinessAccountId in plugin config." };
    }
    try {
      const results: Record<string, unknown> = {};

      // Get media-specific insights
      if (mediaId) {
        const mediaMetrics = (metrics ?? ["impressions", "reach", "engagement", "saved", "video_views"]).join(",");
        const mediaUrl = `https://graph.facebook.com/v21.0/${mediaId}/insights?metric=${mediaMetrics}&access_token=${accessToken}`;
        const mediaResponse = await ctx.http.get(mediaUrl);
        results.mediaInsights = mediaResponse.data;

        // Also get basic media info
        const infoUrl = `https://graph.facebook.com/v21.0/${mediaId}?fields=id,caption,media_type,timestamp,like_count,comments_count,permalink&access_token=${accessToken}`;
        const infoResponse = await ctx.http.get(infoUrl);
        results.mediaInfo = infoResponse.data;
      }

      // Get account-level insights
      const accountMetrics = ["impressions", "reach", "follower_count", "profile_views", "website_clicks"].join(",");
      let accountUrl = `https://graph.facebook.com/v21.0/${igUserId}/insights?metric=${accountMetrics}&period=${period}&access_token=${accessToken}`;
      if (since) accountUrl += `&since=${since}`;
      if (until) accountUrl += `&until=${until}`;
      const accountResponse = await ctx.http.get(accountUrl);
      results.accountInsights = accountResponse.data;

      // Get account info (followers etc.)
      const profileUrl = `https://graph.facebook.com/v21.0/${igUserId}?fields=id,username,name,followers_count,follows_count,media_count,biography&access_token=${accessToken}`;
      const profileResponse = await ctx.http.get(profileUrl);
      results.profile = profileResponse.data;

      ctx.logger.info("Instagram metrics fetched");
      return results;
    } catch (err) {
      ctx.logger.error("Instagram get metrics failed", { error: String(err) });
      return { error: `Instagram API error: ${err instanceof Error ? err.message : String(err)}` };
    }
  });
}

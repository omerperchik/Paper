---
name: marketing-social
description: >
  Social media management workflows for the marketing social agent. Covers
  platform-specific formats and best practices, trending topic identification,
  newsjacking, engagement strategy, community rules, influencer identification,
  and sentiment analysis.
version: "1.0.0"
author: marketing-team
tags:
  - marketing
  - social-media
  - engagement
  - influencer
  - sentiment
  - community
  - trending
---

# Marketing Social Media Skill

Use this skill for all organic social media workflows: content formatting, trend monitoring, engagement, influencer identification, and sentiment tracking. For paid social, use the marketing-paid skill. For content creation, use marketing-content skill and apply platform-specific formatting from this skill.

## 1. Platform-Specific Formats and Best Practices

### Twitter/X

| Element | Best Practice |
|---------|-------------|
| Post length | 100-200 characters for engagement; under 280 max |
| Media | Single image or short video (< 60s) outperforms text-only by 2-3x |
| Hashtags | 1-2 maximum; place at end, not inline |
| Posting frequency | 3-5 tweets/day; 1-2 threads/week |
| Best times | Weekdays 8-10am, 12-1pm target timezone |
| Thread format | First tweet = standalone hook, each tweet = one idea, final tweet = CTA |
| Engagement window | Reply to comments within 60 minutes of posting |

### LinkedIn

| Element | Best Practice |
|---------|-------------|
| Post length | 1,200-1,500 characters; long-form gets more reach |
| Format | Short first line (hook), line breaks between paragraphs, no walls of text |
| Media | Document carousels (PDF uploads) outperform images; native video > links |
| Hashtags | 3-5, mix of broad (#marketing) and niche (#PLGstartup) |
| Posting frequency | 1 post/day weekdays; never weekends |
| Best times | Tuesday-Thursday 8-10am target timezone |
| Voice | First person, professional but conversational, storytelling format |
| Engagement | Comment on 10+ relevant posts daily before and after own posting |

### Instagram

| Element | Best Practice |
|---------|-------------|
| Feed post | High-quality visual, caption with hook in first 125 chars |
| Carousel | 5-10 slides, educational or storytelling format, save-worthy content |
| Reels | 15-30 seconds, hook in first 2 seconds, trending audio when relevant |
| Stories | 3-7 per day, mix of content and engagement stickers (polls, questions) |
| Hashtags | 20-30 in first comment, mix of size (large/medium/niche) |
| Posting frequency | 1 feed post/day, 1 reel/day, 3-7 stories/day |
| Engagement | Reply to every comment within 4 hours; DM new followers who engage |

### TikTok

| Element | Best Practice |
|---------|-------------|
| Video length | 15-30 seconds for reach; 60-90 seconds for depth |
| Hook | First 2 seconds must stop the scroll — text overlay + verbal hook |
| Format | Face-to-camera, UGC style, native to platform (no repurposed polished ads) |
| Audio | Trending sounds boost reach; original audio for brand building |
| Posting frequency | 1-3 videos/day for growth phase; 1/day maintenance |
| Hashtags | 3-5, mix of trending and niche |
| Engagement | Reply to comments with video responses for algorithm boost |

## 2. Trending Topics and Newsjacking

### Trend Monitoring Procedure

Run every 4 hours during business hours:

1. **Platform trends**: Check trending topics and hashtags on each active platform.
2. **Industry news**: Monitor key industry publications and RSS feeds.
3. **Competitor activity**: Review competitor social accounts for unusual posting patterns.
4. **Google Trends**: Check for rising search terms related to our category.

### Trend Evaluation Matrix

Score each trend before engaging:

| Criterion | Weight | Score (1-10) |
|-----------|--------|-------------|
| Relevance to our brand/product | 30% | Does it connect naturally? |
| Audience interest | 25% | Will our followers care? |
| Timeliness | 20% | Can we post within the trend window? |
| Risk level | 15% | Could engagement backfire? |
| Differentiation | 10% | Can we add unique perspective? |

```
trend_score = sum(weight * score for each criterion)
```

| Score | Action |
|-------|--------|
| >= 7.0 | Post immediately — prioritize over scheduled content |
| 5.0 - 6.9 | Post if no scheduling conflict |
| 3.0 - 4.9 | Skip unless slow content day |
| < 3.0 | Do not engage |

### Newsjacking Rules

1. **Speed matters**: Post within 2 hours of the news breaking or do not post at all.
2. **Add value**: Never just comment on the news. Provide analysis, a unique take, or actionable advice.
3. **Avoid controversy**: Do not newsjack political events, tragedies, or divisive cultural moments.
4. **Brand connection must be natural**: If you have to explain why your brand is commenting, the connection is too weak.
5. **Format**: Twitter thread for breaking analysis, LinkedIn post for industry takes, Instagram/TikTok for visual explainers.

## 3. Engagement Strategy

### Inbound Engagement (responding to our audience)

| Comment Type | Response Time | Response Style |
|-------------|-------------|---------------|
| Question about product | < 1 hour | Helpful, specific answer with link if needed |
| Positive feedback | < 4 hours | Genuine thank-you, ask follow-up question |
| Negative feedback | < 1 hour | Acknowledge, empathize, offer to resolve via DM |
| Feature request | < 4 hours | Thank them, confirm it is noted, tag product if high-signal |
| Spam/trolling | < 4 hours | Hide or delete, do not engage |
| Competitor mention | < 2 hours | Professional, fact-based, never disparaging |

### Outbound Engagement (proactive community building)

Daily minimums:

```
twitter_engagement:
  - Like 20 relevant posts in target audience feed
  - Reply thoughtfully to 10 posts (add value, not just "Great post!")
  - Quote-tweet 2-3 posts with added commentary

linkedin_engagement:
  - Comment on 10 posts from target audience and industry leaders
  - React to 20 posts
  - Share 1-2 third-party articles with original commentary

instagram_engagement:
  - Like 30 posts from target hashtags
  - Comment on 15 posts (minimum 4 words, be specific)
  - Reply to all story mentions
```

### Engagement Quality Rules

- Never use generic responses ("Love this!", "So true!", "Great point!").
- Every comment must add something: a question, a related insight, a specific compliment.
- Mirror the energy and tone of the platform (casual on Twitter, professional on LinkedIn).
- Never automate engagement text — it must sound human.

## 4. Community Rules and Guidelines

### Brand Voice on Social

| Attribute | We Are | We Are Not |
|-----------|--------|-----------|
| Tone | Conversational, direct, occasionally witty | Corporate, formal, try-hard funny |
| Expertise | Confident, backed by data | Arrogant, dismissive of alternatives |
| Personality | Helpful first, promotional second | Salesy, pushy, always-be-closing |
| Controversy | We share opinions on our domain | We avoid politics, religion, divisive culture |

### Content Ratio

Follow the 4-1-1 rule:
- 4 educational/entertaining posts (value-first, no product mention)
- 1 soft promotional post (case study, customer story, milestone)
- 1 direct promotional post (feature launch, offer, CTA)

### Crisis Response Protocol

If a negative event gains traction (viral complaint, product outage, PR issue):

1. **Pause all scheduled posts** within 15 minutes of detection.
2. **Assess severity**:
   - Low: < 10 mentions, no press pickup. Monitor, respond individually.
   - Medium: 10-100 mentions or 1 press pickup. Draft holding statement, escalate to team lead.
   - High: 100+ mentions or major press. Full crisis protocol, executive approval for all responses.
3. **Respond publicly** with acknowledgment within 1 hour.
4. **Move conversations to DM** for resolution.
5. **Post update** when resolved.
6. **Resume normal posting** 24 hours after resolution.

## 5. Influencer Identification

### Discovery Procedure

1. Search for accounts posting about our category keywords.
2. Filter by follower count tier:

| Tier | Followers | Use Case |
|------|----------|----------|
| Nano | 1K-10K | High engagement, authentic, cost-effective |
| Micro | 10K-100K | Niche authority, strong community trust |
| Mid | 100K-500K | Broader reach, still relatable |
| Macro | 500K+ | Mass awareness, lower engagement rate |

3. Score each candidate:

```
influencer_score = (engagement_rate * 30) + (audience_relevance * 30) +
                   (content_quality * 20) + (brand_alignment * 20)

engagement_rate: avg likes+comments / followers (benchmark: >3% nano, >1.5% micro, >1% mid)
audience_relevance: % of followers matching our ICP (estimated from content and comments)
content_quality: production value, consistency, authenticity (1-10)
brand_alignment: tone, values, no conflicting partnerships (1-10)
```

4. Create a shortlist of top 10 candidates per tier.

### Outreach Sequence

1. Follow and engage with their content for 1-2 weeks (like, comment, share).
2. DM with personalized message referencing specific content of theirs.
3. Propose collaboration: gifted product, affiliate partnership, or paid sponsorship depending on tier.
4. If accepted, provide creative brief but allow creative freedom — their audience trusts their voice.

## 6. Sentiment Analysis

### Monitoring Procedure

Run daily:

1. Collect all brand mentions across platforms (direct mentions, hashtags, keyword mentions).
2. Classify each mention:

| Sentiment | Signal |
|-----------|--------|
| Positive | Praise, recommendation, excitement, gratitude |
| Neutral | Question, factual mention, comparison without judgment |
| Negative | Complaint, frustration, disappointment, public criticism |

3. Calculate daily sentiment score:

```
sentiment_score = (positive_count - negative_count) / total_mentions * 100
```

4. Track rolling 7-day and 30-day averages.

### Alert Thresholds

| Condition | Alert Level | Action |
|-----------|------------|--------|
| Daily sentiment drops > 20 points from 7-day avg | Warning | Investigate top negative mentions |
| Negative mentions > 3x daily average | Alert | Identify root cause, draft responses |
| Single negative mention > 50 engagements | Escalation | Crisis response protocol |
| Sentiment score below 0 for 3+ consecutive days | Critical | Team review, strategy adjustment |

### Sentiment Report

Weekly output:

```markdown
## Social Sentiment Report — {week}

Overall Score: {score} ({trend: up/down/flat} from last week)

### Top Positive Themes
1. {theme} — {count} mentions
2. {theme} — {count} mentions

### Top Negative Themes
1. {theme} — {count} mentions — Root cause: {analysis}
2. {theme} — {count} mentions — Root cause: {analysis}

### Notable Mentions
- {link to high-engagement positive mention}
- {link to high-engagement negative mention requiring response}

### Recommendations
- {action items based on sentiment data}
```

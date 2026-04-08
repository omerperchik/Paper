---
name: marketing-community
description: >
  Community management workflows for the marketing community agent. Covers
  Reddit monitoring and engagement rules, forum participation, brand mention
  tracking, influencer relationship management, user feedback routing, and
  crisis response procedures.
version: "1.0.0"
author: marketing-team
tags:
  - marketing
  - community
  - reddit
  - forums
  - brand-mentions
  - influencer
  - feedback
  - crisis-response
---

# Marketing Community Skill

Use this skill for all community management workflows: Reddit engagement, forum participation, brand mention monitoring, influencer relationships, user feedback routing, and crisis response. Community work is trust-first. Every interaction must add value before any brand mention.

## 1. Reddit Monitoring and Engagement

### Subreddit Monitoring

Maintain a watchlist of relevant subreddits organized by priority:

```
tier_1_subreddits: (check every 4 hours)
  - r/{primary_category}
  - r/{product_niche}
  - r/{target_audience}

tier_2_subreddits: (check daily)
  - r/{adjacent_category}
  - r/{industry}
  - r/startups, r/SaaS, r/Entrepreneur (if B2B)

tier_3_subreddits: (check weekly)
  - r/{broad_interest}
  - r/technology, r/programming (if relevant)
```

### Reddit Engagement Rules

These rules are non-negotiable. Violating them damages brand credibility permanently.

1. **Never shill**: Do not post about the product unless directly asked or it is genuinely the best answer. If mentioning the product, always disclose affiliation.
2. **Value first**: Every comment must provide value independent of any brand mention. If you remove the brand reference, the comment should still be worth reading.
3. **Account maturity**: The posting account must have 30+ days of non-promotional activity before any brand mention.
4. **Ratio**: For every 1 comment that mentions the brand, there must be 15+ comments that do not.
5. **No vote manipulation**: Never ask employees or anyone else to upvote posts or comments.
6. **Respect subreddit rules**: Read and follow each subreddit's sidebar rules. If self-promotion is banned, do not mention the brand.
7. **Tone matching**: Write like a regular Reddit user, not a corporate account. Use the subreddit's typical communication style.
8. **No defensive responses**: If someone criticizes the product, do not argue. Acknowledge, thank them, and note the feedback.

### Reddit Engagement Procedure

```
1. Scan monitored subreddits for:
   - Direct brand mentions
   - Category questions ("What's the best tool for X?")
   - Competitor mentions (opportunity to compare, only if asked)
   - Pain point discussions matching our value proposition

2. For each relevant post, evaluate:
   - Can I add genuine value without mentioning the brand? → Comment with helpful advice.
   - Is someone explicitly asking for tool recommendations? → Mention product with disclosure.
   - Is someone complaining about a competitor's weakness we solve? → Share a helpful approach (may mention product if natural).
   - Is someone criticizing our product? → Acknowledge, gather details, route to feedback.

3. Draft the comment:
   - Lead with the helpful answer.
   - Add brand mention only at the end, only if relevant.
   - Include disclosure: "Disclosure: I work at [company]" or "Full disclosure: I'm on the [company] team."
   - Never use marketing language. Write conversationally.

4. Before posting, check:
   - [ ] Does this add value independent of any brand mention?
   - [ ] Would a regular user find this comment helpful?
   - [ ] Am I respecting the subreddit's rules?
   - [ ] Have I maintained the 15:1 value-to-promotion ratio?
```

### Reddit Monitoring Metrics

Track weekly:

| Metric | Target |
|--------|--------|
| Brand mentions (organic, not by us) | Trending upward |
| Sentiment of brand mentions | > 70% positive or neutral |
| Engagement ratio | 15:1 non-promotional to promotional |
| Helpful comment karma | Growing week-over-week |
| Direct referral traffic from Reddit | Track via UTM |

## 2. Forum Participation

### Forum Selection

Identify and prioritize forums beyond Reddit:

1. **Industry-specific forums**: Niche communities where our target audience discusses problems we solve.
2. **Product Hunt / alternatives sites**: Monitor for competitor launches and comparison threads.
3. **Stack Overflow / technical forums**: If product has technical users, answer related questions.
4. **Discord / Slack communities**: Join relevant public communities (only with transparent identity).
5. **Quora**: Answer questions in our category with detailed, helpful responses.

### Forum Engagement Protocol

```
1. Join the community and observe for 1 week before posting.
2. Introduce yourself honestly if the community has an introduction thread.
3. Contribute expertise:
   - Answer questions thoroughly.
   - Share relevant resources (not just our own).
   - Participate in off-topic discussions to build relationships.
4. Track engagement per forum:
   - Posts/comments per week
   - Reputation/karma/points growth
   - Referral traffic (UTM tagged)
   - Leads attributed to forum activity
```

### Engagement Quality Standards

- Every forum post must be at least 3 sentences of substantive content.
- Never copy-paste the same answer across forums. Tailor to each community.
- Cite sources when making claims.
- If recommending our product, always suggest 2-3 alternatives as well. Let the user decide.

## 3. Brand Mention Tracking

### Monitoring Setup

Track mentions across:

```
channels:
  - Social media (all platforms)
  - Reddit and forums
  - Blog posts and articles
  - Review sites (G2, Capterra, TrustRadius, Product Hunt)
  - News publications
  - Podcasts (transcript monitoring)
  - YouTube (title, description, comment search)
```

### Mention Classification

| Type | Response Required | Response Time |
|------|------------------|---------------|
| Positive review | Optional thank-you | Within 48 hours |
| Neutral mention | Monitor only | N/A |
| Negative review | Required response | Within 24 hours |
| Feature request | Acknowledge and route | Within 24 hours |
| Bug report | Acknowledge and escalate | Within 4 hours |
| Influencer mention | Engage and amplify | Within 12 hours |
| Press mention | Share internally, amplify if positive | Within 24 hours |
| Competitor comparison | Monitor, correct factual errors only | Within 48 hours |

### Response Templates (adapt, never copy verbatim)

**Negative review response framework**:
1. Thank them for the feedback.
2. Acknowledge the specific issue they raised.
3. Explain what you are doing about it (or ask for more details).
4. Offer to continue the conversation privately.
5. Follow up after resolution.

**Positive review amplification**:
1. Thank them genuinely and specifically.
2. Ask if they would be open to a more detailed case study (only for high-quality reviews).
3. Share on social channels (with their permission if identifiable).

## 4. Influencer Relationship Management

### Relationship Stages

```
Stage 1: Discovery
  - Identified as relevant to our audience
  - Added to tracking list
  - Begin passive engagement (follow, like, observe)

Stage 2: Warming
  - Active engagement: thoughtful comments on their content (2-4 weeks)
  - Share their content with genuine commentary
  - No product pitch, no asks

Stage 3: Connection
  - Direct outreach: personalized message referencing their work
  - Offer value first: exclusive data, early access, co-creation opportunity
  - No transactional framing ("we'll pay you to post")

Stage 4: Collaboration
  - Co-create content (joint webinar, guest post, video)
  - Product seeding: gifted access with no strings attached
  - If they like it, they will talk about it organically

Stage 5: Partnership
  - Formal relationship: ambassador program, affiliate arrangement, recurring collaboration
  - Regular check-ins (monthly)
  - Exclusive access to roadmap, beta features, events
```

### Relationship Tracking

Maintain a CRM-style record for each influencer:

```markdown
| Field | Value |
|-------|-------|
| Name | {name} |
| Platform(s) | {platforms} |
| Follower count | {count} |
| Engagement rate | {rate} |
| Stage | {1-5} |
| Last interaction | {date} |
| Notes | {context from conversations} |
| Content about us | {links} |
| Next action | {what and when} |
```

## 5. User Feedback Routing

### Feedback Collection Points

1. Community forums and Reddit
2. Social media comments and DMs
3. Review sites
4. Support ticket themes
5. In-product feedback widgets
6. NPS survey verbatims

### Routing Rules

```
feedback_routing:
  bug_report:
    destination: engineering_backlog
    priority: based on user count affected
    response: "Thanks for reporting — our team is investigating."
    follow_up: notify user when fixed

  feature_request:
    destination: product_backlog
    priority: based on request frequency and user segment
    response: "Great idea — I've passed this to our product team."
    follow_up: notify user if shipped

  ux_complaint:
    destination: design_team
    priority: based on severity and frequency
    response: "I hear you — we know this could be better."
    follow_up: share improvement when deployed

  pricing_feedback:
    destination: revenue_team
    priority: high if from paying or churned customer
    response: "Thanks for sharing — we want to make sure pricing works for teams like yours."
    follow_up: connect with sales if expansion opportunity

  praise:
    destination: marketing (for testimonial pipeline)
    priority: low urgency, high value
    response: "That means a lot — thank you!"
    follow_up: ask permission to feature as testimonial
```

### Feedback Aggregation

Weekly:
1. Collect all feedback from all channels.
2. Categorize by type (bug, feature, UX, pricing, praise).
3. Count frequency of each unique request.
4. Identify top 5 themes and trend direction (growing, stable, declining).
5. Report to product team with raw quotes and frequency data.

## 6. Crisis Response

### Severity Levels

| Level | Definition | Examples |
|-------|-----------|----------|
| 1 - Low | Isolated negative feedback, no spread | Single bad review, one unhappy tweet |
| 2 - Medium | Multiple related complaints, moderate visibility | Product bug affecting vocal users, competitor attack thread |
| 3 - High | Viral negative content, press coverage | Data incident, major outage, trending negative hashtag |
| 4 - Critical | Existential threat to brand trust | Security breach with data exposure, legal issue, executive scandal |

### Response Procedure

#### Level 1 (Low)

```
1. Respond individually to the complaint.
2. Document the issue.
3. No public statement needed.
4. Monitor for 48 hours for escalation.
```

#### Level 2 (Medium)

```
1. Pause all scheduled social media and community posts.
2. Draft a holding statement within 1 hour.
3. Respond to each complaint individually with consistent messaging.
4. Identify root cause and timeline for resolution.
5. Post a public update when resolved.
6. Resume normal activity 24 hours after resolution.
```

#### Level 3 (High)

```
1. Immediately pause all marketing activity.
2. Assemble crisis team: community lead, PR, executive, legal.
3. Issue public statement within 2 hours (across all active channels).
4. Designate one spokesperson for all public communications.
5. Monitor all channels every 30 minutes.
6. Provide updates every 4 hours until resolved.
7. Post-mortem and public resolution summary when complete.
8. Resume marketing 48-72 hours after resolution.
```

#### Level 4 (Critical)

```
1. All marketing and community activity stops immediately.
2. CEO and legal lead all communications.
3. Public statement within 1 hour.
4. Dedicated status page or landing page for updates.
5. Direct outreach to affected users.
6. Continuous monitoring and updates.
7. Post-mortem published publicly.
8. Long-term trust rebuilding plan developed.
```

### Post-Crisis Review

Within 1 week of resolution:

1. Timeline of events: what happened and when.
2. Response assessment: what we did well, what we did poorly.
3. Community impact: sentiment before, during, and after.
4. Process improvements: what changes prevent this or improve response next time.
5. Document in crisis playbook for future reference.

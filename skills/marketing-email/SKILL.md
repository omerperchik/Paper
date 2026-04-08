---
name: marketing-email
description: >
  Email marketing workflows for the marketing email agent. Covers lifecycle
  sequences (onboarding, activation, retention, win-back), subject line A/B
  testing, deliverability management, list segmentation, and personalization
  strategies.
version: "1.0.0"
author: marketing-team
tags:
  - marketing
  - email
  - lifecycle
  - onboarding
  - retention
  - segmentation
  - deliverability
---

# Marketing Email Skill

Use this skill for all email marketing workflows: lifecycle sequence design, subject line testing, deliverability optimization, segmentation strategy, and personalization. All email copy must pass through the marketing-content skill's humanizer quality gate before sending.

## 1. Lifecycle Sequences

### Onboarding Sequence

Trigger: New user signs up (free trial or freemium).

```
Email 1 — Welcome (Immediate)
  Subject: focus on what they can do right now
  Content: Welcome, single CTA to first key action
  Goal: Get them to complete setup / first value moment

Email 2 — Quick Win (Day 1)
  Subject: focus on easiest path to value
  Content: Step-by-step guide to the one feature that delivers fastest value
  Goal: First "aha moment"

Email 3 — Social Proof (Day 3)
  Subject: reference a specific customer result
  Content: Short case study or testimonial showing outcome
  Goal: Build confidence in the product

Email 4 — Feature Discovery (Day 5)
  Subject: focus on a feature they have not used
  Content: Introduce a second key feature with use case
  Goal: Deepen product engagement

Email 5 — Check-in (Day 7)
  Subject: personal, conversational tone
  Content: Ask if they need help, link to support resources
  Goal: Reduce churn risk, surface objections

Email 6 — Upgrade Nudge (Day 10, if on free plan)
  Subject: highlight what they are missing on paid plan
  Content: Feature comparison, specific value they would unlock
  Goal: Trial-to-paid conversion
```

### Activation Sequence

Trigger: User signed up but has not completed the key activation event within 48 hours.

```
Email 1 — Gentle Reminder (48 hours post-signup)
  Content: "You're one step away from [key value]"
  CTA: Direct link to the activation step

Email 2 — Remove Friction (72 hours)
  Content: Address common blockers (FAQ, video walkthrough)
  CTA: Link to guided setup or support chat

Email 3 — Peer Pressure (5 days)
  Content: "X users completed setup this week — here's what they built"
  CTA: Link to activation step with social proof

Email 4 — Last Chance (7 days)
  Content: Offer help — "Reply to this email and we'll set it up for you"
  CTA: Reply-to or calendar booking link
```

### Retention Sequence

Trigger: Active user shows declining engagement (usage drops > 40% week-over-week).

```
Email 1 — Value Reminder (3 days after drop detected)
  Content: Highlight what they have built/achieved so far
  CTA: Link to their dashboard or recent project

Email 2 — New Feature (7 days)
  Content: Introduce a feature they have not tried
  CTA: Link to feature with use case relevant to their usage pattern

Email 3 — Feedback Ask (14 days)
  Content: "Is something not working for you? We want to fix it."
  CTA: Short survey (3 questions max) or reply-to

Email 4 — Win-Back Offer (21 days, only if still declining)
  Content: Special offer or personal outreach
  CTA: Schedule a call or access an exclusive resource
```

### Win-Back Sequence

Trigger: User has been inactive for 30+ days or canceled subscription.

```
Email 1 — "We miss you" (30 days inactive)
  Content: Reminder of value, what has changed since they left
  CTA: One-click return to product

Email 2 — What's New (37 days)
  Content: Product updates and improvements since they were last active
  CTA: Link to changelog or new feature

Email 3 — Incentive (45 days)
  Content: Time-limited offer (discount, extended trial, premium feature access)
  CTA: Redeem offer

Email 4 — Last Email (60 days)
  Content: "We'll stop emailing unless you want to stay connected"
  CTA: Stay subscribed / unsubscribe — respect their choice
```

## 2. Subject Line A/B Testing

### Test Design

1. Write 2-4 subject line variants for each email.
2. Vary one dimension per test:

| Dimension | Example A | Example B |
|-----------|----------|----------|
| Length | "Your setup is 80% done" | "You're almost there — finish setup in 2 minutes and start seeing results" |
| Personalization | "New features for you" | "{first_name}, 3 features you haven't tried" |
| Specificity | "Tips to get more value" | "The 3-step process that doubled Sarah's output" |
| Urgency | "Check out our new feature" | "Available this week: early access to [feature]" |
| Question vs. statement | "How top teams use [product]" | "Top teams use [product] like this" |
| Emoji | "Your weekly update" | "Your weekly update (fire emoji)" |

### Test Execution

```
1. Split the audience randomly:
   - 15% receives variant A
   - 15% receives variant B
   - 70% receives the winner after 4 hours

2. Primary metric: Open rate
   Secondary metric: Click rate (for tie-breaking)

3. Winner determination:
   if abs(open_rate_a - open_rate_b) > 2 percentage points:
       winner = variant with higher open rate
   elif abs(click_rate_a - click_rate_b) > 1 percentage point:
       winner = variant with higher click rate
   else:
       winner = shorter subject line (default to brevity)

4. Minimum sample: 500 recipients per variant before evaluating.
```

### Subject Line Rules

- Under 50 characters (mobile truncation starts at ~35-40)
- No ALL CAPS words
- No spam trigger words (free, guarantee, act now, limited time, click here)
- No misleading RE: or FW: prefixes
- Preheader text must complement, not repeat, the subject line

## 3. Deliverability Management

### Sender Reputation Monitoring

Check weekly:

1. **Bounce rate**: Target < 2%. Action threshold: > 3%.
2. **Spam complaint rate**: Target < 0.1%. Action threshold: > 0.08%.
3. **Unsubscribe rate**: Target < 0.5%. Warning: > 1%.

### Deliverability Checklist

#### Authentication
- [ ] SPF record configured and valid
- [ ] DKIM signing enabled and verified
- [ ] DMARC policy set (start with p=none, move to p=quarantine)
- [ ] Return-path aligned with sending domain

#### List Hygiene
- [ ] Remove hard bounces immediately
- [ ] Suppress soft bounces after 3 consecutive failures
- [ ] Remove unengaged subscribers (no opens in 90 days) from regular sends
- [ ] Run email verification on new list imports before sending
- [ ] Never purchase or rent email lists

#### Content
- [ ] Text-to-image ratio: at least 60% text
- [ ] Unsubscribe link prominent and functional
- [ ] Physical mailing address included (CAN-SPAM compliance)
- [ ] No link shorteners (they trigger spam filters)
- [ ] Personalized sender name (person at company, not just company)

### Warm-Up Procedure (for new sending domain or IP)

```
Week 1: 50 emails/day — send only to most engaged subscribers
Week 2: 200 emails/day — engaged subscribers
Week 3: 500 emails/day — expand to recently active
Week 4: 1,000 emails/day — broader active list
Week 5: 2,500 emails/day — full active list
Week 6+: Full volume — monitor metrics closely
```

Abort and investigate if bounce rate exceeds 5% or spam complaints exceed 0.1% during warm-up.

## 4. Segmentation

### Core Segments

| Segment | Definition | Use Case |
|---------|-----------|----------|
| New users (< 7 days) | Signed up within last 7 days | Onboarding sequence |
| Active users | Logged in within last 14 days | Feature announcements, tips |
| Power users | Top 20% by usage metrics | Beta invites, feedback requests, case study candidates |
| At-risk users | Usage dropped > 40% WoW | Retention sequence |
| Dormant users | No login in 30-60 days | Win-back sequence |
| Churned users | Canceled or 60+ days inactive | Win-back with incentive |
| Free plan users | Active but on free tier | Upgrade nudges |
| Paid users | Active paying customers | Retention, expansion, referral asks |

### Behavioral Segments

Build dynamic segments based on product behavior:

```
segment_rules:
  used_feature_x:
    condition: "completed feature_x_action in last 30 days"
    use: "cross-sell feature_y which pairs well"

  hit_usage_limit:
    condition: "reached 80% of plan limit"
    use: "upgrade prompt with specific limit they are approaching"

  invited_teammates:
    condition: "sent 1+ team invitations"
    use: "team collaboration tips, admin features education"

  never_used_core_feature:
    condition: "signed up 7+ days ago AND never used {core_feature}"
    use: "targeted education sequence for that feature"
```

### Segmentation Rules

- Every email must target a specific segment. No batch-and-blast to the full list.
- Maximum segment overlap for a single user: 2 active sequences at once.
- If a user qualifies for multiple sequences, priority order: Onboarding > Activation > Retention > Promotional.
- Frequency cap: No user receives more than 3 emails per week across all sequences.

## 5. Personalization

### Personalization Levels

#### Level 1 — Merge Fields (baseline, always use)
- First name in greeting
- Company name where known
- Plan type / account status

#### Level 2 — Behavioral (use in lifecycle sequences)
- Features they have used or not used
- Last action taken in product
- Usage statistics ("You created 12 projects this month")

#### Level 3 — Contextual (use for high-value segments)
- Industry-specific examples and case studies
- Role-based messaging (decision-maker vs. end user)
- Company size-appropriate use cases

#### Level 4 — Predictive (advanced, use for at-risk and upgrade)
- Churn probability-based messaging urgency
- Feature recommendations based on usage pattern
- Optimal send time per user (based on historical open data)

### Personalization Rules

- Always have a fallback for empty merge fields: "there" instead of "{first_name}" if name is missing.
- Never personalize with sensitive data (revenue, employee count) unless the user explicitly shared it.
- Test personalized vs. non-personalized variants before rolling out to validate lift.
- Dynamic content blocks: use platform conditional logic to swap sections based on segment, never maintain separate email templates per segment when conditional blocks suffice.

### Send Time Optimization

```
1. Collect per-user open time data over 30 days.
2. Identify each user's peak open window (2-hour block with highest open rate).
3. If insufficient data (< 5 opens): use segment-level default.
4. Segment defaults:
   - B2B: Tuesday-Thursday, 9-11am recipient local time
   - B2C: Tuesday-Thursday, 7-9pm recipient local time
   - Transactional: Immediate (no delay)
5. Re-calculate monthly. Send time preferences shift seasonally.
```

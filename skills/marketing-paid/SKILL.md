---
name: marketing-paid
description: >
  Paid acquisition workflows for the marketing paid agent. Covers campaign
  structure by platform, ad copy A/B testing, budget optimization with CAC-based
  shifting, audience targeting, retargeting funnels, ROAS management, and
  creative fatigue detection.
version: "1.0.0"
author: marketing-team
tags:
  - marketing
  - paid-acquisition
  - advertising
  - google-ads
  - meta-ads
  - tiktok
  - linkedin
  - retargeting
  - roas
---

# Marketing Paid Acquisition Skill

Use this skill for all paid acquisition workflows: campaign setup, ad copy testing, budget allocation, audience management, retargeting, and performance optimization across Google, Meta, TikTok, and LinkedIn.

## 1. Campaign Structure by Platform

### Google Ads

```
Account
├── Campaign: Brand (Search)
│   ├── Ad Group: Exact brand terms
│   └── Ad Group: Brand + modifier ("brand pricing", "brand reviews")
├── Campaign: Non-Brand Search
│   ├── Ad Group: {product category} — exact match
│   ├── Ad Group: {product category} — phrase match
│   └── Ad Group: {competitor} alternatives
├── Campaign: Performance Max
│   ├── Asset Group: Primary product
│   └── Asset Group: Secondary offering
└── Campaign: Remarketing (Display)
    ├── Ad Group: Site visitors (7 day)
    ├── Ad Group: Site visitors (30 day)
    └── Ad Group: Cart/signup abandoners
```

**Naming convention**: `{platform}_{campaign-type}_{target}_{geo}_{date-launched}`

### Meta (Facebook/Instagram)

```
Campaign: Prospecting — Conversions
├── Ad Set: Lookalike 1% — Customers
│   ├── Ad: Static image variant A
│   ├── Ad: Static image variant B
│   └── Ad: Video 15s variant A
├── Ad Set: Interest — {category}
│   ├── Ad: Static image variant A
│   └── Ad: Video 15s variant A
└── Ad Set: Broad targeting (Advantage+)
    └── Ad: Top 3 performing creatives

Campaign: Retargeting — Conversions
├── Ad Set: Website visitors 1-7 days
├── Ad Set: Website visitors 8-30 days
└── Ad Set: Engaged with social (90 days)
```

### TikTok

```
Campaign: Awareness — Reach
├── Ad Group: Broad interest targeting
│   ├── Ad: UGC-style video 15s
│   └── Ad: UGC-style video 30s
Campaign: Consideration — Traffic
├── Ad Group: Behavior-based targeting
│   └── Ad: Hook-first video with CTA overlay
Campaign: Conversion — App Install / Web Conversion
├── Ad Group: Lookalike — converters
│   └── Ad: Problem-solution format
```

**TikTok rules**: Creative must feel native. No polished ads. UGC style performs 2-3x better. Replace creatives every 7-14 days.

### LinkedIn

```
Campaign: Awareness — Brand Awareness
├── Ad: Thought leadership post (sponsored)
Campaign: Consideration — Website Visits
├── Ad: Case study carousel
├── Ad: Whitepaper offer (lead gen form)
Campaign: Conversion — Lead Gen
├── Ad: Demo request (lead gen form)
└── Ad: Free trial offer (lead gen form)
```

**LinkedIn targeting**: Job title + company size + industry. Minimum audience size 50,000 for prospecting. Use matched audiences for retargeting.

## 2. Ad Copy A/B Testing

### Test Design

1. Test one variable at a time:
   - **Headlines**: Test value prop framing (benefit vs. feature vs. social proof)
   - **Description**: Test CTA language (direct vs. soft vs. urgency)
   - **Creative**: Test format (image vs. video vs. carousel)
   - **Landing page**: Test destination (homepage vs. dedicated LP vs. product page)

2. Sample size requirements before declaring a winner:
   - Minimum 1,000 impressions per variant
   - Minimum 100 clicks per variant for CTR tests
   - Minimum 30 conversions per variant for conversion rate tests
   - Statistical significance threshold: 95% confidence

### Test Procedure

```
1. Create control ad (current best performer or new baseline).
2. Create 1-2 variants changing a single element.
3. Set equal budget split across variants.
4. Run for minimum 7 days or until sample size is met.
5. Evaluate using:
   ctr_lift = (variant_ctr - control_ctr) / control_ctr * 100
   cvr_lift = (variant_cvr - control_cvr) / control_cvr * 100
   cpa_change = (variant_cpa - control_cpa) / control_cpa * 100
6. If variant wins at 95% confidence:
   - Pause control.
   - Variant becomes new control.
   - Design next test.
7. If no winner after 14 days:
   - Close test.
   - Document learnings.
   - Move to next hypothesis.
```

### Test Velocity Target

Maintain 2-3 active tests per platform at all times. Document every test result in the experiment log regardless of outcome.

## 3. Budget Optimization

### CAC-Based Channel Shifting

Run this procedure weekly:

1. Pull channel-level CAC from marketing-analytics skill.
2. Rank channels by CAC ascending.
3. Calculate the efficiency ratio for each channel:

```
efficiency_ratio = channel_cac / blended_cac_target
```

4. Apply budget shifts:

| Efficiency Ratio | Action |
|-----------------|--------|
| < 0.7 | Increase budget by 20% (channel is outperforming) |
| 0.7 - 1.0 | Maintain or increase by 10% |
| 1.0 - 1.3 | Maintain, optimize targeting and creative |
| 1.3 - 1.8 | Reduce budget by 15%, investigate root cause |
| > 1.8 | Pause spend, requires full audit before reactivation |

5. Constraints:
   - No single channel shift exceeds 25% of its budget in one week.
   - Total budget remains within the monthly allocation.
   - Minimum viable spend per channel: do not reduce below platform minimums.

### Daily Spend Pacing

```
expected_daily_spend = monthly_budget / days_in_month
actual_daily_spend = sum(all_channel_spend_today)
pacing_ratio = actual_daily_spend / expected_daily_spend

if pacing_ratio > 1.15:
    alert("Overpacing — reduce bids or pause lowest-performing ad sets")
elif pacing_ratio < 0.85:
    alert("Underpacing — check for disapproved ads, exhausted audiences, or bid floors")
```

## 4. Audience Targeting

### Prospecting Audiences

| Audience Type | Platform | Method |
|--------------|----------|--------|
| Lookalike (1%) | Meta, TikTok | Seed: paying customers, 1% expansion |
| Lookalike (3-5%) | Meta, TikTok | Seed: all converters, broader reach |
| In-market | Google | Target users actively searching category |
| Interest-based | Meta, TikTok, LinkedIn | Layer 2-3 relevant interest categories |
| Job title / industry | LinkedIn | Direct professional attribute targeting |
| Broad / Advantage+ | Meta | Algorithmic targeting with creative signal |

### Audience Exclusions

Always exclude:
- Current customers (upload CRM list monthly)
- Users who converted in the last 30 days
- Employees (by email domain or company targeting)
- Bot-heavy placements (Audience Network off by default on Meta)

### Audience Refresh

Monthly:
1. Update customer lists for exclusions and lookalike seeds.
2. Refresh website visitor audiences.
3. Review audience overlap between ad sets — merge if overlap > 30%.

## 5. Retargeting Funnels

### Funnel Structure

```
Stage 1: Awareness retargeting (1-3 days post-visit)
  Audience: Visited site, bounced without action
  Creative: Brand story, social proof, educational content
  Frequency cap: 2 impressions/day

Stage 2: Consideration retargeting (4-14 days post-visit)
  Audience: Viewed key pages (pricing, features, case studies)
  Creative: Feature deep-dive, comparison content, testimonials
  Frequency cap: 3 impressions/day

Stage 3: Decision retargeting (1-7 days post high-intent action)
  Audience: Started signup/trial, visited pricing 2+ times
  Creative: Limited-time offer, objection handling, demo CTA
  Frequency cap: 4 impressions/day

Stage 4: Win-back (30-90 days since last visit)
  Audience: Previously engaged, no recent activity
  Creative: "What's new" messaging, re-engagement offer
  Frequency cap: 1 impression/day
```

### Retargeting Rules

- Exclude converters from all retargeting immediately upon conversion.
- Move users between stages automatically based on recency.
- Burn pixel: stop showing ads for 14 days after a user converts.

## 6. ROAS Management

### Target ROAS Calculation

```
target_roas = 1 / target_cac_as_pct_of_ltv
```

Example: If target CAC is 33% of LTV ($300 LTV, $100 CAC target), target ROAS = 3.0x.

### ROAS Monitoring

| ROAS Range | Status | Action |
|-----------|--------|--------|
| > target * 1.5 | Outperforming | Scale spend 15-20% |
| target * 1.0 - 1.5 | On track | Maintain, continue optimizing |
| target * 0.7 - 1.0 | Below target | Optimize creative, audiences, bids |
| < target * 0.7 | Critical | Pause and audit within 24 hours |

### Platform-Specific ROAS Notes

- **Google**: Use target ROAS bidding after 30+ conversions per campaign in 30 days.
- **Meta**: ROAS bidding available but less reliable for low-volume campaigns; prefer cost cap.
- **TikTok**: Focus on CPA rather than ROAS due to attribution lag.
- **LinkedIn**: Higher CPAs expected; evaluate on pipeline value, not direct ROAS.

## 7. Creative Fatigue Detection

### Signals

Monitor these metrics daily per ad creative:

```
fatigue_indicators:
  ctr_decline: 20% drop from 7-day peak CTR
  frequency: > 4.0 average frequency in 7 days
  cpm_increase: 15% increase week-over-week with stable targeting
  cvr_decline: 15% drop from 7-day peak conversion rate
```

### Detection Procedure

```
for each active ad creative:
    if ctr_7d_avg < ctr_peak * 0.8 AND frequency_7d > 4.0:
        status = "fatigued"
        action = "replace within 48 hours"
    elif ctr_7d_avg < ctr_peak * 0.9 OR frequency_7d > 3.0:
        status = "early_fatigue"
        action = "prepare replacement creative"
    else:
        status = "healthy"
```

### Refresh Cadence

| Platform | Expected Creative Lifespan | Refresh Strategy |
|----------|--------------------------|-----------------|
| Meta | 10-21 days | Rotate 3-5 creatives per ad set |
| TikTok | 7-14 days | New UGC-style creative weekly |
| Google Display | 21-30 days | Refresh imagery quarterly, copy monthly |
| LinkedIn | 30-45 days | Professional audience tolerates longer runs |

### Creative Pipeline

Maintain a backlog of 3-5 ready-to-deploy creatives per platform at all times. When a creative enters "early_fatigue" status, promote the next creative from the backlog and commission a replacement.

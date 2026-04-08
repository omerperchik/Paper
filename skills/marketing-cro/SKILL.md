---
name: marketing-cro
description: >
  Conversion rate optimization workflows for the marketing CRO agent. Covers
  landing page audits, funnel analysis, A/B test design with statistical rigor,
  hypothesis templates, common conversion killers, and pricing page optimization.
version: "1.0.0"
author: marketing-team
tags:
  - marketing
  - cro
  - conversion
  - landing-page
  - ab-testing
  - funnel
  - pricing
---

# Marketing CRO Skill

Use this skill for all conversion optimization workflows: landing page audits, funnel analysis, A/B test design, hypothesis generation, and pricing page optimization. CRO decisions must be data-driven. Never ship changes without a testing plan.

## 1. Landing Page Audit

Run this audit for every landing page before launch and quarterly for existing pages.

### Above-the-Fold Audit

The area visible without scrolling must answer three questions in under 5 seconds:

1. **What is this?** (Clear headline describing the product/offer)
2. **Why should I care?** (Value proposition or benefit statement)
3. **What do I do next?** (Visible CTA button)

#### Checklist

- [ ] Headline is specific and benefit-oriented (not feature-oriented)
- [ ] Subheadline adds supporting detail or addresses a key objection
- [ ] CTA button is visible without scrolling on both desktop and mobile
- [ ] CTA text is action-oriented ("Start free trial" not "Submit" or "Learn more")
- [ ] Hero image or visual reinforces the value proposition
- [ ] No navigation menu distracting from the primary CTA (for campaign landing pages)
- [ ] Page loads in under 3 seconds on 4G connection

### CTA Audit

| Element | Best Practice |
|---------|-------------|
| Button color | High contrast against page background; consistent across the page |
| Button text | Action verb + value ("Get started free", "See pricing", "Download the guide") |
| Button size | Minimum 44x44px tap target; prominent but not overwhelming |
| CTA count | One primary CTA per page; secondary CTA acceptable below fold |
| CTA placement | Above fold, after key sections, at page bottom — minimum 3 placements |
| Friction reducers near CTA | "No credit card required", "Free for 14 days", "Cancel anytime" |

### Social Proof Audit

- [ ] Customer logos (minimum 4, recognizable to target audience)
- [ ] Testimonials with real names, photos, and titles (not anonymous)
- [ ] Quantified results ("Reduced churn by 23%" not "Improved retention")
- [ ] Review scores from third-party sites (G2, Capterra badges)
- [ ] User count or traction metric if impressive ("Used by 10,000+ teams")
- [ ] Social proof appears above and below the fold

### Load Speed Audit

| Metric | Target | Critical Threshold |
|--------|--------|-------------------|
| LCP (Largest Contentful Paint) | < 2.0s | > 3.5s |
| FCP (First Contentful Paint) | < 1.5s | > 2.5s |
| CLS (Cumulative Layout Shift) | < 0.05 | > 0.15 |
| Total page weight | < 1.5MB | > 3MB |
| Requests | < 40 | > 80 |

Speed fixes priority order:
1. Compress and lazy-load images (biggest impact).
2. Remove unused CSS/JS.
3. Enable caching and CDN.
4. Defer non-critical third-party scripts.
5. Optimize web fonts (subset, swap display).

### Mobile Audit

- [ ] All text readable without zooming (minimum 16px body text)
- [ ] CTA buttons full-width or near-full-width on mobile
- [ ] No horizontal scrolling
- [ ] Forms use appropriate input types (email, tel, number)
- [ ] Tap targets at least 48px apart
- [ ] Images scale correctly (no cropped text in hero images)
- [ ] Page functions without JavaScript for core content

### Audit Output

```markdown
## Landing Page Audit — {page_url} — {date}

### Score: {score}/100

| Category | Score | Critical Issues |
|----------|-------|----------------|
| Above-the-fold | {x}/25 | {issues} |
| CTA effectiveness | {x}/20 | {issues} |
| Social proof | {x}/15 | {issues} |
| Load speed | {x}/20 | {issues} |
| Mobile experience | {x}/20 | {issues} |

### Priority Fixes
1. {highest impact fix}
2. {second highest}
3. {third highest}

### Test Recommendations
- {hypothesis for A/B test based on findings}
```

## 2. Funnel Analysis

### Funnel Mapping

Define the conversion funnel stages:

```
Stage 1: Visit (landing page view)
  ↓ drop-off rate: {x}%
Stage 2: Engage (scroll > 50%, click any element, spend > 30s)
  ↓ drop-off rate: {x}%
Stage 3: Intent (click CTA, visit pricing, start signup)
  ↓ drop-off rate: {x}%
Stage 4: Action (complete signup form)
  ↓ drop-off rate: {x}%
Stage 5: Activate (complete key first action)
  ↓ drop-off rate: {x}%
Stage 6: Convert (become paying customer)
```

### Drop-Off Analysis

For each stage transition:

1. Calculate the drop-off rate:
```
drop_off_rate = (1 - (stage_n_users / stage_n-1_users)) * 100
```

2. Compare against benchmarks:

| Transition | Good | Average | Poor |
|-----------|------|---------|------|
| Visit to Engage | < 40% drop | 40-60% | > 60% |
| Engage to Intent | < 60% drop | 60-80% | > 80% |
| Intent to Action | < 30% drop | 30-50% | > 50% |
| Action to Activate | < 20% drop | 20-40% | > 40% |
| Activate to Convert | < 50% drop | 50-70% | > 70% |

3. For the highest drop-off stage, investigate:
   - Session recordings: what are users doing before leaving?
   - Heatmaps: where do users click and scroll?
   - Form analytics: which fields cause abandonment?
   - Device segmentation: is the drop-off mobile-specific?
   - Traffic source: do some channels have higher drop-off?

### Funnel Segmentation

Analyze the funnel separately for:
- Device type (desktop vs. mobile vs. tablet)
- Traffic source (organic, paid, social, email, direct)
- Geography (top 5 countries)
- New vs. returning visitors
- User segment (if identifiable pre-signup)

Flag any segment where conversion rate is < 50% of the overall average for investigation.

## 3. A/B Test Design

### Hypothesis Template

Every test must start with a written hypothesis:

```
Because we observed [evidence/data],
we believe that [change]
will cause [expected outcome]
for [target segment].

We will measure this by tracking [primary metric]
and consider it successful if [metric] improves by [minimum detectable effect]
with [confidence level] confidence over [duration].
```

**Example**:
```
Because we observed a 65% drop-off between CTA click and form completion,
we believe that reducing the signup form from 5 fields to 2 (email + password)
will cause a 15% increase in form completion rate
for new visitors from paid search.

We will measure this by tracking signup completion rate
and consider it successful if the rate improves by 10%
with 95% confidence over 14 days.
```

### Statistical Rigor

#### Sample Size Calculation

Before starting any test:

```
required_sample_per_variant = (Z_alpha + Z_beta)^2 * 2 * p * (1-p) / MDE^2

Where:
  Z_alpha = 1.96 (for 95% confidence)
  Z_beta = 0.84 (for 80% power)
  p = baseline conversion rate
  MDE = minimum detectable effect (absolute)
```

Example: baseline conversion 5%, MDE 1 percentage point:
```
n = (1.96 + 0.84)^2 * 2 * 0.05 * 0.95 / 0.01^2
n = 7.84 * 0.095 / 0.0001
n = 7,448 visitors per variant
```

#### Test Duration Rules

- **Minimum duration**: 7 days (to capture day-of-week effects).
- **Maximum duration**: 30 days (longer tests risk external confounds).
- **No peeking**: Do not evaluate results before the planned sample size is reached.
- **One primary metric**: Designate one metric as the decision metric. Track secondary metrics for insight but do not use them to override the primary decision.

#### Result Evaluation

```
1. Calculate the observed difference:
   lift = (variant_rate - control_rate) / control_rate * 100

2. Calculate the p-value (two-tailed z-test for proportions):
   pooled_p = (control_conversions + variant_conversions) / (control_total + variant_total)
   se = sqrt(pooled_p * (1 - pooled_p) * (1/control_total + 1/variant_total))
   z = (variant_rate - control_rate) / se
   p_value = 2 * (1 - normal_cdf(abs(z)))

3. Decision:
   if p_value < 0.05 AND lift > 0:
       Ship the variant.
   elif p_value < 0.05 AND lift < 0:
       Revert to control. Variant is worse.
   else:
       Inconclusive. Either extend the test or accept the null hypothesis.
```

### Common Testing Mistakes to Avoid

1. **Stopping early**: Reaching significance on day 2 does not mean the result is real.
2. **Testing too many things**: One change per test. Multi-variate testing requires exponentially more traffic.
3. **Ignoring segment effects**: Overall neutral results can mask a win in one segment and a loss in another.
4. **No hypothesis**: "Let's just try this" leads to inconclusive results and wasted traffic.
5. **Small MDE**: Testing for a 0.5% improvement requires massive sample sizes. Focus on changes that could move the needle by 5-15%.

## 4. Common Conversion Killers

### Identified Killers and Fixes

| Killer | Symptom | Fix |
|--------|---------|-----|
| Slow load time | High bounce rate, low engagement | Optimize per speed audit above |
| Unclear value proposition | Low time-on-page, high bounce from above-fold | Rewrite headline to be specific and benefit-focused |
| Too many form fields | High form abandonment rate | Reduce to essentials, use progressive profiling |
| Missing social proof | Low engagement-to-intent conversion | Add testimonials, logos, review scores |
| Weak CTA | High scroll depth but low click rate | Strengthen CTA text, increase contrast, add urgency |
| Competing CTAs | Low click rate despite engagement | Single primary CTA per viewport |
| No mobile optimization | Mobile conversion rate < 50% of desktop | Mobile-first redesign |
| Trust gaps | Drop-off at payment or sensitive info step | Security badges, money-back guarantee, transparent pricing |
| Cognitive overload | Short time-on-page, random click patterns | Simplify layout, reduce choices, progressive disclosure |
| Price shock | High pricing page bounce rate | Anchor pricing, show value before price, offer tiers |

### Diagnostic Procedure

When conversion drops unexpectedly:

```
1. Check for technical issues:
   - Is the page loading correctly? (broken JS, failed API calls)
   - Is tracking firing? (Could be a measurement issue, not a real drop)
   - Any recent deployments that changed the page?

2. Check for traffic quality changes:
   - Did the traffic mix shift? (More paid, different geo, new channel)
   - Segment conversion by source — is the drop isolated?

3. Check for external factors:
   - Competitor launched a new campaign?
   - Seasonal effect? (compare to same period last year)
   - Industry news affecting sentiment?

4. If none of the above explain it:
   - Run session recordings for the last 48 hours.
   - Compare heatmaps to the previous period.
   - Identify the exact funnel stage where the drop occurs.
```

## 5. Pricing Page Optimization

### Pricing Page Structure

The optimal pricing page layout (top to bottom):

```
1. Headline: Reinforce value, not just "Pricing"
   Good: "Plans that grow with your team"
   Bad: "Our Pricing"

2. Plan cards (3 tiers recommended):
   - Each card: Plan name, price, key features, CTA
   - Recommended plan visually highlighted (border, badge, slightly larger)
   - Annual/monthly toggle (show annual savings prominently)

3. Feature comparison table:
   - Full feature-by-feature comparison across all plans
   - Group features by category
   - Checkmarks and X marks, not "included/not included" text

4. FAQ section:
   - Address top objections: "Can I cancel anytime?"
   - Clarify confusing features or limits
   - Address upgrade/downgrade questions

5. Social proof:
   - Customer logos
   - "Trusted by X,000 companies"
   - Relevant testimonial about value/ROI

6. Final CTA:
   - Repeat the primary CTA
   - Add a secondary CTA for users not ready ("Talk to sales", "See a demo")
```

### Pricing Page A/B Test Ideas (ordered by typical impact)

1. **Price anchoring**: Show the most expensive plan first vs. cheapest first.
2. **Annual vs. monthly default**: Which toggle is selected by default.
3. **Number of tiers**: 2 vs. 3 vs. 4 plans.
4. **Feature emphasis**: Which 3-5 features are listed on the card vs. hidden in comparison.
5. **CTA text**: "Start free trial" vs. "Get started" vs. "Try for free".
6. **Social proof placement**: Above plans vs. below plans.
7. **Price display**: "$99/month" vs. "$3.30/day" vs. "$1,188/year (save 20%)".

### Pricing Psychology Principles

- **Decoy effect**: Include a plan that makes the target plan look like the obvious choice.
- **Charm pricing**: $99 outperforms $100 for self-serve; round numbers ($100) perform better for enterprise.
- **Anchoring**: Show the highest price first so lower tiers feel reasonable.
- **Loss aversion**: Frame annual pricing as "Save $240/year" not just "20% off".
- **Social default**: Label the target plan "Most Popular" — people follow the crowd.
- **Reduce payment pain**: Offer monthly billing even if annual is preferred. The option to choose reduces anxiety.

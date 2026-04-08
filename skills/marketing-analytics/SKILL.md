---
name: marketing-analytics
description: >
  Marketing analytics workflows for the analytics agent. Covers daily KPI
  dashboards, CAC calculation by channel, LTV:CAC tracking, anomaly detection
  with z-scores, experiment scoring with bootstrap CI, report generation, and
  multi-touch attribution modeling.
version: "1.0.0"
author: marketing-team
tags:
  - marketing
  - analytics
  - kpi
  - attribution
  - reporting
required_tools:
  - paperclip
  - data-query
  - chart-generation
---

# Marketing Analytics Skill

Use this skill for all marketing analytics workflows: dashboards, KPI tracking, anomaly detection, experiment evaluation, and attribution modeling.

## 1. Daily KPI Dashboard Generation

Run this procedure every morning or on a cron trigger.

### Step 1 — Collect Raw Metrics

Pull data from all active channels for the trailing 24 hours:

| Source | Metrics |
|--------|---------|
| Website analytics | Sessions, unique visitors, bounce rate, avg session duration, pages/session |
| Paid platforms | Impressions, clicks, spend, conversions, CPA |
| Email platform | Sends, opens, clicks, unsubscribes, bounces |
| Social platforms | Followers, impressions, engagements, link clicks |
| CRM / signup data | New signups, MQLs, SQLs, trials started, conversions to paid |

### Step 2 — Compute Derived Metrics

```
blended_cac = total_marketing_spend / total_new_customers
paid_cac = total_paid_spend / paid_attributed_customers
organic_cac = total_organic_spend / organic_attributed_customers
email_cac = total_email_spend / email_attributed_customers

conversion_rate = conversions / total_sessions * 100
mql_to_sql_rate = sqls / mqls * 100
trial_to_paid_rate = paid_conversions / trials_started * 100
```

### Step 3 — Compare Against Targets

For each KPI, compute:

```
variance_pct = (actual - target) / target * 100
status = "on_track" if variance_pct >= -10 else "at_risk" if variance_pct >= -25 else "off_track"
```

### Step 4 — Format and Post Dashboard

Post the dashboard as a markdown table in an issue comment:

```markdown
## Daily Marketing Dashboard — {date}

| KPI | Target | Actual | Variance | Status |
|-----|--------|--------|----------|--------|
| Blended CAC | $50 | ${actual} | {variance}% | {status} |
| ... | ... | ... | ... | ... |

### Alerts
- {any metrics flagged by anomaly detection}
```

## 2. CAC Calculation by Channel

### Formula

```
channel_cac = channel_total_spend / channel_attributed_conversions
```

Where `channel_total_spend` includes:
- Direct ad spend (platform costs)
- Tool/software costs allocated to the channel
- Agent compute costs allocated to the channel (proportional to heartbeat budget usage)

### Channel Breakdown

Calculate CAC independently for each channel:

1. **Paid Search** (Google Ads, Bing Ads)
2. **Paid Social** (Meta, LinkedIn, Twitter/X ads)
3. **Organic Search** (SEO content + tooling costs)
4. **Email** (platform costs + agent time)
5. **Social Organic** (agent time only)
6. **Referral/Community** (agent time + any incentive costs)
7. **Direct** (unattributed conversions, allocate shared costs proportionally)

### Output

Produce a ranked channel list sorted by CAC ascending (most efficient first). Flag any channel where CAC exceeds 2x the blended target.

## 3. LTV:CAC Ratio Tracking

### LTV Calculation

```
avg_revenue_per_user_per_month = total_revenue / total_active_users / months_in_period
avg_customer_lifespan_months = 1 / monthly_churn_rate
ltv = avg_revenue_per_user_per_month * avg_customer_lifespan_months * gross_margin_pct
```

### Ratio Computation

```
ltv_cac_ratio = ltv / blended_cac
```

### Interpretation

| Ratio | Assessment | Action |
|-------|-----------|--------|
| < 1:1 | Losing money on every customer | Pause paid acquisition, investigate unit economics |
| 1:1 - 2:1 | Unsustainable | Reduce spend on highest-CAC channels |
| 2:1 - 3:1 | Acceptable early stage | Optimize toward 3:1 |
| 3:1 - 5:1 | Healthy | Maintain and scale efficient channels |
| > 5:1 | Under-investing in growth | Increase budget on proven channels |

## 4. Anomaly Detection Using Z-Score Method

Use this to flag unusual metric movements in daily data.

### Procedure

1. Collect the trailing 30-day values for each KPI.
2. Compute the rolling mean and standard deviation (exclude the current day).
3. Calculate the z-score for today's value:

```
z_score = (today_value - rolling_mean) / rolling_std
```

4. Flag based on thresholds:

| Z-Score | Severity | Action |
|---------|----------|--------|
| |z| < 2.0 | Normal | No action |
| 2.0 <= |z| < 3.0 | Warning | Note in dashboard, monitor tomorrow |
| |z| >= 3.0 | Alert | Immediate investigation, notify CMO |

5. For metrics where direction matters (e.g., CAC going up is bad, conversions going down is bad), apply directional logic:

```
if metric_direction == "lower_is_better" and z_score > 2.0:
    flag = "anomaly_bad"
elif metric_direction == "higher_is_better" and z_score < -2.0:
    flag = "anomaly_bad"
else:
    flag = "anomaly_good" if abs(z_score) >= 2.0 else "normal"
```

## 5. Experiment Scoring with Bootstrap CI

Use this to evaluate A/B tests and marketing experiments.

### Procedure

1. Collect conversion data for control and variant groups:
   - `control_conversions`, `control_total`
   - `variant_conversions`, `variant_total`

2. Compute observed conversion rates:

```
control_rate = control_conversions / control_total
variant_rate = variant_conversions / variant_total
observed_lift = (variant_rate - control_rate) / control_rate * 100
```

3. Run bootstrap confidence interval (10,000 iterations):

```
for i in 1..10000:
    control_sample = resample_with_replacement(control_data)
    variant_sample = resample_with_replacement(variant_data)
    bootstrap_lifts[i] = (mean(variant_sample) - mean(control_sample)) / mean(control_sample)

ci_lower = percentile(bootstrap_lifts, 2.5)
ci_upper = percentile(bootstrap_lifts, 97.5)
```

4. Decision framework:

| Condition | Decision |
|-----------|----------|
| CI lower bound > 0 and observed lift > 5% | **Ship variant** — statistically significant positive lift |
| CI contains 0 but observed lift > 0 | **Continue test** — need more data |
| CI upper bound < 0 | **Revert to control** — variant is worse |
| CI range is very wide (> 20pp) | **Continue test** — insufficient sample size |

5. Report format:

```markdown
## Experiment: {name}
- Control: {control_rate}% ({control_conversions}/{control_total})
- Variant: {variant_rate}% ({variant_conversions}/{variant_total})
- Observed Lift: {observed_lift}%
- 95% CI: [{ci_lower}%, {ci_upper}%]
- Decision: {decision}
- Recommendation: {action}
```

## 6. Weekly and Monthly Report Generation

### Weekly Report (every Monday)

1. Aggregate daily dashboards from the past 7 days.
2. Compute week-over-week trends for all KPIs.
3. Summarize top 3 wins and top 3 concerns.
4. List active experiments and their current status.
5. Provide channel-level CAC breakdown.
6. List any anomalies detected during the week.

### Monthly Report (first business day of month)

1. Aggregate all weekly reports.
2. Compute month-over-month trends.
3. Calculate monthly LTV:CAC ratio.
4. Review budget utilization by agent and channel.
5. Score each channel on a cost-efficiency index:

```
efficiency_index = (conversions / spend) * 1000
```

6. Provide recommendations for next month's budget allocation.
7. Post the report as an issue document with key `monthly-marketing-report-{YYYY-MM}`.

## 7. Attribution Modeling

Implement four attribution models. The default is linear; others are used for comparative analysis.

### First-Touch Attribution

```
for each conversion:
    credit[first_touchpoint] += 1.0
```

Use case: understanding which channels drive initial awareness.

### Last-Touch Attribution

```
for each conversion:
    credit[last_touchpoint] += 1.0
```

Use case: understanding which channels close conversions.

### Linear Attribution

```
for each conversion:
    touchpoints = get_all_touchpoints(user_journey)
    credit_per_touch = 1.0 / len(touchpoints)
    for tp in touchpoints:
        credit[tp] += credit_per_touch
```

Use case: default model for balanced channel evaluation.

### Time-Decay Attribution

```
half_life_days = 7

for each conversion:
    touchpoints = get_all_touchpoints(user_journey)
    conversion_time = conversion_timestamp
    weights = []
    for tp in touchpoints:
        days_before = (conversion_time - tp.timestamp).days
        weight = 2 ** (-days_before / half_life_days)
        weights.append(weight)
    total_weight = sum(weights)
    for tp, w in zip(touchpoints, weights):
        credit[tp] += w / total_weight
```

Use case: campaign optimization where recent touchpoints matter more.

### Attribution Comparison Report

Run all four models monthly and produce a comparison table:

```markdown
## Attribution Model Comparison — {month}

| Channel | First-Touch | Last-Touch | Linear | Time-Decay |
|---------|------------|------------|--------|------------|
| Paid Search | {n} | {n} | {n} | {n} |
| Organic | {n} | {n} | {n} | {n} |
| ... | ... | ... | ... | ... |
```

Flag channels with > 30% variance between models for deeper investigation.

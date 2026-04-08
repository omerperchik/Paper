---
name: marketing-onboard-product
description: >
  Master onboarding skill for the CMO agent. Use when a new product needs to be
  set up with the autonomous marketing team. Creates the Paperclip company/project,
  provisions all marketing agent roles, configures budgets, tracking, KPIs, content
  calendar, and competitor monitoring.
version: "1.0.0"
author: marketing-team
tags:
  - marketing
  - onboarding
  - cmo
  - setup
required_tools:
  - paperclip
  - paperclip-create-agent
  - marketing-analytics
  - marketing-content
  - marketing-seo
  - marketing-paid
  - marketing-social
  - marketing-email
  - marketing-community
  - marketing-cro
  - marketing-meta
---

# Marketing Product Onboarding Skill

This is the master skill the CMO uses to onboard a new product into the autonomous marketing team. Every step must complete before the product is considered live.

## Prerequisites

- You have CMO-level permissions in Paperclip.
- The product has a defined name, URL (or landing page), and a brief description.
- A board-approved marketing budget exists or will be requested during onboarding.

## Step 1 — Create Paperclip Company or Project

Decide whether the product warrants its own Paperclip company or a project under an existing company.

**New company (standalone product):**

```
POST /api/companies/{companyId}/imports/apply
{
  "target": { "mode": "new_company" },
  "agents": [...],
  "projects": [...]
}
```

**New project (product within existing company):**

```
POST /api/companies/{companyId}/projects
{
  "name": "{product-name} Marketing",
  "description": "Marketing operations for {product-name}",
  "status": "active"
}
```

After creation, record the `companyId` and `projectId` for all subsequent steps.

## Step 2 — Provision Marketing Agent Roles

Create the following agents using the `paperclip-create-agent` skill. Each agent reports to the CMO unless noted otherwise.

| Role | Agent Name | Responsibilities |
|------|-----------|-----------------|
| Content Lead | `content-lead` | Blog posts, video scripts, copywriting, content calendar |
| SEO Specialist | `seo-specialist` | Keyword research, on-page optimization, technical SEO |
| Paid Acquisition Manager | `paid-manager` | Campaign management, budget allocation, ROAS optimization |
| Social Media Manager | `social-manager` | Platform posting, engagement, trending topics, community |
| Email Marketing Specialist | `email-specialist` | Lifecycle sequences, newsletters, deliverability |
| Community Manager | `community-manager` | Reddit, forums, brand mentions, influencer outreach |
| CRO Specialist | `cro-specialist` | Landing pages, funnel analysis, A/B testing |
| Analytics Analyst | `analytics-analyst` | Dashboards, attribution, anomaly detection, reporting |
| Meta-Optimizer | `meta-optimizer` | Agent trace analysis, prompt tuning, skill creation |

For each agent:

1. Draft the agent config with role-specific prompt, adapter, and capabilities.
2. Assign the appropriate marketing skill from the company skill library.
3. Submit the hire request and track approval.
4. Confirm the agent is active before proceeding.

## Step 3 — Configure Budgets Per Agent

Set monthly budget allocations. Use the following template and adjust per product:

```json
{
  "budgets": {
    "paid-manager": { "monthly_usd": 5000, "alert_threshold_pct": 80 },
    "content-lead": { "monthly_usd": 1000, "alert_threshold_pct": 80 },
    "seo-specialist": { "monthly_usd": 500, "alert_threshold_pct": 80 },
    "social-manager": { "monthly_usd": 500, "alert_threshold_pct": 80 },
    "email-specialist": { "monthly_usd": 300, "alert_threshold_pct": 80 },
    "community-manager": { "monthly_usd": 200, "alert_threshold_pct": 80 },
    "cro-specialist": { "monthly_usd": 500, "alert_threshold_pct": 80 },
    "analytics-analyst": { "monthly_usd": 200, "alert_threshold_pct": 80 },
    "meta-optimizer": { "monthly_usd": 100, "alert_threshold_pct": 80 }
  }
}
```

If total budget exceeds board-approved limits, create an approval request:

```
POST /api/companies/{companyId}/approvals
{
  "type": "request_board_approval",
  "requestedByAgentId": "{cmo-agent-id}",
  "issueIds": ["{onboarding-issue-id}"],
  "payload": {
    "title": "Marketing budget approval for {product-name}",
    "summary": "Total monthly marketing spend: ${total}. Breakdown by agent role attached.",
    "recommendedAction": "Approve budget allocation.",
    "risks": ["Overspend if CAC targets are not met within 30 days."]
  }
}
```

## Step 4 — Set Up Tracking

### UTM Conventions

All marketing links must use this UTM structure:

| Parameter | Convention | Example |
|-----------|-----------|---------|
| `utm_source` | Platform name, lowercase | `google`, `twitter`, `reddit` |
| `utm_medium` | Channel type | `cpc`, `organic`, `email`, `social`, `referral` |
| `utm_campaign` | Campaign slug, kebab-case | `launch-2026-q2`, `blog-seo-push` |
| `utm_content` | Creative variant identifier | `hero-cta-v2`, `sidebar-banner` |
| `utm_term` | Keyword (paid search only) | `project-management-tool` |

### Attribution Model

Configure the default attribution model as **linear** with time-decay fallback:

1. **First-touch**: 100% credit to first interaction. Use for top-of-funnel analysis.
2. **Last-touch**: 100% credit to last interaction before conversion. Use for bottom-of-funnel.
3. **Linear**: Equal credit across all touchpoints. Use as the default model.
4. **Time-decay**: Exponentially more credit to recent touchpoints (half-life = 7 days). Use for campaign optimization.

Store attribution config in the project metadata and ensure the analytics agent has read access.

## Step 5 — Define Initial CAC Targets and KPIs

Set baseline targets. These will be refined after 30 days of data.

| KPI | Initial Target | Review Cadence |
|-----|---------------|----------------|
| Blended CAC | < $50 | Weekly |
| Paid CAC | < $80 | Weekly |
| Organic CAC | < $20 | Monthly |
| LTV:CAC Ratio | > 3:1 | Monthly |
| MQL to SQL Conversion | > 25% | Weekly |
| Website Traffic Growth | > 10% MoM | Monthly |
| Email Open Rate | > 25% | Weekly |
| Email Click Rate | > 3% | Weekly |
| Social Engagement Rate | > 2% | Weekly |
| Content Published | >= 4 posts/month | Monthly |
| Organic Keyword Rankings (top 10) | +20 keywords in 90 days | Monthly |

Create a routine for the analytics agent to compute and report these KPIs:

```
POST /api/companies/{companyId}/routines
{
  "name": "Weekly KPI Report - {product-name}",
  "agentId": "{analytics-agent-id}",
  "description": "Compute all marketing KPIs and post a summary to the CMO.",
  "taskTemplate": {
    "title": "Weekly KPI Report",
    "description": "Calculate all KPIs from the marketing-analytics skill. Flag anomalies. Post results."
  }
}
```

## Step 6 — Create Initial Content Calendar

The content lead must produce a 30-day content calendar within 48 hours of onboarding. The calendar must include:

1. **Week 1**: Launch announcement blog post, 3 social posts per platform, welcome email sequence draft.
2. **Week 2**: First SEO-targeted blog post, video script for product overview, community seeding posts.
3. **Week 3**: Case study or comparison post, newsletter #1, paid ad creative v1.
4. **Week 4**: Technical deep-dive blog post, retargeting campaign launch, email nurture sequence live.

Create a task for the content lead:

```
POST /api/companies/{companyId}/issues
{
  "title": "Create 30-day content calendar for {product-name}",
  "description": "Build the initial content calendar covering weeks 1-4. Include blog posts, social posts, email sequences, and video scripts. Reference the marketing-content skill for quality gates.",
  "assigneeAgentId": "{content-lead-id}",
  "projectId": "{project-id}",
  "priority": "high",
  "status": "todo"
}
```

## Step 7 — Set Up Competitor Monitoring

Identify 3-5 direct competitors and configure monitoring:

1. **Keyword overlap tracking**: SEO specialist monitors shared keywords weekly.
2. **Content gap analysis**: Content lead runs monthly gap analysis using the marketing-seo skill.
3. **Pricing and feature tracking**: CRO specialist monitors competitor pricing pages monthly.
4. **Social listening**: Social manager tracks competitor brand mentions daily.
5. **Ad creative monitoring**: Paid manager reviews competitor ad libraries weekly.

Create a routine for competitor monitoring:

```
POST /api/companies/{companyId}/routines
{
  "name": "Weekly Competitor Scan - {product-name}",
  "agentId": "{seo-specialist-id}",
  "description": "Run competitor keyword analysis, content gap check, and ad library review. Summarize findings for CMO.",
  "taskTemplate": {
    "title": "Weekly Competitor Scan",
    "description": "Execute competitor analysis per marketing-seo skill. Report new threats and opportunities."
  }
}
```

## Step 8 — Validation Checklist

Before marking onboarding complete, verify every item:

- [ ] Paperclip company or project created and accessible
- [ ] All 9 marketing agents provisioned and active
- [ ] Budget allocations set and board-approved (if required)
- [ ] UTM conventions documented and shared with all agents
- [ ] Attribution model configured in project metadata
- [ ] CAC targets and KPI thresholds set
- [ ] Weekly KPI reporting routine created
- [ ] 30-day content calendar task assigned
- [ ] Competitor list defined (3-5 competitors)
- [ ] Competitor monitoring routine created
- [ ] All agents have their respective marketing skills assigned

Post the completed checklist as an issue comment and mark the onboarding task as `done`.

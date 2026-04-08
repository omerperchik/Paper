# Marketing Team Operating Manual

## Mission
Maximize marketing ROI for each product. Every dollar spent should be tracked, measured, and optimized. The team operates as an autonomous marketing department with human oversight via the approval queue.

## Core Principles

### 1. CAC Obsession
- Every channel has a measurable Customer Acquisition Cost
- Track spend and conversions daily, calculate CAC weekly
- Target LTV:CAC ratio of 3:1 or better
- If a channel's CAC rises above threshold, reduce spend immediately
- Always calculate payback period before scaling a channel

### 2. Test Everything
- No campaign launches without a hypothesis
- A/B test systematically: one variable at a time
- Use statistical significance (p < 0.05) before declaring winners
- Maintain an experiment playbook of proven winners

### 3. Content Quality Gate
- All public-facing content must pass the humanizer check (score >= 80)
- Banned AI words: delve, leverage, seamless, cutting-edge, game-changing, robust, paradigm, synergy, holistic, utilize, innovative, empower, transform, revolutionize, streamline, harness, unlock, elevate, optimize, curate
- Expert panel review for high-stakes content (blog posts, landing pages, ad copy)
- Recursive improvement: score -> revise -> re-score, up to 3 rounds

### 4. Approval Queue
- All spend decisions require approval (yellow/red priority)
- All public posts/comments require approval
- Content-only items can be green priority (auto-approve if score >= 90)
- Budget reallocations over 20% require red priority approval

### 5. Multi-Product Isolation
- Each product has its own dedicated marketing team
- Teams share learnings via the meta-optimizer but operate independently
- Budgets are strictly per-product
- Cross-product campaigns require explicit CMO approval

## Org Chart

```
CEO
 └── CMO (Chief Marketing Officer)
      ├── Content Strategist
      ├── SEO Specialist
      ├── Paid Acquisition Manager
      ├── Social Media Manager
      ├── Email Marketing Specialist
      ├── Analytics Lead
      ├── Community Manager
      ├── Conversion Rate Optimizer
      └── Meta Optimizer
```

## Communication
- Use Paperclip issues for all task coordination
- Comment on issues with structured updates: status, metrics, next steps
- Tag relevant agents when cross-functional work is needed
- Daily briefs from Analytics Lead, weekly reports from CMO

## Budget Management
- Monthly budgets set per agent by CMO
- Real-time spend tracking via marketing_track_spend tool
- Auto-pause at 100% budget (hard stop)
- Warning at 80% budget
- Budget rebalancing proposals go through CMO approval

## Attribution Model
- Default: last-touch attribution
- UTM parameter conventions: utm_source, utm_medium, utm_campaign, utm_content, utm_term
- All links must be tagged
- Weekly attribution reconciliation by Analytics Lead

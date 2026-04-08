---
name: marketing-seo
description: >
  SEO workflows for the marketing SEO agent. Covers keyword research, on-page
  optimization, technical SEO auditing, striking-distance keyword identification,
  content gap analysis, competitor tracking, schema markup generation, and
  internal linking strategy.
version: "1.0.0"
author: marketing-team
tags:
  - marketing
  - seo
  - keywords
  - technical-seo
  - schema
  - internal-linking
---

# Marketing SEO Skill

Use this skill for all SEO workflows: keyword research, on-page optimization, technical audits, content gap analysis, and schema markup. This skill feeds keyword targets to the marketing-content skill and receives performance data from marketing-analytics.

## 1. Keyword Research

### Step 1 — Seed Keyword Expansion

1. Start with seed keywords from the product brief or campaign goal.
2. Expand using these methods:
   - **Autocomplete mining**: Pull Google autocomplete suggestions for each seed.
   - **Related searches**: Capture "People also ask" and "Related searches" data.
   - **Competitor keywords**: Extract keywords ranking for top 3 competitors.
   - **Modifier stacking**: Combine seeds with modifiers (best, how to, vs, alternative, review, pricing, free, template).

3. Deduplicate and cluster keywords by search intent:

| Intent Type | Signal Words | Example |
|-------------|-------------|---------|
| Informational | how, what, why, guide, tutorial | "how to reduce churn" |
| Navigational | brand name, login, pricing page | "paperclip pricing" |
| Commercial | best, review, comparison, vs, alternative | "best project management tool" |
| Transactional | buy, sign up, free trial, discount | "project management free trial" |

### Step 2 — Keyword Prioritization

Score each keyword cluster on a 1-10 scale across three dimensions:

```
priority_score = (relevance * 0.4) + (opportunity * 0.35) + (feasibility * 0.25)

relevance: How closely does this match our product and audience? (1-10)
opportunity: Monthly search volume * CTR potential (1-10)
feasibility: Inverse of competition difficulty — can we rank page 1 in 90 days? (1-10)
```

### Step 3 — Output

Deliver a prioritized keyword map:

```markdown
| Cluster | Primary Keyword | Volume | KD | Intent | Priority | Target Page |
|---------|----------------|--------|-----|--------|----------|-------------|
| {name} | {keyword} | {vol} | {kd} | {type} | {score} | {url or "new"} |
```

## 2. Striking-Distance Keywords (Positions 11-20)

These are the highest-ROI optimization targets: keywords already ranking on page 2 that need a push to page 1.

### Step 1 — Identification

1. Pull all keywords where the site currently ranks positions 11-20.
2. Filter for keywords with monthly search volume >= 100.
3. Sort by `volume * (21 - current_position)` to prioritize high-volume keywords closest to page 1.

### Step 2 — Optimization Actions

For each striking-distance keyword:

1. **Content audit**: Review the ranking page. Is the keyword in the H1, first paragraph, and at least one H2?
2. **Content depth**: Compare word count and subtopic coverage against the top 3 results for that keyword.
3. **Internal linking**: Add 3-5 internal links pointing to the ranking page using the target keyword or close variants as anchor text.
4. **Content freshness**: Update any outdated statistics, screenshots, or references.
5. **Featured snippet optimization**: If a featured snippet exists, format a direct answer (40-60 words) near the top of the page.

### Step 3 — Tracking

Create a tracking table updated weekly:

```markdown
| Keyword | Start Position | Current Position | Page | Actions Taken | Date |
|---------|---------------|-----------------|------|---------------|------|
```

Flag any keyword that moves from page 2 to page 1 as a win. Flag any that drops below position 25 for investigation.

## 3. Content Gap Analysis

### Step 1 — Competitor Content Mapping

1. Select top 5 competitors.
2. For each competitor, extract:
   - All indexed pages (via sitemap or crawl)
   - Estimated organic traffic per page
   - Primary keyword per page
3. Build a topic matrix: rows = topics, columns = competitors, cells = whether they cover it.

### Step 2 — Gap Identification

1. Find topics covered by 2+ competitors but not by us.
2. Find topics where our content exists but ranks below position 20 while competitors rank top 10.
3. Find topics where no competitor has strong content (blue ocean opportunities).

### Step 3 — Prioritization

```
gap_score = competitor_coverage_count * avg_competitor_traffic * (1 / our_current_rank_or_999)
```

Sort descending. The top 10 gaps become content briefs for the marketing-content skill.

## 4. On-Page Optimization

### Checklist (run for every new or updated page)

#### Title Tag
- [ ] Primary keyword included, preferably near the start
- [ ] Under 60 characters
- [ ] Unique across the site
- [ ] Compelling — would a user click this in search results?

#### Meta Description
- [ ] Primary keyword included
- [ ] Under 155 characters
- [ ] Contains a clear value proposition or CTA
- [ ] Unique across the site

#### Headings
- [ ] Single H1 containing the primary keyword
- [ ] H2s cover major subtopics and include secondary keywords where natural
- [ ] Logical heading hierarchy (no skipping levels)

#### Content Body
- [ ] Primary keyword in the first 100 words
- [ ] Keyword density between 0.5% and 2%
- [ ] No keyword stuffing — every mention reads naturally
- [ ] Minimum word count meets or exceeds SERP average for the target keyword

#### Images
- [ ] All images have descriptive alt text
- [ ] File names are descriptive (not IMG_001.jpg)
- [ ] Images are compressed (WebP preferred, under 200KB)

#### URL Structure
- [ ] Short, descriptive, includes primary keyword
- [ ] Hyphens between words, no underscores
- [ ] No unnecessary parameters or session IDs

## 5. Technical SEO Audit

Run this audit monthly or after any major site change.

### Crawlability
1. Check robots.txt for unintended blocks.
2. Verify XML sitemap is submitted, up to date, and contains no 4xx/5xx URLs.
3. Check crawl budget: are low-value pages consuming crawl resources?

### Indexation
1. Compare indexed page count (site: search) against sitemap page count.
2. Identify pages with `noindex` tags — are any set unintentionally?
3. Check for duplicate content: pages with identical or near-identical title tags or body content.

### Performance
1. Core Web Vitals for top 20 pages by traffic:
   - **LCP** (Largest Contentful Paint): target < 2.5s
   - **INP** (Interaction to Next Paint): target < 200ms
   - **CLS** (Cumulative Layout Shift): target < 0.1
2. Mobile usability: no horizontal scroll, tap targets >= 48px, readable font sizes.
3. HTTPS: all pages served over HTTPS, no mixed content warnings.

### Structured Data
1. Verify JSON-LD schema is present on all applicable pages (see Section 6).
2. Test with schema validation — no errors, warnings reviewed.

### Output

```markdown
## Technical SEO Audit — {date}

| Category | Issues Found | Severity | Action Required |
|----------|-------------|----------|-----------------|
| Crawlability | {n} | {high/med/low} | {description} |
| Indexation | {n} | {high/med/low} | {description} |
| Performance | {n} | {high/med/low} | {description} |
| Structured Data | {n} | {high/med/low} | {description} |
```

## 6. Schema Markup

### Supported Schema Types

| Page Type | Schema Type | Required Properties |
|-----------|------------|-------------------|
| Blog post | Article | headline, author, datePublished, dateModified, image |
| Product page | Product | name, description, offers (price, currency, availability) |
| FAQ page | FAQPage | mainEntity (array of Question + acceptedAnswer) |
| How-to guide | HowTo | name, step (array of HowToStep with text) |
| Review page | Review | itemReviewed, reviewRating, author |
| Organization | Organization | name, url, logo, contactPoint |

### Generation Procedure

1. Identify page type from URL pattern and content structure.
2. Extract required properties from page content.
3. Generate JSON-LD block.
4. Validate against schema.org specifications.
5. Test with Google Rich Results Test equivalent checks.

## 7. Internal Linking Strategy

### Link Equity Distribution

1. Identify the top 10 pages by desired importance (conversion pages, pillar content).
2. Count current internal links pointing to each.
3. Target: high-priority pages should have 3-5x more internal links than average pages.

### Linking Procedure

1. For each new piece of content, identify 3-5 existing pages to link to.
2. For each new piece of content, identify 2-3 existing pages that should link back to it.
3. Use descriptive anchor text that includes the target page's primary keyword.
4. Avoid generic anchors ("click here", "read more", "this article").
5. Distribute links naturally within the body content, not clustered at the end.

### Orphan Page Detection

Run monthly:
1. Crawl the site and identify pages with zero internal links pointing to them.
2. For each orphan page: either add internal links from relevant pages or consider deindexing if the page has no value.

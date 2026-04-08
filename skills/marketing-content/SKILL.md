---
name: marketing-content
description: >
  Content creation workflows for the marketing content agent. Covers blog post
  creation with SEO optimization, video script generation with humanizer quality
  gate, social media post creation with platform-specific formatting, expert panel
  review, banned AI word enforcement, and recursive improvement scoring.
version: "1.0.0"
author: marketing-team
tags:
  - marketing
  - content
  - blog
  - video
  - social-media
  - copywriting
  - humanizer
---

# Marketing Content Skill

Use this skill for all content creation workflows: blog posts, video scripts, social media posts, and any customer-facing copy. All content must pass the humanizer quality gate before publishing.

## Banned AI Words

The following words are banned from all content output. Each occurrence incurs a -3 point penalty during scoring.

```
delve, leverage, seamless, cutting-edge, game-changing, robust, paradigm,
synergy, holistic, utilize, innovative, empower, transform, revolutionize,
streamline, harness, unlock, elevate, optimize, curate, bespoke, nuance,
comprehensive, meticulous, pivotal, intricate, testament, landscape, journey,
navigating, realm, foster, spearhead, groundbreaking, paramount, facilitate,
encompass, embark, culminate, resonate
```

## Scoring System

Every piece of content is scored on a 0-100 scale before publishing.

| Violation | Penalty |
|-----------|---------|
| Banned word (each occurrence) | -3 points |
| AI pattern phrase (e.g., "In today's fast-paced world", "In the ever-evolving", "It's important to note") | -5 points |
| Rule-of-three pattern (e.g., "faster, smarter, and better") | -2 points |

Starting score is 100. Content must reach a minimum score of **80** to pass. If it fails, the system runs recursive improvement for up to 3 rounds.

### Recursive Improvement Procedure

```
round = 0
score = evaluate(content)

while score < 80 and round < 3:
    violations = list_all_violations(content)
    content = rewrite_fixing_violations(content, violations)
    round += 1
    score = evaluate(content)

if score < 80:
    flag_for_human_review(content, score, violations)
```

## Expert Panel Review

All content is evaluated by a simulated expert panel. Each panelist reviews independently before the final score is computed.

| Panelist | Focus Area | Pass Criteria |
|----------|-----------|---------------|
| **CMO** | Strategic alignment, brand voice, target audience fit | Content supports current campaign goals |
| **Skeptical User** | Credibility, specificity, would-I-actually-read-this test | No vague claims, no filler paragraphs, every sentence earns its place |
| **Copywriter** | Flow, hooks, CTA strength, readability grade level | Flesch-Kincaid grade 6-8 for blog, 5-7 for social |
| **Humanizer** | AI detection, natural voice, conversational tone | Humanizer score >= 80/100 |

### Panel Procedure

1. Generate the initial draft.
2. Run each panelist evaluation in sequence.
3. Collect per-panelist scores and feedback.
4. If any panelist scores below 70, rewrite addressing their specific feedback.
5. Re-run only the failing panelists after rewrite.
6. Final score = weighted average: CMO 25%, Skeptical User 30%, Copywriter 20%, Humanizer 25%.

## 1. Blog Post Creation with SEO Optimization

### Step 1 — Research and Outline

1. Receive the target keyword or topic from the SEO skill or campaign brief.
2. Pull the top 10 SERP results for the target keyword.
3. Identify content gaps: subtopics covered by competitors but missing from existing content.
4. Create an outline with:
   - H1 headline (include primary keyword, under 60 characters)
   - 4-8 H2 sections based on search intent
   - H3 subsections where depth is needed
   - Target word count (based on SERP average + 10%)

### Step 2 — Draft Generation

1. Write the introduction: open with a specific fact, question, or scenario. Never open with "In today's..." or similar AI patterns.
2. Write each section following the outline, incorporating:
   - Primary keyword in H1, first paragraph, and 1-2 H2s
   - Secondary keywords naturally distributed (1-2% density max)
   - Internal links to 2-4 existing pages
   - One external authoritative source per 500 words
3. Write the conclusion with a clear CTA.
4. Draft meta title (under 60 chars) and meta description (under 155 chars).

### Step 3 — Quality Gate

1. Run the scoring system against the full draft.
2. Run the expert panel review.
3. Execute recursive improvement if score < 80.
4. Verify SEO checklist:
   - [ ] Primary keyword in title, H1, first 100 words, meta description
   - [ ] Alt text drafted for any suggested images
   - [ ] Internal links included (minimum 2)
   - [ ] No duplicate content against existing published posts
   - [ ] Readability score within target range

### Step 4 — Output

Deliver the final post as markdown with frontmatter:

```markdown
---
title: "{title}"
meta_description: "{description}"
primary_keyword: "{keyword}"
secondary_keywords: ["{kw1}", "{kw2}"]
word_count: {n}
humanizer_score: {score}
panel_score: {score}
---

{content}
```

## 2. Video Script Generation

### Step 1 — Brief Intake

1. Receive video topic, target length, and platform (YouTube, TikTok, LinkedIn).
2. Determine format:
   - YouTube long-form: 8-15 minute script with timestamps
   - YouTube Shorts / TikTok: 30-60 second script with hook-first structure
   - LinkedIn: 1-3 minute talking-head script

### Step 2 — Script Structure

For long-form video:

```
[0:00-0:15] HOOK — Pattern interrupt or bold claim. Must create curiosity gap.
[0:15-0:45] CONTEXT — Why this matters to the viewer right now.
[0:45-X:XX] BODY — 3-5 key points, each with:
  - Transition line
  - Key insight
  - Example or proof point
  - Visual/B-roll suggestion
[X:XX-END] CTA — Specific ask (subscribe, comment, link in description).
```

For short-form video:

```
[0:00-0:03] HOOK — First sentence must stop the scroll.
[0:03-0:25] VALUE — One clear takeaway, delivered fast.
[0:25-0:30] CTA — Simple, single action.
```

### Step 3 — Humanizer Quality Gate

1. Read the script aloud mentally. Flag any sentence that sounds written rather than spoken.
2. Replace formal constructions with conversational ones:
   - "It is important to consider" -> "Here's the thing"
   - "One might argue" -> "Some people say"
   - "In conclusion" -> cut entirely or use natural wrap-up
3. Run the scoring system. Video scripts have a higher humanizer weight: CMO 20%, Skeptical User 25%, Copywriter 20%, Humanizer 35%.
4. Execute recursive improvement if needed.

### Step 4 — Output

```markdown
---
platform: "{platform}"
target_length: "{duration}"
humanizer_score: {score}
---

## Script

{script with speaker directions in brackets}

## Visual Notes

{suggested B-roll, graphics, text overlays}
```

## 3. Social Media Post Creation

### Platform-Specific Formats

#### Twitter/X
- Maximum 280 characters for single tweet
- Thread format: 3-7 tweets for longer content
- Rules: No hashtag spam (max 2), no links in first tweet of thread, hook in first tweet

#### LinkedIn
- Optimal length: 1,200-1,500 characters
- Format: Short opening line, line breaks between paragraphs, end with question or CTA
- Rules: Professional but not corporate, first-person voice, no emoji walls

#### Instagram
- Caption: 125-150 characters for feed (truncation point), up to 2,200 max
- Format: Hook line, body, CTA, hashtag block (20-30 relevant hashtags in first comment)
- Rules: Visual-first platform — always suggest image/carousel concept

#### TikTok
- Caption: Under 150 characters
- Format: Hook text + video concept description
- Rules: Trend-aware, use current sounds/formats when relevant

### Post Creation Procedure

1. Receive the content brief: topic, platform, campaign, any constraints.
2. Draft 3 variants per platform.
3. Score each variant through the scoring system.
4. Run expert panel (Skeptical User weight increased to 35% for social).
5. Select the highest-scoring variant.
6. Format for the target platform.

### Output

```markdown
---
platform: "{platform}"
campaign: "{campaign_name}"
humanizer_score: {score}
variant_selected: {1|2|3}
---

## Selected Post

{post content}

## Alternate Variants

### Variant 2
{content}

### Variant 3
{content}
```

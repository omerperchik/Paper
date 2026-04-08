// ---------------------------------------------------------------------------
// Content quality tools: humanizer check, expert panel, content calendar, SEO
// ---------------------------------------------------------------------------

import type { PluginContext } from "../types.js";

const BANNED_AI_WORDS = [
  "delve", "leverage", "seamless", "cutting-edge", "game-changing", "robust",
  "paradigm", "synergy", "holistic", "utilize", "innovative", "empower",
  "transform", "revolutionize", "streamline", "harness", "unlock", "elevate",
  "optimize", "curate", "bespoke", "nuance", "comprehensive", "meticulous",
  "pivotal", "intricate", "testament", "landscape", "journey", "navigating",
  "realm", "foster", "spearhead", "groundbreaking", "paramount", "facilitate",
  "encompass", "embark", "culminate", "resonate",
];

const BANNED_AI_PATTERNS = [
  "in today's fast-paced",
  "in the ever-evolving",
  "let's dive in",
  "without further ado",
  "it's worth noting that",
  "in conclusion",
  "at the end of the day",
  "it goes without saying",
  "needless to say",
  "in this article, we will",
  "are you looking for",
  "look no further",
  "have you ever wondered",
];

export function registerContentTools(ctx: PluginContext) {

  ctx.tools.register("marketing_humanizer_check", async ({ params }) => {
    const { content, strictMode = false } = params as { content: string; strictMode?: boolean };
    const lower = content.toLowerCase();
    const words = content.split(/\s+/).length;

    let score = 100;
    const violations: Array<{ type: string; match: string; penalty: number }> = [];

    // Check banned words
    for (const word of BANNED_AI_WORDS) {
      const regex = new RegExp(`\\b${word}\\b`, "gi");
      const matches = content.match(regex);
      if (matches) {
        const penalty = matches.length * 3;
        score -= penalty;
        violations.push({ type: "banned_word", match: word, penalty });
      }
    }

    // Check banned patterns
    for (const pattern of BANNED_AI_PATTERNS) {
      if (lower.includes(pattern.toLowerCase())) {
        score -= 5;
        violations.push({ type: "ai_pattern", match: pattern, penalty: 5 });
      }
    }

    // Rule of three detection (X, Y, and Z pattern repeated)
    const ruleOfThreeRegex = /(\w+),\s*(\w+),\s*and\s*(\w+)/g;
    const ruleOfThreeMatches = content.match(ruleOfThreeRegex);
    if (ruleOfThreeMatches && ruleOfThreeMatches.length > 2) {
      const penalty = (ruleOfThreeMatches.length - 2) * 2;
      score -= penalty;
      violations.push({ type: "rule_of_three", match: `${ruleOfThreeMatches.length} instances`, penalty });
    }

    // Strict mode: additional checks
    if (strictMode) {
      // Check for excessive exclamation marks
      const exclamations = (content.match(/!/g) || []).length;
      if (exclamations > 2) {
        const penalty = (exclamations - 2) * 2;
        score -= penalty;
        violations.push({ type: "excessive_exclamation", match: `${exclamations} exclamation marks`, penalty });
      }

      // Check for overly long sentences (> 35 words)
      const sentences = content.split(/[.!?]+/).filter(Boolean);
      const longSentences = sentences.filter((s) => s.split(/\s+/).length > 35);
      if (longSentences.length > 0) {
        score -= longSentences.length * 2;
        violations.push({ type: "long_sentences", match: `${longSentences.length} sentences > 35 words`, penalty: longSentences.length * 2 });
      }
    }

    score = Math.max(0, Math.min(100, score));

    return {
      score,
      passed: score >= 80,
      wordCount: words,
      violations,
      summary: score >= 90 ? "Excellent — reads naturally"
        : score >= 80 ? "Good — minor AI patterns detected"
        : score >= 60 ? "Needs revision — several AI patterns found"
        : "Significant rewrite needed — heavy AI language",
    };
  });

  ctx.tools.register("marketing_expert_panel", async ({ params }) => {
    const { content, contentType, targetAudience } = params as {
      content: string;
      contentType: string;
      targetAudience?: string;
    };

    // Simulated expert panel — each expert evaluates on their axis
    const experts = [
      { name: "CMO", lens: "strategic-alignment", weight: 1.0 },
      { name: "Skeptical User", lens: "value-proposition", weight: 1.0 },
      { name: "CRO Expert", lens: "conversion-potential", weight: 1.0 },
      { name: "Copywriter", lens: "clarity-and-engagement", weight: 1.0 },
      { name: "Humanizer", lens: "authenticity", weight: 1.5 },
    ];

    const wordCount = content.split(/\s+/).length;
    const hasCallToAction = /click|sign up|try|start|get|join|download|subscribe/i.test(content);
    const hasSocialProof = /customer|user|review|rating|testimonial|case study/i.test(content);
    const hasUrgency = /limited|now|today|hurry|don't miss|last chance/i.test(content);

    const scores = experts.map((expert) => {
      let score = 70; // baseline

      // Adjust based on content signals
      if (expert.lens === "conversion-potential") {
        if (hasCallToAction) score += 10;
        if (hasSocialProof) score += 10;
        if (hasUrgency) score += 5;
      }
      if (expert.lens === "clarity-and-engagement") {
        if (wordCount < 50 && contentType === "social") score += 15;
        else if (wordCount > 300 && contentType === "blog") score += 10;
        score += Math.min(10, Math.floor(wordCount / 50));
      }
      if (expert.lens === "authenticity") {
        // Run humanizer check inline
        const lower = content.toLowerCase();
        let penalties = 0;
        for (const word of BANNED_AI_WORDS) {
          if (lower.includes(word)) penalties += 3;
        }
        for (const pattern of BANNED_AI_PATTERNS) {
          if (lower.includes(pattern.toLowerCase())) penalties += 5;
        }
        score = Math.max(0, 95 - penalties);
      }
      if (expert.lens === "strategic-alignment" && targetAudience) {
        score += 5; // bonus for having a defined audience
      }

      return {
        expert: expert.name,
        lens: expert.lens,
        score: Math.min(100, Math.max(0, score)),
        weight: expert.weight,
      };
    });

    const totalWeight = scores.reduce((s, e) => s + e.weight, 0);
    const weightedScore = Math.round(scores.reduce((s, e) => s + e.score * e.weight, 0) / totalWeight);

    return {
      overallScore: weightedScore,
      passed: weightedScore >= 80,
      experts: scores,
      contentType,
      recommendation: weightedScore >= 90 ? "Publish as-is"
        : weightedScore >= 80 ? "Minor polish recommended"
        : weightedScore >= 60 ? "Significant revisions needed"
        : "Rewrite required",
    };
  });

  ctx.tools.register("marketing_content_calendar", async ({ params }) => {
    const { action, entry, filters } = params as {
      action: "list" | "add" | "update" | "remove";
      entry?: Record<string, unknown>;
      filters?: Record<string, unknown>;
    };

    // Content calendar uses plugin state for persistence
    const stateKey = "content-calendar";
    const existing = await ctx.state.get({ scopeKind: "plugin", scopeId: "marketing-tools", stateKey }) as string | null;
    const calendar: Array<Record<string, unknown>> = existing ? JSON.parse(existing) : [];

    switch (action) {
      case "list": {
        let filtered = calendar;
        if (filters) {
          if (filters.channel) filtered = filtered.filter((e) => e.channel === filters.channel);
          if (filters.status) filtered = filtered.filter((e) => e.status === filters.status);
          if (filters.dateFrom) filtered = filtered.filter((e) => (e.scheduledDate as string) >= (filters.dateFrom as string));
          if (filters.dateTo) filtered = filtered.filter((e) => (e.scheduledDate as string) <= (filters.dateTo as string));
        }
        return { entries: filtered, total: filtered.length };
      }
      case "add": {
        const newEntry = { id: `cal_${Date.now()}`, createdAt: new Date().toISOString(), ...entry };
        calendar.push(newEntry);
        await ctx.state.set({ scopeKind: "plugin", scopeId: "marketing-tools", stateKey }, JSON.stringify(calendar));
        return { added: newEntry };
      }
      case "update": {
        const idx = calendar.findIndex((e) => e.id === entry?.id);
        if (idx === -1) return { error: "Entry not found" };
        calendar[idx] = { ...calendar[idx], ...entry, updatedAt: new Date().toISOString() };
        await ctx.state.set({ scopeKind: "plugin", scopeId: "marketing-tools", stateKey }, JSON.stringify(calendar));
        return { updated: calendar[idx] };
      }
      case "remove": {
        const removeIdx = calendar.findIndex((e) => e.id === entry?.id);
        if (removeIdx === -1) return { error: "Entry not found" };
        const removed = calendar.splice(removeIdx, 1)[0];
        await ctx.state.set({ scopeKind: "plugin", scopeId: "marketing-tools", stateKey }, JSON.stringify(calendar));
        return { removed };
      }
    }
  });

  ctx.tools.register("marketing_seo_check", async ({ params }) => {
    const { content, targetKeyword, url, title, metaDescription } = params as {
      content: string;
      targetKeyword: string;
      url?: string;
      title?: string;
      metaDescription?: string;
    };

    const lower = content.toLowerCase();
    const keywordLower = targetKeyword.toLowerCase();
    const wordCount = content.split(/\s+/).length;
    const checks: Array<{ check: string; status: "pass" | "warn" | "fail"; detail: string }> = [];

    // Keyword density
    const keywordOccurrences = (lower.match(new RegExp(keywordLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
    const density = wordCount > 0 ? (keywordOccurrences / wordCount) * 100 : 0;
    if (density >= 0.5 && density <= 2.5) {
      checks.push({ check: "keyword_density", status: "pass", detail: `${density.toFixed(1)}% (ideal: 0.5-2.5%)` });
    } else if (density < 0.5) {
      checks.push({ check: "keyword_density", status: "warn", detail: `${density.toFixed(1)}% — too low, add more keyword mentions` });
    } else {
      checks.push({ check: "keyword_density", status: "warn", detail: `${density.toFixed(1)}% — too high, reduce to avoid keyword stuffing` });
    }

    // Title check
    if (title) {
      const titleHasKeyword = title.toLowerCase().includes(keywordLower);
      const titleLength = title.length;
      checks.push({
        check: "title_keyword",
        status: titleHasKeyword ? "pass" : "fail",
        detail: titleHasKeyword ? "Target keyword found in title" : "Add target keyword to title",
      });
      checks.push({
        check: "title_length",
        status: titleLength >= 30 && titleLength <= 60 ? "pass" : "warn",
        detail: `${titleLength} chars (ideal: 30-60)`,
      });
    }

    // Meta description
    if (metaDescription) {
      const metaHasKeyword = metaDescription.toLowerCase().includes(keywordLower);
      const metaLength = metaDescription.length;
      checks.push({
        check: "meta_keyword",
        status: metaHasKeyword ? "pass" : "warn",
        detail: metaHasKeyword ? "Keyword in meta description" : "Add keyword to meta description",
      });
      checks.push({
        check: "meta_length",
        status: metaLength >= 120 && metaLength <= 160 ? "pass" : "warn",
        detail: `${metaLength} chars (ideal: 120-160)`,
      });
    }

    // Content length
    checks.push({
      check: "content_length",
      status: wordCount >= 300 ? "pass" : "warn",
      detail: `${wordCount} words${wordCount < 300 ? " — aim for 300+ words" : ""}`,
    });

    // Heading structure (check for # or <h tags)
    const hasHeadings = /^#{1,6}\s|<h[1-6]/m.test(content);
    checks.push({
      check: "heading_structure",
      status: hasHeadings ? "pass" : "warn",
      detail: hasHeadings ? "Headings found" : "Add headings (H2, H3) for better structure",
    });

    // Internal/external links
    const linkCount = (content.match(/\[.*?\]\(.*?\)|<a\s/g) || []).length;
    checks.push({
      check: "links",
      status: linkCount > 0 ? "pass" : "warn",
      detail: `${linkCount} links found${linkCount === 0 ? " — add internal and external links" : ""}`,
    });

    const passCount = checks.filter((c) => c.status === "pass").length;
    const score = Math.round((passCount / checks.length) * 100);

    return { score, checks, targetKeyword, wordCount };
  });
}

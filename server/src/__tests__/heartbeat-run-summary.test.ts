import { describe, expect, it } from "vitest";
import {
  summarizeHeartbeatRunResultJson,
  buildHeartbeatRunIssueComment,
  extractDeliverableHeadline,
  withDeliverableHeadline,
} from "../services/heartbeat-run-summary.js";

describe("summarizeHeartbeatRunResultJson", () => {
  it("truncates text fields and preserves cost aliases", () => {
    const summary = summarizeHeartbeatRunResultJson({
      summary: "a".repeat(600),
      result: "ok",
      message: "done",
      error: "failed",
      total_cost_usd: 1.23,
      cost_usd: 0.45,
      costUsd: 0.67,
      nested: { ignored: true },
    });

    expect(summary).toEqual({
      summary: "a".repeat(500),
      result: "ok",
      message: "done",
      error: "failed",
      total_cost_usd: 1.23,
      cost_usd: 0.45,
      costUsd: 0.67,
    });
  });

  it("returns null for non-object and irrelevant payloads", () => {
    expect(summarizeHeartbeatRunResultJson(null)).toBeNull();
    expect(summarizeHeartbeatRunResultJson(["nope"] as unknown as Record<string, unknown>)).toBeNull();
    expect(summarizeHeartbeatRunResultJson({ nested: { only: "ignored" } })).toBeNull();
  });
});

describe("buildHeartbeatRunIssueComment", () => {
  it("uses the final summary text for issue comments on successful runs", () => {
    const comment = buildHeartbeatRunIssueComment({
      summary: "## Summary\n\n- fixed deploy config\n- posted issue update",
    });

    expect(comment).toContain("## Summary");
    expect(comment).toContain("- fixed deploy config");
    expect(comment).not.toContain("Run summary");
  });

  it("falls back to result or message when summary is missing", () => {
    expect(buildHeartbeatRunIssueComment({ result: "done" })).toBe("done");
    expect(buildHeartbeatRunIssueComment({ message: "completed" })).toBe("completed");
  });

  it("returns null when there is no usable final text", () => {
    expect(buildHeartbeatRunIssueComment({ costUsd: 1.2 })).toBeNull();
  });
});

describe("extractDeliverableHeadline", () => {
  it("strips <think> blocks and picks the first markdown heading", () => {
    const content = "<think>reasoning here</think>\n\n# Any.do Positioning Canvas\n\nFirst body paragraph.";
    expect(extractDeliverableHeadline(content)).toBe("Any.do Positioning Canvas");
  });

  it("falls back to a bold-lead line when there is no heading", () => {
    const content = "**Backlog item generated:** Audit onboarding sequence\n\nRest of the deliverable.";
    expect(extractDeliverableHeadline(content)).toBe("Backlog item generated: Audit onboarding sequence");
  });

  it("falls back to the first non-bullet line", () => {
    const content = "- bullet one\n- bullet two\n\nThis is the real lead sentence.";
    expect(extractDeliverableHeadline(content)).toBe("This is the real lead sentence.");
  });

  it("truncates long headlines with an ellipsis", () => {
    const content = `# ${"x".repeat(200)}`;
    const headline = extractDeliverableHeadline(content);
    expect(headline).not.toBeNull();
    expect(headline!.length).toBeLessThanOrEqual(100);
    expect(headline!.endsWith("…")).toBe(true);
  });

  it("returns null for empty or whitespace-only content", () => {
    expect(extractDeliverableHeadline("")).toBeNull();
    expect(extractDeliverableHeadline("<think>only reasoning</think>")).toBeNull();
    expect(extractDeliverableHeadline(null)).toBeNull();
    expect(extractDeliverableHeadline(undefined)).toBeNull();
  });
});

describe("withDeliverableHeadline", () => {
  it("adds a headline field derived from result_json.content", () => {
    const enriched = withDeliverableHeadline({
      content: "# 7-Email Activation Sequence\n\nDetails...",
      provider: "minimax",
    });
    expect(enriched?.headline).toBe("7-Email Activation Sequence");
    expect(enriched?.provider).toBe("minimax");
  });

  it("does not overwrite an existing headline", () => {
    const enriched = withDeliverableHeadline({
      headline: "Precomputed",
      content: "# Different heading",
    });
    expect(enriched?.headline).toBe("Precomputed");
  });

  it("returns the input unchanged when no headline can be extracted", () => {
    const input = { costUsd: 1.2 };
    expect(withDeliverableHeadline(input)).toBe(input);
  });

  it("passes through null", () => {
    expect(withDeliverableHeadline(null)).toBeNull();
  });
});

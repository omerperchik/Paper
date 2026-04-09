function truncateSummaryText(value: unknown, maxLength = 500) {
  if (typeof value !== "string") return null;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

// Strip <think>...</think> blocks (reasoning scratch pads) and leading/trailing
// whitespace. Gemma/minimax adapters emit these verbatim in result_json.content.
function stripThinkBlocks(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

// Extract a short, one-line headline from a full LLM response.
// Priority: first Markdown H1/H2, then the first non-empty non-bullet line,
// then the first sentence. Truncated to ~100 chars.
export function extractDeliverableHeadline(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const body = stripThinkBlocks(raw);
  if (body.length === 0) return null;

  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return null;

  // Prefer an H1 or H2 heading (without the # markers)
  for (const line of lines) {
    const heading = /^#{1,3}\s+(.+?)\s*#*$/.exec(line);
    if (heading) {
      return truncateHeadline(heading[1]);
    }
  }

  // Prefer a **bold lead** line ("**Backlog item generated:** ...")
  for (const line of lines) {
    const bold = /^\*\*(.+?)\*\*\s*[:\-—]?\s*(.*)$/.exec(line);
    if (bold) {
      const label = bold[1].replace(/[:\-—\s]+$/, "").trim();
      const tail = bold[2].trim();
      const combined = tail.length > 0 ? `${label}: ${tail}` : label;
      return truncateHeadline(combined);
    }
  }

  // Otherwise the first non-bullet line
  for (const line of lines) {
    if (/^[-*>\d]/.test(line)) continue;
    return truncateHeadline(line);
  }

  return truncateHeadline(lines[0]);
}

function truncateHeadline(value: string, maxLength = 100): string {
  const cleaned = value
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trimEnd()}…`;
}

// Enrich a resultJson blob with a `headline` field derived from its content.
// Returns a new object (does not mutate) so callers can pass it through Drizzle.
export function withDeliverableHeadline(
  resultJson: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!resultJson || typeof resultJson !== "object" || Array.isArray(resultJson)) {
    return (resultJson ?? null) as Record<string, unknown> | null;
  }
  if (typeof resultJson.headline === "string" && resultJson.headline.trim().length > 0) {
    return resultJson;
  }
  const headline =
    extractDeliverableHeadline(resultJson.content)
    ?? extractDeliverableHeadline(resultJson.summary)
    ?? extractDeliverableHeadline(resultJson.result)
    ?? extractDeliverableHeadline(resultJson.message);
  if (!headline) return resultJson;
  return { ...resultJson, headline };
}

function readNumericField(record: Record<string, unknown>, key: string) {
  return key in record ? record[key] ?? null : undefined;
}

function readCommentText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function summarizeHeartbeatRunResultJson(
  resultJson: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!resultJson || typeof resultJson !== "object" || Array.isArray(resultJson)) {
    return null;
  }

  const summary: Record<string, unknown> = {};
  const textFields = ["summary", "result", "message", "error"] as const;
  for (const key of textFields) {
    const value = truncateSummaryText(resultJson[key]);
    if (value !== null) {
      summary[key] = value;
    }
  }

  const numericFieldAliases = ["total_cost_usd", "cost_usd", "costUsd"] as const;
  for (const key of numericFieldAliases) {
    const value = readNumericField(resultJson, key);
    if (value !== undefined && value !== null) {
      summary[key] = value;
    }
  }

  return Object.keys(summary).length > 0 ? summary : null;
}

export function buildHeartbeatRunIssueComment(
  resultJson: Record<string, unknown> | null | undefined,
): string | null {
  if (!resultJson || typeof resultJson !== "object" || Array.isArray(resultJson)) {
    return null;
  }

  return (
    readCommentText(resultJson.summary)
    ?? readCommentText(resultJson.result)
    ?? readCommentText(resultJson.message)
    ?? null
  );
}

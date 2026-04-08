// ---------------------------------------------------------------------------
// Command Parser — parse natural language commands from WhatsApp messages
// ---------------------------------------------------------------------------

export interface ParsedCommand {
  intent: CommandIntent;
  raw: string;
  params: Record<string, string>;
}

export type CommandIntent =
  | "status"
  | "pause_campaign"
  | "resume_campaign"
  | "get_cac"
  | "get_spend"
  | "get_dashboard"
  | "list_agents"
  | "list_tasks"
  | "approve_all"
  | "help"
  | "unknown";

/**
 * Lightweight pattern-based command parser.
 * Matches common natural language patterns to structured intents.
 * For complex NLU, this would delegate to an LLM — but for now, fast regex
 * matching covers the 80% case.
 */
export class CommandParser {
  private patterns: Array<{
    intent: CommandIntent;
    patterns: RegExp[];
    extractParams?: (match: RegExpMatchArray, raw: string) => Record<string, string>;
  }> = [
    {
      intent: "status",
      patterns: [
        /^status$/i,
        /what'?s\s+(the\s+)?status/i,
        /how('?s| is)\s+(everything|it going|the team)/i,
        /^update$/i,
        /give\s+me\s+an?\s+update/i,
      ],
    },
    {
      intent: "pause_campaign",
      patterns: [
        /pause\s+campaign\s+(.+)/i,
        /stop\s+campaign\s+(.+)/i,
        /halt\s+campaign\s+(.+)/i,
      ],
      extractParams: (match) => ({
        campaignName: (match[1] ?? "").trim(),
      }),
    },
    {
      intent: "resume_campaign",
      patterns: [
        /resume\s+campaign\s+(.+)/i,
        /restart\s+campaign\s+(.+)/i,
        /unpause\s+campaign\s+(.+)/i,
        /start\s+campaign\s+(.+)/i,
      ],
      extractParams: (match) => ({
        campaignName: (match[1] ?? "").trim(),
      }),
    },
    {
      intent: "get_cac",
      patterns: [
        /what'?s\s+(our|the)\s+cac/i,
        /cac\s+(report|breakdown|numbers)/i,
        /customer\s+acquisition\s+cost/i,
        /^cac$/i,
      ],
    },
    {
      intent: "get_spend",
      patterns: [
        /how\s+much\s+(have\s+we|did\s+we)\s+spen[dt]/i,
        /what'?s\s+(our|the)\s+spend/i,
        /spend\s+(report|breakdown|summary)/i,
        /^spend$/i,
        /total\s+spend/i,
      ],
    },
    {
      intent: "get_dashboard",
      patterns: [
        /^dashboard$/i,
        /show\s+(me\s+)?(the\s+)?dashboard/i,
        /daily\s+(brief|report|summary)/i,
        /morning\s+(brief|report)/i,
        /kpi/i,
        /^numbers$/i,
        /^metrics$/i,
      ],
    },
    {
      intent: "list_agents",
      patterns: [
        /list\s+(the\s+)?agents/i,
        /who'?s\s+on\s+the\s+team/i,
        /show\s+(me\s+)?(the\s+)?agents/i,
        /agent\s+status/i,
        /^agents$/i,
        /^team$/i,
      ],
    },
    {
      intent: "list_tasks",
      patterns: [
        /list\s+(the\s+)?tasks/i,
        /open\s+tasks/i,
        /pending\s+tasks/i,
        /what'?s\s+being\s+worked\s+on/i,
        /show\s+(me\s+)?(the\s+)?tasks/i,
        /^tasks$/i,
      ],
    },
    {
      intent: "approve_all",
      patterns: [
        /approve\s+all/i,
        /approve\s+everything/i,
        /lgtm\s+all/i,
      ],
    },
    {
      intent: "help",
      patterns: [
        /^help$/i,
        /^commands$/i,
        /what\s+can\s+(you|i)\s+do/i,
        /^menu$/i,
      ],
    },
  ];

  /** Parse a text message into a structured command, or null if not recognized. */
  parse(text: string): ParsedCommand | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    for (const rule of this.patterns) {
      for (const pattern of rule.patterns) {
        const match = trimmed.match(pattern);
        if (match) {
          const params = rule.extractParams ? rule.extractParams(match, trimmed) : {};
          return {
            intent: rule.intent,
            raw: trimmed,
            params,
          };
        }
      }
    }

    return null;
  }
}

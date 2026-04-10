// Tool schemas injected into adapter context so LLM agents can delegate work
// to teammates via the local Paperclip API.
//
// The schemas use OpenAI function-calling format because that's what
// gemma-local (Ollama native) and the MiniMax fallback both consume. The
// gemma-local execute loop dispatches tool calls back to the local server
// using the agent's short-lived JWT, so any agent that gets these tools can
// list its team, list its issues, create new issues for direct reports, add
// comments, and update issue state.
//
// Keep this list narrow on purpose: every tool we add increases the surface
// the model can hallucinate against, and the loop budget is small. Add new
// tools only when there's a concrete delegation pattern that needs them.

export interface DelegationToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const DELEGATION_TOOL_DEFINITIONS: DelegationToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "paperclipListAgents",
      description:
        "List all agents in your company. Use this to discover your direct reports and teammates so you can delegate work to them by id. Returns id, name, role, title, and status for each agent.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipListIssues",
      description:
        "List issues in your company, optionally filtered by assignee or status. Use this to check what your direct reports are already working on before assigning new work, or to see your own queue.",
      parameters: {
        type: "object",
        properties: {
          assigneeAgentId: {
            type: "string",
            description:
              "Filter to issues assigned to this agent id. Pass your own id to see your queue, or a teammate's id to check their workload.",
          },
          status: {
            type: "string",
            description:
              "Comma-separated list of statuses to include. Common values: backlog, todo, in_progress, in_review, blocked, done, cancelled.",
          },
          limit: {
            type: "number",
            description: "Maximum number of issues to return. Defaults to 25 if omitted.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipCreateIssue",
      description:
        "Create a new issue and (optionally) assign it to a teammate. This is the primary delegation tool: when you decide a teammate should do work, create an issue with title, description, priority, and assigneeAgentId. The assignee will be woken up by the heartbeat service to act on it.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Short, action-oriented title (1 sentence). Required.",
          },
          description: {
            type: "string",
            description:
              "Markdown body explaining the goal, context, acceptance criteria, and any links the assignee needs.",
          },
          assigneeAgentId: {
            type: "string",
            description:
              "Agent id to assign the issue to. Get this from paperclipListAgents. Omit to leave unassigned.",
          },
          priority: {
            type: "string",
            enum: ["low", "medium", "high", "urgent"],
            description: "Issue priority. Defaults to medium.",
          },
          status: {
            type: "string",
            enum: ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"],
            description: "Initial status. Defaults to todo so the assignee picks it up immediately.",
          },
          projectId: {
            type: "string",
            description: "UUID of the project this issue belongs to. Omit to inherit from your own project.",
          },
          handoff: {
            type: "object",
            description:
              "Optional typed handoff packet. When delegating real work (not just a scratch todo), fill this in so the assignee starts with crystal-clear scope instead of rediscovering your intent. Dramatically reduces ping-pong comments. Populate all four fields when possible.",
            properties: {
              goal: {
                type: "string",
                description: "The outcome in one sentence. What 'done' looks like from the user's perspective.",
              },
              constraints: {
                type: "array",
                items: { type: "string" },
                description: "Hard constraints the assignee must respect (budget, timeline, tech choices, brand rules, things NOT to do).",
              },
              successCriteria: {
                type: "array",
                items: { type: "string" },
                description: "Checklist the assignee can self-verify against before calling paperclipDone. Be concrete and testable.",
              },
              budget: {
                type: "object",
                description: "Soft budget hints. Assignee uses these to choose scope and decide whether to escalate.",
                properties: {
                  maxCents: { type: "number", description: "Max billed LLM+tool spend before escalating back." },
                  maxIterations: { type: "number", description: "Max heartbeats the assignee should spend on this before checking in." },
                  deadline: { type: "string", description: "ISO timestamp or natural language ('EOD friday')." },
                },
              },
            },
          },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipAddComment",
      description:
        "Post a comment on an existing issue. Use this to give feedback to a teammate, ask a clarifying question, hand off context, or record progress on your own issue.",
      parameters: {
        type: "object",
        properties: {
          issueId: {
            type: "string",
            description: "UUID of the issue to comment on.",
          },
          body: {
            type: "string",
            description: "Markdown comment body. Be specific and actionable.",
          },
        },
        required: ["issueId", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipAskHuman",
      description:
        "Ask the human operator a question when you are genuinely blocked on a decision that only a human can make (strategy, brand voice, ethical calls, high-cost spend, approval to send external communications). The question becomes a pending approval the operator sees in the UI. Your current heartbeat ends after you ask; on a future heartbeat you will see the answer injected into your context as `answeredHumanQuestions`. Use sparingly — never ask about things you can research, look up, or decide yourself. Never ask the same question twice — check `answeredHumanQuestions` first.",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description:
              "The exact question to ask. Be specific and include enough context that the human can answer in one sentence without follow-ups.",
          },
          context: {
            type: "string",
            description:
              "Background: what you were trying to do, what you already tried, why you are blocked, and what options you are weighing.",
          },
          urgency: {
            type: "string",
            enum: ["low", "normal", "high"],
            description: "How urgent the answer is. Defaults to normal.",
          },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipWebSearch",
      description:
        "Search the public web for up-to-date information. Returns a short list of result titles, URLs, and snippets. Use this for research — competitor analysis, market data, documentation lookups, current events. Follow up with paperclipWebFetch on any URL whose snippet looks promising to get the full page content.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query. Be specific — 'stripe MRR dashboard API 2026' beats 'stripe analytics'.",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of results to return (1–10). Defaults to 5.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipWebFetch",
      description:
        "Fetch the text content of a web page by URL and return it as plain text. Use this after paperclipWebSearch to read the full content of a promising result, or directly with a URL a teammate gave you. Large pages are truncated; the response tells you `originalBytes` and `nextHint` will include the exact `offset` to pass to read the next chunk. Will NOT work for pages behind authentication, JavaScript-only apps, or paywalls.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The fully-qualified URL to fetch (must include https://).",
          },
          offset: {
            type: "number",
            description: "Byte offset to start reading from. Use this for pagination on large pages — call first without offset, then re-call with the offset given in the response's nextHint. Default: 0.",
          },
          maxBytes: {
            type: "number",
            description: "Maximum bytes to return in a single call. Default: 12000. Max: 200000.",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipMemoryWrite",
      description:
        "Persist a memory that survives across heartbeats. Use this to remember facts you learned, decisions you made, things that worked or failed, and context your future self needs. Memories are scoped — 'self' is visible only to you, 'team' is visible to your direct reports and manager, 'company' is visible to everyone in the company. Write a new memory every heartbeat if something non-trivial happened.",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["self", "team", "company"],
            description: "Who can read this memory. Default: self.",
          },
          key: {
            type: "string",
            description: "Short tag like 'q2-strategy' or 'email-copy-that-worked'. Used for grouping and overwrite on conflict.",
          },
          content: {
            type: "string",
            description: "The memory text. Write it as if explaining to your future self: what happened, why it matters, what you should do next time.",
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipMemorySearch",
      description:
        "Search your persistent memories for anything relevant to the current task. Searches your own memories plus team and company scopes you have access to. Call this at the start of any non-trivial task to avoid repeating past mistakes or re-deriving past decisions.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Free-text query. 'What did I learn about email subject lines' or 'past decisions on community platform'.",
          },
          limit: {
            type: "number",
            description: "Max results to return (1–20). Default 8.",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipRepoListFiles",
      description:
        "List files and subdirectories in a GitHub repository path. Use this to navigate a repo before reading or writing. Returns file names, types (file/dir), and sizes.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "GitHub repo in 'owner/name' format, e.g. 'myorg/myapp'." },
          path: { type: "string", description: "Directory path within the repo. Empty or '/' for root." },
          ref: { type: "string", description: "Branch, tag, or commit sha. Defaults to the repo's default branch." },
        },
        required: ["repo"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipRepoReadFile",
      description:
        "Read the contents of a single file from a GitHub repository. Returns the file text (base64-decoded) plus its sha. Large files are truncated; the response tells you `originalBytes` and `nextHint` will include the exact `offset` for the next chunk. Use paperclipRepoListFiles first to find files. Do not use for binary files.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "GitHub repo in 'owner/name' format." },
          path: { type: "string", description: "File path within the repo, e.g. 'src/index.ts'." },
          ref: { type: "string", description: "Branch, tag, or commit sha. Defaults to default branch." },
          offset: { type: "number", description: "Byte offset to start reading from. Use for pagination on large files." },
        },
        required: ["repo", "path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipRepoWriteFile",
      description:
        "Create or update a single file in a GitHub repository on a branch. Creates the branch from baseBranch if it does not exist. This commits directly — use paperclipRepoOpenPr afterward to open a pull request for review. Good for small changes; for multi-file changes, call this repeatedly on the same branch.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "GitHub repo in 'owner/name' format." },
          path: { type: "string", description: "File path within the repo." },
          content: { type: "string", description: "Full file content (UTF-8 text)." },
          message: { type: "string", description: "Commit message describing the change." },
          branch: { type: "string", description: "Branch to commit to. Will be created from baseBranch if missing." },
          baseBranch: { type: "string", description: "Branch to create `branch` from if it doesn't exist. Defaults to the repo's default branch." },
        },
        required: ["repo", "path", "content", "message", "branch"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipRepoOpenPr",
      description:
        "Open a pull request from `head` branch into `base` branch in a GitHub repository. Use after paperclipRepoWriteFile commits your changes. Returns the PR url and number.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "GitHub repo in 'owner/name' format." },
          title: { type: "string", description: "PR title — short, action-oriented." },
          body: { type: "string", description: "PR description in markdown — what changed and why." },
          head: { type: "string", description: "Source branch with the changes." },
          base: { type: "string", description: "Target branch (e.g. 'main'). Defaults to the repo's default branch." },
        },
        required: ["repo", "title", "head"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipAgentStats",
      description:
        "Get an activity leaderboard for your team (your reports_to subtree) or the full company over a recent time window. Shows per-agent counts of heartbeats, issues, comments, memories, and human questions. Use this to decide who to delegate to (pick agents with low queue depth) or to spot teammates who are stuck (0 activity).",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["team", "company"],
            description: "team = your subtree (you + direct/indirect reports). company = all agents. Default: team.",
          },
          window: {
            type: "string",
            description: "Time window like '24h', '7d', '14d', '4w'. Default: 7d.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipDone",
      description:
        "Signal that you are finished with this heartbeat. The tool loop will exit cleanly after this call — use it as soon as you have accomplished what you set out to do. Do NOT keep iterating past the point of diminishing returns. Every extra tool call costs money.",
      parameters: {
        type: "object",
        properties: {
          outcome: {
            type: "string",
            description: "One-paragraph summary of what you accomplished this heartbeat. This is what the human sees in the feed.",
          },
          confidence: {
            type: "string",
            enum: ["low", "medium", "high"],
            description: "How confident are you the outcome is correct? Low means 'someone should double-check this.'",
          },
          openQuestions: {
            type: "array",
            items: { type: "string" },
            description: "Anything you could not resolve this run and want to flag for your next heartbeat or another agent.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipReadWorkingMemory",
      description:
        "Read your persistent working memory — the structured scratchpad of your currentFocus, openThreads, recentDecisions, and expectedResponses. This is how you resume where you left off instead of rebuilding context from scratch. Call this EARLY in every heartbeat if the automatically-injected paperclipWorkingMemory context is missing or stale.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipUpdateWorkingMemory",
      description:
        "Update your persistent working memory at the end of a heartbeat so your future self can resume. Pass only the fields you want to change; others are preserved. currentFocus should be one line; openThreads should list concurrent tasks with a nextStep and (optionally) blockedBy; recentDecisions should record commitments you made; expectedResponses are questions you asked and are waiting on. Keep it terse — this is a cursor, not a journal.",
      parameters: {
        type: "object",
        properties: {
          currentFocus: {
            type: "string",
            description: "One-line description of what you are actively working on right now.",
          },
          openThreads: {
            type: "array",
            description: "Concurrent tasks you have in flight. Max 10.",
            items: {
              type: "object",
              properties: {
                topic: { type: "string" },
                nextStep: { type: "string" },
                blockedBy: { type: "string" },
                lastTouchedAt: { type: "string" },
              },
              required: ["topic", "nextStep"],
            },
          },
          recentDecisions: {
            type: "array",
            description: "Last 10 decisions you committed to.",
            items: {
              type: "object",
              properties: {
                decision: { type: "string" },
                rationale: { type: "string" },
                at: { type: "string" },
              },
              required: ["decision"],
            },
          },
          expectedResponses: {
            type: "array",
            description: "Questions you asked and are waiting on a response for.",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                waitingOn: { type: "string" },
                askedAt: { type: "string" },
              },
              required: ["question", "waitingOn"],
            },
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipReadCompanyState",
      description:
        "Read the shared company world model: current strategy, OKRs, constraints, recent pivots, known truths, and open strategic decisions. Every agent should check this at the top of any non-trivial heartbeat to ensure their work aligns with current strategy (which may have pivoted since last run). Automatically injected into context as `paperclipCompanyState`; this tool is the explicit-read path.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipUpdateCompanyState",
      description:
        "Update the shared company world model. CEO/founder-role ONLY — will return a 403 for other roles. Use this when strategy changes, when you resolve an open decision, when a pivot happens, or when a new hard truth becomes known. All agents will see the update on their next heartbeat automatically — do NOT also post announcement comments; the state is the announcement.",
      parameters: {
        type: "object",
        properties: {
          strategy: {
            type: "object",
            description: "Current strategic posture.",
            properties: {
              currentFocus: { type: "string", description: "One-line current strategic priority." },
              northStar: { type: "string", description: "North-star metric or mission statement." },
              activeBets: { type: "array", items: { type: "string" } },
              killedBets: { type: "array", items: { type: "string" }, description: "Bets we explicitly decided NOT to make — helps subordinates avoid re-proposing them." },
            },
          },
          okrs: {
            type: "array",
            description: "Active OKRs.",
            items: {
              type: "object",
              properties: {
                objective: { type: "string" },
                keyResults: { type: "array", items: { type: "string" } },
                quarter: { type: "string" },
              },
              required: ["objective", "keyResults"],
            },
          },
          constraints: {
            type: "object",
            description: "Hard constraints everyone works within.",
            properties: {
              runwayMonths: { type: "number" },
              monthlyBudgetCents: { type: "number" },
              hardDeadlines: { type: "array", items: { type: "string" } },
            },
          },
          recentPivots: {
            type: "array",
            description: "Last N strategic changes with why. Agents check this to avoid acting on stale context.",
            items: {
              type: "object",
              properties: {
                when: { type: "string" },
                from: { type: "string" },
                to: { type: "string" },
                why: { type: "string" },
              },
              required: ["when", "from", "to", "why"],
            },
          },
          knownTruths: {
            type: "array",
            description: "Facts everyone should know (e.g. 'we picked Vercel over Railway on 3/21 because X').",
            items: {
              type: "object",
              properties: {
                fact: { type: "string" },
                source: { type: "string" },
                at: { type: "string" },
              },
              required: ["fact"],
            },
          },
          openDecisions: {
            type: "array",
            description: "Strategic questions awaiting a decision.",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                options: { type: "array", items: { type: "string" } },
                blockedWork: { type: "string" },
              },
              required: ["question"],
            },
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipEstimateCost",
      description:
        "Before kicking off a large operation, estimate how much it will cost in tool calls + tokens. Returns an estimate and a nextHint telling you whether to proceed or ask a human first. Use this for anything you suspect might burn >$0.25 — research sprees, multi-file repo edits, long tool loops. Thinking about cost before spending it is the cheapest form of alignment.",
      parameters: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            description: "Short description of what you are about to do.",
          },
          estimatedToolCalls: {
            type: "number",
            description: "How many tool calls you expect (1–500).",
          },
          estimatedInputTokens: {
            type: "number",
            description: "Rough input-token guess (optional — tool will estimate from toolCalls if omitted).",
          },
          estimatedOutputTokens: {
            type: "number",
            description: "Rough output-token guess (optional).",
          },
          notes: { type: "string" },
        },
        required: ["operation"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipUpdateIssue",
      description:
        "Update an existing issue's status, priority, assignee, or title. Use this to move issues through the workflow (todo → in_progress → done), reassign work, or escalate priority.",
      parameters: {
        type: "object",
        properties: {
          issueId: {
            type: "string",
            description: "UUID of the issue to update.",
          },
          status: {
            type: "string",
            enum: ["backlog", "todo", "in_progress", "in_review", "blocked", "done", "cancelled"],
          },
          priority: {
            type: "string",
            enum: ["low", "medium", "high", "urgent"],
          },
          assigneeAgentId: {
            type: "string",
            description: "Reassign to this agent id, or null to unassign.",
          },
          title: { type: "string" },
        },
        required: ["issueId"],
      },
    },
  },
  // ========================================================
  // Integration tools — only dispatch if the agent's company
  // has the corresponding provider connected. The route layer
  // returns a clear "not configured" error if not.
  // ========================================================
  {
    type: "function",
    function: {
      name: "paperclipGoogleAdsCreateCampaign",
      description:
        "Create a PAUSED Google Ads campaign. Returns the campaign resource name. Starts paused for safety — an operator must enable it. Budget is in micros (USD × 1,000,000).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Campaign name." },
          budgetMicros: { type: "number", description: "Daily budget in micros. 10_000_000 = $10." },
          advertisingChannelType: {
            type: "string",
            description: "SEARCH | DISPLAY | SHOPPING | VIDEO | PERFORMANCE_MAX. Defaults to SEARCH.",
          },
        },
        required: ["name", "budgetMicros"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipGoogleAdsGetPerformance",
      description:
        "Pull last-N-days performance (impressions, clicks, cost, conversions) for every campaign in the connected Google Ads account.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "7, 14, or 30. Defaults to 7." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipGoogleAdsListCampaigns",
      description:
        "List all campaigns in the connected Google Ads account with id, name, status, and budget. Use this before updating or pausing a specific campaign.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipGoogleAdsUpdateCampaignStatus",
      description:
        "Pause, enable, or remove a Google Ads campaign. Use `paperclipGoogleAdsListCampaigns` first to get the campaignId.",
      parameters: {
        type: "object",
        properties: {
          campaignId: { type: "string" },
          status: { type: "string", enum: ["ENABLED", "PAUSED", "REMOVED"] },
        },
        required: ["campaignId", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipGoogleAdsUpdateCampaignBudget",
      description:
        "Update the daily budget of an existing Google Ads campaign budget. Amount in micros (USD × 1,000,000).",
      parameters: {
        type: "object",
        properties: {
          budgetId: { type: "string", description: "The campaign budget id (NOT the campaign id)." },
          amountMicros: { type: "number" },
        },
        required: ["budgetId", "amountMicros"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipGoogleAdsGetSearchTerms",
      description:
        "Pull the search-terms report (actual queries users typed) with cost and conversions. Essential for finding negative keywords and wasted spend.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "7, 14, or 30. Defaults to 14." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipFacebookAdsCreateCampaign",
      description:
        "Create a PAUSED Facebook (Meta) Ads campaign. Objective must be a valid Meta objective like OUTCOME_SALES, OUTCOME_LEADS, OUTCOME_AWARENESS.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          objective: { type: "string", description: "e.g. OUTCOME_SALES, OUTCOME_LEADS, OUTCOME_TRAFFIC." },
          dailyBudgetCents: { type: "number", description: "Daily budget in cents. 1000 = $10." },
        },
        required: ["name", "objective", "dailyBudgetCents"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipFacebookAdsGetInsights",
      description:
        "Pull insights (spend, impressions, clicks, ctr, cpc, actions) for every campaign in the connected Meta ad account.",
      parameters: {
        type: "object",
        properties: {
          datePreset: {
            type: "string",
            description: "Meta date preset: last_7d, last_14d, last_30d, this_month, etc. Defaults to last_7d.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipFacebookAdsListCampaigns",
      description:
        "List campaigns in the connected Meta ad account with id, name, status, objective, and budget.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipFacebookAdsUpdateCampaignStatus",
      description: "Activate, pause, or archive a Meta Ads campaign.",
      parameters: {
        type: "object",
        properties: {
          campaignId: { type: "string" },
          status: { type: "string", enum: ["ACTIVE", "PAUSED", "ARCHIVED"] },
        },
        required: ["campaignId", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipFacebookAdsCreateAdSet",
      description:
        "Create a PAUSED Meta Ads ad set under an existing campaign. Ad sets hold the targeting (geo, age, interests), budget, and optimization goal. A campaign without an ad set cannot run.",
      parameters: {
        type: "object",
        properties: {
          campaignId: { type: "string" },
          name: { type: "string" },
          dailyBudgetCents: { type: "number", description: "Daily budget in cents." },
          billingEvent: { type: "string", description: "IMPRESSIONS | LINK_CLICKS (default IMPRESSIONS)." },
          optimizationGoal: { type: "string", description: "LINK_CLICKS | REACH | OFFSITE_CONVERSIONS | LANDING_PAGE_VIEWS (default LINK_CLICKS)." },
          bidAmountCents: { type: "number" },
          countries: { type: "array", items: { type: "string" }, description: "ISO country codes. Default ['US']." },
          ageMin: { type: "number" },
          ageMax: { type: "number" },
          interestIds: { type: "array", items: { type: "string" }, description: "Meta interest targeting ids." },
          startTime: { type: "string", description: "ISO datetime. Defaults to now+60s." },
        },
        required: ["campaignId", "name", "dailyBudgetCents"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipXPost",
      description:
        "Post a tweet on X (Twitter) from the connected account. Max 280 characters. Supports reply threads via inReplyToTweetId and quote tweets via quoteTweetId. Use sparingly — every post is public.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Tweet body, ≤280 chars." },
          inReplyToTweetId: { type: "string", description: "Set to continue a thread or reply to another tweet." },
          quoteTweetId: { type: "string", description: "Set to quote-tweet another tweet." },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipXGetTweetMetrics",
      description:
        "Get engagement metrics (impressions, likes, replies, retweets, bookmarks) for up to 100 tweets by id. Use with paperclipXSearch to measure what's resonating.",
      parameters: {
        type: "object",
        properties: {
          tweetIds: { type: "array", items: { type: "string" }, description: "1–100 tweet ids." },
        },
        required: ["tweetIds"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipXSearch",
      description:
        "Search recent tweets on X. Uses the v2 recent-search endpoint. Good for competitor monitoring and brand mentions.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "X search query. Supports operators like from:, -is:retweet, lang:en." },
          maxResults: { type: "number", description: "10–100. Defaults to 10." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipRedditPost",
      description:
        "Submit a post to a subreddit as the connected account. `kind: self` for text posts (use `text`), `kind: link` for URL posts (use `url`). Respect each subreddit's rules.",
      parameters: {
        type: "object",
        properties: {
          subreddit: { type: "string", description: "Target subreddit name without the r/ prefix." },
          title: { type: "string" },
          text: { type: "string", description: "Body for self-posts." },
          url: { type: "string", description: "URL for link posts." },
          kind: { type: "string", enum: ["self", "link"] },
        },
        required: ["subreddit", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipRedditComment",
      description:
        "Reply to a Reddit post or comment. parentFullname must be the Reddit 'fullname' — t3_<id> for a post, t1_<id> for a comment.",
      parameters: {
        type: "object",
        properties: {
          parentFullname: { type: "string", description: "t3_<id> for a post, t1_<id> for a comment." },
          text: { type: "string" },
        },
        required: ["parentFullname", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipRedditSearch",
      description:
        "Search Reddit posts globally or within a subreddit. Returns post ids, titles, scores, and subreddits. Use to find high-signal threads to engage.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          subreddit: { type: "string", description: "Optional: restrict to this subreddit." },
          sort: { type: "string", enum: ["relevance", "hot", "top", "new"] },
          limit: { type: "number", description: "1–100. Defaults to 25." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipTikTokAdsCreateCampaign",
      description:
        "Create a DISABLED TikTok Ads campaign on the connected advertiser. Starts disabled — operator must enable.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          objective: {
            type: "string",
            description: "TikTok objective_type: TRAFFIC, CONVERSIONS, REACH, VIDEO_VIEWS, etc.",
          },
          dailyBudgetUsd: { type: "number", description: "Daily budget in USD." },
        },
        required: ["name", "objective", "dailyBudgetUsd"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipTikTokAdsGetReport",
      description:
        "Pull a basic performance report (spend, impressions, clicks, ctr, conversion) for the connected TikTok Ads advertiser.",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "1–90. Defaults to 7." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipTikTokAdsListCampaigns",
      description: "List campaigns for the connected TikTok advertiser.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipTikTokAdsUpdateCampaignStatus",
      description: "Enable, disable, or delete one or more TikTok Ads campaigns.",
      parameters: {
        type: "object",
        properties: {
          campaignIds: { type: "array", items: { type: "string" } },
          status: { type: "string", enum: ["ENABLE", "DISABLE", "DELETE"] },
        },
        required: ["campaignIds", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipGithubOpenPr",
      description:
        "Open a pull request on GitHub. Requires the `head` branch to already exist on the repo. Use defaults from the integration metadata (defaultOwner/defaultRepo) when owner/repo are omitted.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repo owner. Defaults to integration.defaultOwner." },
          repo: { type: "string", description: "Repo name. Defaults to integration.defaultRepo." },
          title: { type: "string" },
          head: { type: "string", description: "The branch with your changes." },
          base: { type: "string", description: "The branch you want to merge into (e.g. main)." },
          body: { type: "string", description: "PR description (markdown)." },
          draft: { type: "boolean", description: "Open as draft. Defaults to false." },
        },
        required: ["title", "head", "base"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipGithubListIssues",
      description:
        "List issues on a GitHub repo. Useful for triaging bug reports, finding good first issues, or checking on assigned work.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          state: { type: "string", enum: ["open", "closed", "all"], description: "Defaults to open." },
          labels: { type: "string", description: "Comma-separated label names to filter by." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipWordpressPublish",
      description:
        "Create a post on the connected WordPress site. Status defaults to `draft` so operators can review before publishing. Set to `publish` only when the content is final.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          content: { type: "string", description: "Post body (HTML or Gutenberg blocks)." },
          status: { type: "string", enum: ["draft", "publish", "pending"] },
          categories: { type: "array", items: { type: "number" } },
          tags: { type: "array", items: { type: "number" } },
        },
        required: ["title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipWordpressUpdatePost",
      description:
        "Update an existing WordPress post by id. Any field left undefined is kept as-is. Use to iterate on previously drafted content.",
      parameters: {
        type: "object",
        properties: {
          postId: { type: "number" },
          title: { type: "string" },
          content: { type: "string" },
          status: { type: "string", enum: ["draft", "publish", "pending"] },
          featuredMediaId: { type: "number", description: "Media attachment id for the featured image." },
          categories: { type: "array", items: { type: "number" } },
          tags: { type: "array", items: { type: "number" } },
        },
        required: ["postId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipWordpressListPosts",
      description:
        "List WordPress posts. Use before creating a new post to avoid duplicates, or to find a post id to update.",
      parameters: {
        type: "object",
        properties: {
          search: { type: "string", description: "Free-text search across title + content." },
          status: { type: "string", description: "draft | publish | pending | any." },
          perPage: { type: "number", description: "1–100. Defaults to 20." },
          page: { type: "number" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipWordpressUploadMedia",
      description:
        "Upload an image or file to the WordPress media library. Returns the media id which can be used as featuredMediaId in paperclipWordpressUpdatePost. dataBase64 is the file contents base64-encoded.",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string" },
          contentType: { type: "string", description: "e.g. image/jpeg, image/png." },
          dataBase64: { type: "string", description: "File bytes, base64-encoded." },
          altText: { type: "string", description: "Alt text for accessibility + SEO." },
        },
        required: ["filename", "contentType", "dataBase64"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipMakeUgcGenerate",
      description:
        "Generate a UGC-style AI video from a script using MakeUGC. Returns a job id or video URL depending on the plan. Use for rapid ad-creative iteration.",
      parameters: {
        type: "object",
        properties: {
          script: { type: "string", description: "Full spoken script. 1–120 seconds is the sweet spot." },
          avatarId: { type: "string", description: "Overrides the default avatar in metadata." },
          voiceId: { type: "string" },
        },
        required: ["script"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipMakeUgcGetStatus",
      description:
        "Check the status of a MakeUGC video generation job by id. Video generation is async — poll this until status is 'done' and a download URL is returned.",
      parameters: {
        type: "object",
        properties: {
          videoId: { type: "string" },
        },
        required: ["videoId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipSfmcSendEmail",
      description:
        "Trigger a Salesforce Marketing Cloud transactional email via a Triggered Send definition. The triggered send must already exist in SFMC. Useful for onboarding emails, receipts, and alerts.",
      parameters: {
        type: "object",
        properties: {
          triggeredSendKey: {
            type: "string",
            description: "Triggered send definition key. Defaults to integration.defaultTriggeredSendKey.",
          },
          toAddress: { type: "string", description: "Recipient email address." },
          subscriberKey: { type: "string", description: "Defaults to toAddress." },
          attributes: { type: "object", description: "Key/value attributes substituted into the email template." },
        },
        required: ["toAddress"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipFirebasePush",
      description:
        "Send a push notification via Firebase Cloud Messaging. Target either a specific device `token` or a `topic` (pub/sub). Either token OR topic is required.",
      parameters: {
        type: "object",
        properties: {
          token: { type: "string", description: "FCM device token." },
          topic: { type: "string", description: "FCM topic name (e.g. 'all-users')." },
          title: { type: "string" },
          body: { type: "string" },
          data: { type: "object", description: "Extra key/value data payload (strings only)." },
        },
        required: ["title", "body"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipRequestIntegration",
      description:
        "File a request asking the operator to connect a new integration. Use this when you are mid-task and discover you need a provider (e.g. google_ads, facebook_ads, x, reddit, tiktok_ads, github, wordpress, make_ugc, sfmc, firebase) that is not yet connected for this company. The operator will see your request in Settings → Integrations with a one-click 'Connect now' CTA. Provide a crisp reason — the operator decides whether to approve.",
      parameters: {
        type: "object",
        properties: {
          provider: {
            type: "string",
            enum: [
              "google_ads",
              "facebook_ads",
              "x",
              "reddit",
              "tiktok_ads",
              "github",
              "wordpress",
              "make_ugc",
              "sfmc",
              "firebase",
            ],
            description: "The provider you need connected.",
          },
          reason: {
            type: "string",
            description:
              "2–3 sentences: what task you're trying to complete, and why this provider is blocking it. This text is shown verbatim to the operator.",
          },
        },
        required: ["provider", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "paperclipFirebaseSubscribeTopic",
      description:
        "Subscribe (or unsubscribe with `unsubscribe: true`) up to 1000 device tokens to an FCM topic. Use this to segment users for targeted push campaigns.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string" },
          tokens: { type: "array", items: { type: "string" } },
          unsubscribe: { type: "boolean", description: "If true, removes tokens from the topic instead." },
        },
        required: ["topic", "tokens"],
      },
    },
  },
];

/**
 * Returns the tool definitions all gemma-local agents should receive. Kept as
 * a function so we can later filter by role / capability without changing the
 * heartbeat call site.
 */
export function getDelegationToolDefinitions(): DelegationToolDefinition[] {
  return DELEGATION_TOOL_DEFINITIONS;
}

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
        "Fetch the text content of a web page by URL and return it as plain text. Use this after paperclipWebSearch to read the full content of a promising result, or directly with a URL a teammate gave you. Returns truncated text if the page is large. Will NOT work for pages behind authentication, JavaScript-only apps, or paywalls.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The fully-qualified URL to fetch (must include https://).",
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
        "Read the contents of a single file from a GitHub repository. Returns the file text (base64-decoded) plus its sha. Use paperclipRepoListFiles first to find files. Do not use for binary files.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "GitHub repo in 'owner/name' format." },
          path: { type: "string", description: "File path within the repo, e.g. 'src/index.ts'." },
          ref: { type: "string", description: "Branch, tag, or commit sha. Defaults to default branch." },
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
];

/**
 * Returns the tool definitions all gemma-local agents should receive. Kept as
 * a function so we can later filter by role / capability without changing the
 * heartbeat call site.
 */
export function getDelegationToolDefinitions(): DelegationToolDefinition[] {
  return DELEGATION_TOOL_DEFINITIONS;
}

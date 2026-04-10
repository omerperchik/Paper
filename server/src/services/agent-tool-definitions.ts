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

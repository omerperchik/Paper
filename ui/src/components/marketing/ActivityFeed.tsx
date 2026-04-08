import { cn } from "@/lib/utils";
import { Link } from "@/lib/router";
import type { AgentAction } from "@/lib/marketing-api";
import { Bot } from "lucide-react";

interface ActivityFeedProps {
  actions: AgentAction[];
  className?: string;
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay}d ago`;
}

export function ActivityFeed({ actions, className }: ActivityFeedProps) {
  if (actions.length === 0) {
    return (
      <div className={cn("rounded-lg border border-border p-4", className)}>
        <p className="text-sm text-muted-foreground">No recent agent activity.</p>
      </div>
    );
  }

  return (
    <div className={cn("rounded-lg border border-border divide-y divide-border overflow-hidden", className)}>
      {actions.map((action) => (
        <div key={action.id} className="px-4 py-3 flex items-start gap-3 hover:bg-accent/30 transition-colors">
          {/* Agent icon */}
          <div className="mt-0.5 h-6 w-6 rounded-full bg-muted/40 flex items-center justify-center shrink-0">
            <Bot className="h-3.5 w-3.5 text-muted-foreground" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 space-y-0.5">
            <p className="text-sm">
              <span className="font-medium">{action.agentName}</span>
              <span className="text-muted-foreground"> {action.action}</span>
            </p>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>{relativeTime(action.timestamp)}</span>
              {action.issueIdentifier && (
                <>
                  <span>&middot;</span>
                  <Link
                    to={`/issues/${action.issueIdentifier}`}
                    className="text-blue-400 hover:text-blue-300 no-underline"
                  >
                    {action.issueIdentifier}
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

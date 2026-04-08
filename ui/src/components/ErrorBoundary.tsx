import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("[ErrorBoundary] Caught render error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="p-6 m-4 rounded-lg border border-red-500/30 bg-red-950/20">
          <h2 className="text-sm font-semibold text-red-400">Something went wrong</h2>
          <pre className="mt-2 text-xs text-red-300/80 whitespace-pre-wrap break-words max-h-40 overflow-auto">
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-3 px-3 py-1.5 text-xs rounded bg-red-900/50 text-red-200 hover:bg-red-900/70"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

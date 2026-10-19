import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertOctagon, RotateCcw } from 'lucide-react';
import { Button } from './Button';

interface Props {
  children: ReactNode;
  /** Shown instead of the default panel when provided. */
  fallback?: ReactNode;
  /** Label included in the message so a report says which screen failed. */
  scope?: string;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Error boundary.
 *
 * A render-time failure inside one page must not blank the whole application,
 * so each routed page is wrapped individually and can recover without a reload.
 * The error is also logged to the console because a boundary that swallows the
 * stack trace makes production faults unreproducible.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(`[FinRisk] Render failure in ${this.props.scope ?? 'application'}`, error, info.componentStack);
  }

  private readonly reset = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div role="alert" className="card mx-auto mt-8 max-w-xl p-6">
        <div className="flex items-start gap-3">
          <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-hidden />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">
              {this.props.scope ? `${this.props.scope} stopped responding` : 'Something went wrong'}
            </h2>
            <p className="mt-1 text-xs text-muted">
              This screen hit an unexpected error. The rest of the application is unaffected.
            </p>
            <pre className="mt-3 max-h-40 overflow-auto rounded bg-surface-muted p-2 text-2xs text-muted">
              {error.message}
            </pre>
            <Button
              className="mt-4"
              size="sm"
              icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden />}
              onClick={this.reset}
            >
              Retry this screen
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

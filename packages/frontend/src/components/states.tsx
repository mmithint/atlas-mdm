import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The three states every data-backed screen handles (`.agents/skills/crud-ui`):
 * loading holds the layout instead of collapsing it, empty explains itself, and an error
 * says what happened and offers a way forward. Colours come from the theme tokens.
 */

export function LoadingState({
  rows = 3,
  label = 'Loading',
}: {
  readonly rows?: number;
  readonly label?: string;
}) {
  return (
    <div className="space-y-200" role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-600 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  readonly title: string;
  /** One line on why the list is empty or what to do next. */
  readonly hint?: string;
  readonly action?: ReactNode;
}

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-200 rounded-lg border border-dashed border-border bg-card px-600 py-800 text-center">
      <p className="text-400 font-semibold text-foreground">{title}</p>
      {hint ? <p className="max-w-md text-300 text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-200">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  readonly message: string;
  /** Short heading; defaults to a neutral one. */
  readonly title?: string;
  readonly onRetry?: () => void;
}

export function ErrorState({
  message,
  title = "That didn't work",
  onRetry,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex items-start gap-300 rounded-lg border border-destructive bg-card px-400 py-300 text-foreground"
    >
      <TriangleAlert aria-hidden="true" className="icon-size-300 mt-100 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1 text-300">
        <p className="font-semibold">{title}</p>
        <p className="mt-100 break-words text-muted-foreground">{message}</p>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-md px-200 py-100 text-200 font-medium text-brand-foreground underline underline-offset-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

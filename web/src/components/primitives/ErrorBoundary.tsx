/**
 * ErrorBoundary - catches render-time errors in its subtree, shows a
 * recoverable error UI with a retry button, and (optionally) reports
 * the error via the supplied callback.
 *
 * Why this exists: TanStack Router's `errorComponent` only catches
 * loader errors; React rendering errors inside route components crash
 * the entire <Outlet /> tree. Wrapping each tab's content in this
 * primitive turns a crash into a recoverable in-place error.
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase C3
 */
import React from 'react';
import { Body1, Button, Subtitle2, makeStyles, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    padding: '32px',
    color: tokens.colorPaletteRedForeground1,
    textAlign: 'center',
  },
  body: {
    color: tokens.colorNeutralForeground2,
    maxWidth: '480px',
  },
  details: {
    marginTop: '8px',
    padding: '8px 12px',
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
    borderRadius: tokens.borderRadiusMedium,
    fontFamily: 'monospace',
    fontSize: '12px',
    maxWidth: '600px',
    overflowX: 'auto',
    whiteSpace: 'pre-wrap',
    textAlign: 'left',
  },
});

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Custom fallback - if not provided, the default UI is rendered. */
  fallback?: (props: { error: Error; reset: () => void }) => React.ReactNode;
  /** Called whenever a render error is caught. Useful for telemetry. */
  onError?: (error: Error, info: React.ErrorInfo) => void;
  /** Override the default test id. */
  'data-testid'?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Internal default fallback. Extracted so tests can render it directly
 * without going through the class component error path.
 */
function DefaultErrorFallback(props: { error: Error; reset: () => void; testId: string }): React.JSX.Element {
  const classes = useStyles();
  // Stack traces only render in dev so we don't ship server paths or
  // implementation details to the user. import.meta.env.DEV is replaced
  // at build time by Vite.
  const showStack = Boolean(import.meta.env.DEV) && props.error.stack;
  return (
    <div className={classes.root} role="alert" data-testid={props.testId}>
      <Subtitle2 data-testid={`${props.testId}-title`}>Something went wrong</Subtitle2>
      <Body1 className={classes.body} data-testid={`${props.testId}-message`}>
        {props.error.message || 'An unexpected error occurred while rendering this view.'}
      </Body1>
      <Button appearance="primary" onClick={props.reset} data-testid={`${props.testId}-reset`}>
        Try again
      </Button>
      {showStack && (
        <pre className={classes.details} data-testid={`${props.testId}-stack`}>
          {props.error.stack}
        </pre>
      )}
    </div>
  );
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    if (this.props.onError) {
      try {
        this.props.onError(error, info);
      } catch {
        // Don't let a bad onError handler crash the boundary too.
      }
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    const testId = this.props['data-testid'] ?? 'error-boundary';
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback({ error: this.state.error, reset: this.reset });
      }
      return <DefaultErrorFallback error={this.state.error} reset={this.reset} testId={testId} />;
    }
    return this.props.children;
  }
}

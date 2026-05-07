/**
 * ErrorBoundary primitive tests.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { ErrorBoundary } from './ErrorBoundary';

function wrap(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

/** Component that throws on demand. */
function Boomer({ shouldThrow }: { shouldThrow: boolean }): React.JSX.Element {
  if (shouldThrow) {
    throw new Error('boom!');
  }
  return <div data-testid="happy-child">All good</div>;
}

describe('ErrorBoundary', () => {
  // React logs caught errors via console.error - silence the noise so
  // test output stays readable. We restore the original after each test.
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders children when no error is thrown', () => {
    wrap(
      <ErrorBoundary>
        <Boomer shouldThrow={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('happy-child')).toBeInTheDocument();
    expect(screen.queryByTestId('error-boundary')).not.toBeInTheDocument();
  });

  it('catches the error and renders the default fallback', () => {
    wrap(
      <ErrorBoundary>
        <Boomer shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('error-boundary')).toBeInTheDocument();
    expect(screen.getByTestId('error-boundary-title')).toHaveTextContent('Something went wrong');
    expect(screen.getByTestId('error-boundary-message')).toHaveTextContent('boom!');
  });

  it('reset button clears the error and re-renders children', () => {
    function Toggle({ value }: { value: { shouldThrow: boolean } }): React.JSX.Element {
      return <Boomer shouldThrow={value.shouldThrow} />;
    }

    const valueRef = { shouldThrow: true };
    const { rerender } = wrap(
      <ErrorBoundary>
        <Toggle value={valueRef} />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('error-boundary')).toBeInTheDocument();

    // Fix the underlying problem so children render successfully on retry.
    valueRef.shouldThrow = false;
    fireEvent.click(screen.getByTestId('error-boundary-reset'));

    // Force a re-render so the boundary attempts to render its children
    // again with the now-fixed state.
    rerender(
      <FluentProvider theme={webLightTheme}>
        <ErrorBoundary>
          <Toggle value={valueRef} />
        </ErrorBoundary>
      </FluentProvider>,
    );

    expect(screen.queryByTestId('error-boundary')).not.toBeInTheDocument();
    expect(screen.getByTestId('happy-child')).toBeInTheDocument();
  });

  it('invokes onError when a render throws', () => {
    const onError = vi.fn();
    wrap(
      <ErrorBoundary onError={onError}>
        <Boomer shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(onError).toHaveBeenCalledTimes(1);
    const [errorArg] = onError.mock.calls[0];
    expect((errorArg as Error).message).toBe('boom!');
  });

  it('renders a custom fallback when provided', () => {
    wrap(
      <ErrorBoundary
        fallback={({ error, reset }) => (
          <div data-testid="custom-fallback">
            <span>{error.message}</span>
            <button onClick={reset} data-testid="custom-reset">retry</button>
          </div>
        )}
      >
        <Boomer shouldThrow={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('custom-fallback')).toHaveTextContent('boom!');
    // The default fallback testid should NOT appear when a custom one is supplied.
    expect(screen.queryByTestId('error-boundary-title')).not.toBeInTheDocument();
  });

  it('swallows exceptions thrown by onError so the boundary still works', () => {
    const onError = vi.fn(() => {
      throw new Error('telemetry exploded');
    });
    expect(() =>
      wrap(
        <ErrorBoundary onError={onError}>
          <Boomer shouldThrow={true} />
        </ErrorBoundary>,
      ),
    ).not.toThrow();
    expect(onError).toHaveBeenCalled();
    // The boundary still renders its default fallback even though
    // onError blew up.
    expect(screen.getByTestId('error-boundary')).toBeInTheDocument();
  });
});

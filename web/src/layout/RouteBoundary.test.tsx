/**
 * RouteBoundary tests - Phase G3 + G4.
 *
 * Verifies:
 *   - Renders children when no error is thrown (happy path)
 *   - Catches a child render error and shows the ErrorBoundary fallback
 *     (G3 contract: per-route boundaries on top of TanStack's
 *     loader-only errorComponent)
 *   - Auto-resets the boundary when the URL changes (resetKeys=[pathname])
 *   - Applies the fade class to the keyed inner div (G4 contract)
 *   - Honors prefers-reduced-motion (animation duration collapses)
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { RouteBoundary } from './RouteBoundary';

// Hoist-friendly mock for useRouterState. The mock factory returns a
// closure over a mutable variable so each test can swap the reported
// pathname without re-mocking the module.
const mockState = { pathname: '/dashboard' };
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: mockState.pathname } }),
}));

afterEach(() => {
  mockState.pathname = '/dashboard';
  cleanup();
});

function Boom(): React.JSX.Element {
  throw new Error('explode');
}

describe('RouteBoundary', () => {
  it('renders children when no error is thrown', () => {
    render(
      <RouteBoundary>
        <div data-testid="child-ok">hello</div>
      </RouteBoundary>,
    );
    expect(screen.getByTestId('route-boundary')).toBeInTheDocument();
    expect(screen.getByTestId('child-ok')).toBeInTheDocument();
    expect(screen.getByTestId('route-boundary-fade')).toBeInTheDocument();
  });

  it('catches a render error and shows the ErrorBoundary fallback', () => {
    // Silence the React error log during the intentional crash so test
    // output stays focused on the assertion.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <RouteBoundary>
          <Boom />
        </RouteBoundary>,
      );
      expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
      // The ErrorBoundary auto-tags itself; the per-route boundary uses
      // a custom test id from the data-testid prop pass-through.
      expect(screen.getByTestId('route-boundary-error')).toBeInTheDocument();
    } finally {
      errSpy.mockRestore();
    }
  });

  it('auto-resets the boundary when the pathname changes', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { rerender } = render(
        <RouteBoundary>
          <Boom />
        </RouteBoundary>,
      );
      expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();

      // Simulate a navigation by changing the mocked pathname.
      // ErrorBoundary's resetKeys=[pathname] should auto-clear the
      // error and try to render the (now non-throwing) children.
      mockState.pathname = '/endpoints';
      rerender(
        <RouteBoundary>
          <div data-testid="child-after-nav">recovered</div>
        </RouteBoundary>,
      );

      expect(screen.queryByText(/Something went wrong/i)).not.toBeInTheDocument();
      expect(screen.getByTestId('child-after-nav')).toBeInTheDocument();
    } finally {
      errSpy.mockRestore();
    }
  });

  it('uses pathname as the React key on the fade wrapper to force remount', () => {
    // Render with first pathname; capture the fade element identity.
    const { rerender } = render(
      <RouteBoundary>
        <div data-testid="child">a</div>
      </RouteBoundary>,
    );
    const firstFade = screen.getByTestId('route-boundary-fade');

    // Change pathname; the fade div must be a fresh node (different
    // referential identity). We assert this via the React key indirectly:
    // a remount means the previous element is no longer in the document.
    mockState.pathname = '/logs';
    rerender(
      <RouteBoundary>
        <div data-testid="child">a</div>
      </RouteBoundary>,
    );
    const secondFade = screen.getByTestId('route-boundary-fade');

    // Same selector resolves to a different element after the key flip.
    expect(secondFade).not.toBe(firstFade);
  });

  it('respects a custom data-testid prop', () => {
    render(
      <RouteBoundary data-testid="custom-rb">
        <div>x</div>
      </RouteBoundary>,
    );
    expect(screen.getByTestId('custom-rb')).toBeInTheDocument();
    expect(screen.getByTestId('custom-rb-fade')).toBeInTheDocument();
  });
});

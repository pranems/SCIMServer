/**
 * RouteBoundary - per-route ErrorBoundary + fade transition wrapper for
 * the TanStack Router <Outlet />.
 *
 * Phase G3 (error boundaries on every route): wraps the outlet in an
 * `ErrorBoundary` keyed on the current pathname. A render error inside
 * any matched route component is caught here, the ErrorBoundary's
 * "Something went wrong / Try again" UI is shown, and navigating to a
 * different route auto-resets the boundary via `resetKeys` so the user
 * isn't stuck.
 *
 * Phase G4 (transitions): applies a short opacity fade to the outlet
 * subtree on every pathname change. The `key={pathname}` on the inner
 * div forces React to unmount + remount the previous tree, which kicks
 * off a CSS animation that runs in 180 ms and respects the OS
 * `prefers-reduced-motion` preference.
 *
 * Why one wrapper instead of N route-level errorComponents:
 *   - TanStack Router's per-route `errorComponent` only catches loader
 *     errors. Render errors inside a route's component still crash the
 *     entire <Outlet /> tree; only a class-component ErrorBoundary
 *     above <Outlet /> can recover from those.
 *   - Doing this once at the root keeps the route files focused on
 *     their data contracts and avoids 12 copies of the same boundary.
 *
 * Test ids:
 *   `route-boundary`         outer wrapper
 *   `route-boundary-fade`    inner div that gets the keyed remount
 *   `route-boundary-error`   ErrorBoundary fallback (inherited)
 *
 * @see web/src/components/primitives/ErrorBoundary.tsx
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md S10 G3 + G4
 */
import React from 'react';
import { useRouterState } from '@tanstack/react-router';
import { makeStyles, mergeClasses } from '@fluentui/react-components';
import { ErrorBoundary } from '../components/primitives/ErrorBoundary';

const useStyles = makeStyles({
  // Apply a short opacity fade on every pathname change. The opacity
  // animation is intentionally cheap (no transform / no layout) so it
  // stays under one frame on low-end hardware. `prefers-reduced-motion`
  // is honored via a media query so accessibility users see an instant
  // swap with no fade.
  fade: {
    animationName: {
      from: { opacity: 0 },
      to: { opacity: 1 },
    },
    animationDuration: '180ms',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
    '@media (prefers-reduced-motion: reduce)': {
      animationDuration: '0.01ms',
    },
  },
});

export interface RouteBoundaryProps {
  /** The route subtree to wrap. In production this is <Outlet />. */
  children: React.ReactNode;
  /** Override the test id for the outer wrapper. */
  'data-testid'?: string;
}

/**
 * Wrap a route subtree (typically <Outlet />) with an ErrorBoundary that
 * auto-resets on navigation, plus a CSS opacity fade on pathname change.
 *
 * Lives in `layout/` (not `components/primitives/`) because it depends on
 * `useRouterState` from `@tanstack/react-router`, which the primitives
 * layer intentionally doesn't import (so primitives stay framework-free
 * and reusable from Storybook / standalone tests).
 */
export const RouteBoundary: React.FC<RouteBoundaryProps> = ({ children, ...rest }) => {
  const classes = useStyles();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const testId = rest['data-testid'] ?? 'route-boundary';

  return (
    <div data-testid={testId}>
      <ErrorBoundary
        // resetKeys: changes when the URL changes. This makes the
        // boundary auto-recover the next time the user navigates so a
        // crash on /endpoints/A doesn't stick around on /endpoints/B.
        resetKeys={[pathname]}
        data-testid={`${testId}-error`}
        onError={(err) => {
          // Tag the error with the route path so it's discoverable in
          // Application Insights / browser console without context.
          // Intentionally a no-throw best-effort log: any failure here
          // must not propagate (it would re-trigger the boundary).
          // eslint-disable-next-line no-console
          console.error(`[route-boundary] ${pathname}:`, err);
        }}
      >
        <div
          // key={pathname} forces a remount on every navigation, which
          // restarts the CSS keyframe animation defined in classes.fade.
          // Without the key React would re-use the existing div and the
          // animation would only fire on the initial mount.
          key={pathname}
          className={mergeClasses(classes.fade)}
          data-testid={`${testId}-fade`}
        >
          {children}
        </div>
      </ErrorBoundary>
    </div>
  );
};

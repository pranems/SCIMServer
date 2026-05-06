/**
 * __root.tsx - root route for the TanStack Router tree.
 *
 * This is the layout shell that wraps every page in the new URL-driven UI.
 * It renders:
 *   - The existing AppShell (FluentProvider + QueryClientProvider + TokenGate
 *     + Header + Sidebar) which already owns the chrome
 *   - An <Outlet /> where child routes render their content
 *   - <TanStackRouterDevtools /> in dev-only builds
 *
 * Phase A1 is additive only - this file is created but not wired into the
 * application until Phase A2 (cutover). All existing tests remain green.
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase A
 */
import React from 'react';
import { createRootRoute, Outlet } from '@tanstack/react-router';

/**
 * Lazy-load the devtools so they are tree-shaken from production bundles.
 * The component renders nothing in non-dev builds.
 */
const TanStackRouterDevtools = import.meta.env.DEV
  ? React.lazy(() =>
      import('@tanstack/router-devtools').then((m) => ({ default: m.TanStackRouterDevtools })),
    )
  : (() => null) as unknown as React.LazyExoticComponent<React.ComponentType>;

function RootLayout(): React.JSX.Element {
  return (
    <>
      <Outlet />
      {import.meta.env.DEV ? (
        <React.Suspense fallback={null}>
          <TanStackRouterDevtools />
        </React.Suspense>
      ) : null}
    </>
  );
}

export const rootRoute = createRootRoute({
  component: RootLayout,
});

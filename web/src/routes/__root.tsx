/**
 * __root.tsx - root route for the TanStack Router tree.
 *
 * This is the layout shell that wraps every page in the URL-driven UI.
 * It renders:
 *   - The AppShell (FluentProvider + QueryClientProvider + TokenGate +
 *     Header + Sidebar) which owns the chrome
 *   - An <Outlet /> inside the shell's main content area where child
 *     routes render their pages
 *   - <TanStackRouterDevtools /> in dev-only builds
 *
 * Phase A2 (cutover): the root route is now mounted by App.tsx via
 * <RouterProvider router={router} />. The legacy AppRouter regex matcher
 * has been removed from AppShell.
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase A2
 */
import React from 'react';
import { createRootRoute, Outlet } from '@tanstack/react-router';
import { AppShell } from '../layout/AppShell';

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
    <AppShell>
      <Outlet />
      {import.meta.env.DEV ? (
        <React.Suspense fallback={null}>
          <TanStackRouterDevtools />
        </React.Suspense>
      ) : null}
    </AppShell>
  );
}

export const rootRoute = createRootRoute({
  component: RootLayout,
});

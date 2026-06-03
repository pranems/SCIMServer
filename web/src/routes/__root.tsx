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
 * Phase A4 (loaders): the root route is created with
 * `createRootRouteWithContext<{ queryClient }>()` so per-route `loader`
 * functions can call `context.queryClient.ensureQueryData(...)` to
 * pre-fetch data while the next route renders.
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase A2/A4
 */
import React from 'react';
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { makeStyles } from '@fluentui/react-components';
import { AppShell } from '../layout/AppShell';
import { RouteBoundary } from '../layout/RouteBoundary';
import { LoadingSkeleton } from '../components/primitives';

/**
 * Type of the router context. Loaders receive an object of this shape
 * via `loader: ({ context }) => ...` so they can call
 * `context.queryClient.ensureQueryData(opts)`.
 */
export interface RouterContext {
  queryClient: QueryClient;
}

/**
 * Lazy-load the devtools so they are tree-shaken from production bundles.
 * The component renders nothing in non-dev builds.
 */
const TanStackRouterDevtools = import.meta.env.DEV
  ? React.lazy(() =>
      import('@tanstack/router-devtools').then((m) => ({ default: m.TanStackRouterDevtools })),
    )
  : (() => null) as unknown as React.LazyExoticComponent<React.ComponentType>;

/**
 * Phase K1 route loading fallback. Used by the Suspense boundary
 * around the production `<Outlet />` so lazy-loaded route chunks
 * have a single shared loading surface that mirrors the typical
 * page layout (no CLS when the chunk arrives). The skeleton's
 * shape is intentionally generic - per-page LoadingSkeleton on
 * top of the resolved component still shows during data fetch.
 */
const useFallbackStyles = makeStyles({
  root: { padding: '8px' },
});

function RouteLoadingFallback(): React.JSX.Element {
  const classes = useFallbackStyles();
  return (
    <div data-testid="route-loading-fallback" className={classes.root}>
      <LoadingSkeleton count={6} height="40px" />
    </div>
  );
}

function RootLayout(): React.JSX.Element {
  return (
    <AppShell>
      <RouteBoundary>
        <React.Suspense fallback={<RouteLoadingFallback />}>
          <Outlet />
        </React.Suspense>
      </RouteBoundary>
      {import.meta.env.DEV ? (
        <React.Suspense fallback={null}>
          <TanStackRouterDevtools />
        </React.Suspense>
      ) : null}
    </AppShell>
  );
}

export const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

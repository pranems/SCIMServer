/**
 * index.tsx - dashboard route at "/".
 *
 * Mounts DashboardPage as the home route. The loader starts a background
 * prefetch without blocking the application shell on analytics latency.
 * Combined with `defaultPreload: 'intent'` (router.ts), hovering the
 * Dashboard nav link still warms the request before the user clicks.
 */
import React from 'react';
import { createRoute } from '@tanstack/react-router';
import type { QueryClient } from '@tanstack/react-query';
import { rootRoute } from './__root';
import { dashboardQueryOptions } from '../api/queries';

// Phase K1 - lazy-load DashboardPage so it lands in its own chunk
// (dist/assets/DashboardPage-*.js) instead of the main bundle.
const DashboardPage = React.lazy(() =>
  import('../pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);

export function dashboardLoader({
  context,
}: {
  context: { queryClient: Pick<QueryClient, 'prefetchQuery'> };
}): void {
  void context.queryClient.prefetchQuery(dashboardQueryOptions());
}

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
  loader: dashboardLoader,
});

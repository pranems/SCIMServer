/**
 * index.tsx - dashboard route at "/".
 *
 * Mounts DashboardPage as the home route. Phase A4 adds a loader that
 * pre-fetches the BFF dashboard payload via
 * `context.queryClient.ensureQueryData(dashboardQueryOptions())` so the
 * data is in cache by the time the component renders. Combined with
 * `defaultPreload: 'intent'` (router.ts), hovering the Dashboard nav
 * link warms the request before the user clicks.
 */
import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { dashboardQueryOptions } from '../api/queries';

// Phase K1 - lazy-load DashboardPage so it lands in its own chunk
// (dist/assets/DashboardPage-*.js) instead of the main bundle.
const DashboardPage = React.lazy(() =>
  import('../pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQueryOptions()),
});

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
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { DashboardPage } from '../pages/DashboardPage';
import { dashboardQueryOptions } from '../api/queries';

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
  loader: ({ context }) => context.queryClient.ensureQueryData(dashboardQueryOptions()),
});

/**
 * manual-provision.tsx - top-level /manual-provision route (Phase E3).
 *
 * Loader pre-fetches the endpoints list so the picker has a cached
 * value on first render (zero spinner when navigating from any page
 * that already warmed `useEndpoints`).
 */
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { ManualProvisionPage } from '../pages/ManualProvisionPage';
import { endpointsQueryOptions } from '../api/queries';

export const manualProvisionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/manual-provision',
  component: ManualProvisionPage,
  loader: ({ context }) => context.queryClient.ensureQueryData(endpointsQueryOptions()),
});

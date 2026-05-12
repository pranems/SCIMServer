/**
 * manual-provision.tsx - top-level /manual-provision route (Phase E3).
 *
 * Loader pre-fetches the endpoints list so the picker has a cached
 * value on first render (zero spinner when navigating from any page
 * that already warmed `useEndpoints`).
 */
import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { endpointsQueryOptions } from '../api/queries';

// Phase K1 - lazy-load ManualProvisionPage into its own chunk.
const ManualProvisionPage = React.lazy(() =>
  import('../pages/ManualProvisionPage').then((m) => ({ default: m.ManualProvisionPage })),
);

export const manualProvisionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/manual-provision',
  component: ManualProvisionPage,
  loader: ({ context }) => context.queryClient.ensureQueryData(endpointsQueryOptions()),
});

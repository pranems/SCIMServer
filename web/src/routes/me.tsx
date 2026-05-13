/**
 * me.tsx - Phase L2 route at "/me".
 *
 * Mounts MeProfilePage. Loader pre-fetches the endpoints list so the
 * picker is populated on first render. The /Me data itself is NOT
 * pre-fetched in the loader because no endpoint is picked at route
 * mount time and an eager fetch would fan out to N endpoints.
 */
import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { endpointsQueryOptions } from '../api/queries';

// Phase K1 - lazy-load MeProfilePage into its own chunk.
const MeProfilePage = React.lazy(() =>
  import('../pages/MeProfilePage').then((m) => ({ default: m.MeProfilePage })),
);

export const meRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/me',
  component: MeProfilePage,
  loader: ({ context }) => context.queryClient.ensureQueryData(endpointsQueryOptions()),
});

/**
 * discovery.tsx - Phase L5 route at "/discovery".
 *
 * Mounts DiscoveryExplorerPage (lazy) for code splitting per Phase K1.
 * Loader pre-fetches the endpoints list so the scope picker is
 * populated on first render. The per-endpoint Discovery surfaces are
 * NOT pre-fetched (no endpoint is picked at route mount time and
 * eagerly fetching would fan out 3 surfaces x N endpoints).
 */
import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { endpointsQueryOptions } from '../api/queries';

// Phase K1 - lazy-load DiscoveryExplorerPage into its own chunk.
const DiscoveryExplorerPage = React.lazy(() =>
  import('../pages/DiscoveryExplorerPage').then((m) => ({
    default: m.DiscoveryExplorerPage,
  })),
);

export const discoveryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/discovery',
  component: DiscoveryExplorerPage,
  loader: ({ context }) => context.queryClient.ensureQueryData(endpointsQueryOptions()),
});

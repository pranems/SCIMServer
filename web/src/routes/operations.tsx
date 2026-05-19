/**
 * operations.tsx - Phase L6 route at "/operations".
 *
 * Mounts OperationsPage (lazy) for code splitting per Phase K1.
 * No loader pre-fetch - the page hooks fan out to 3 independent
 * surfaces (users / groups / statistics) and only the active sub-tab
 * needs its data fetched eagerly. Each useQuery hook is lazy on its
 * params so the cost is paid on tab switch, not on route mount.
 */
import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';

// Phase K1 - lazy-load OperationsPage into its own chunk.
const OperationsPage = React.lazy(() =>
  import('../pages/OperationsPage').then((m) => ({
    default: m.OperationsPage,
  })),
);

export const operationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/operations',
  component: OperationsPage,
});

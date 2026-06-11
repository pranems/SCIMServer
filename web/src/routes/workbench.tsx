/**
 * workbench.tsx - Phase M1 route at "/workbench".
 *
 * Mounts WorkbenchPage (lazy) for code splitting per Phase K1.
 * Loader pre-fetches the endpoints list so the convenience picker
 * is populated on first render.
 *
 * URL search param `?prefill=<urlencoded-JSON>` seeds method/path/body
 * - the L5 Discovery Explorer's "Open in Workbench" button uses this
 * to deep-link with a prepared request.
 */
import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { endpointsQueryOptions } from '../api/queries';

// Phase K1 - lazy-load WorkbenchPage into its own chunk.
const WorkbenchPage = React.lazy(() =>
  import('../pages/WorkbenchPage').then((m) => ({
    default: m.WorkbenchPage,
  })),
);

export const workbenchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workbench',
  component: WorkbenchPage,
  loader: ({ context }) => context.queryClient.ensureQueryData(endpointsQueryOptions()),
});

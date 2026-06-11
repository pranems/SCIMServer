/**
 * endpoints.new.tsx - Phase L1 route at "/endpoints/new".
 *
 * Mounts CreateEndpointWizard. Loader pre-fetches the presets list
 * (sourced from `GET /scim/admin/endpoints/presets`) so Step 1's
 * picker is populated on first render.
 *
 * IMPORTANT: This route MUST be registered BEFORE
 * `endpointDetailRoute` ("/endpoints/$endpointId") in the route tree
 * so TanStack matches the literal "/new" path before the wildcard
 * `$endpointId` param. router.ts does this ordering explicitly.
 */
import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { presetsQueryOptions } from '../api/queries';

// Phase K1 - lazy-load CreateEndpointWizard into its own chunk.
const CreateEndpointWizard = React.lazy(() =>
  import('../pages/CreateEndpointWizard').then((m) => ({
    default: m.CreateEndpointWizard,
  })),
);

export const createEndpointRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/endpoints/new',
  component: CreateEndpointWizard,
  loader: ({ context }) => context.queryClient.ensureQueryData(presetsQueryOptions()),
});

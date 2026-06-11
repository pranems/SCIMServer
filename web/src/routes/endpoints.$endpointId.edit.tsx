/**
 * endpoints.$endpointId.edit.tsx - Phase L1 route at
 * "/endpoints/$endpointId/edit".
 *
 * Mounts EditEndpointPage with the path param. Loader pre-fetches
 * the endpoint detail so the form is pre-filled on first render.
 */
import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { endpointDetailQueryOptions } from '../api/queries';

// Phase K1 - lazy-load EditEndpointPage into its own chunk.
const EditEndpointPage = React.lazy(() =>
  import('../pages/EditEndpointPage').then((m) => ({
    default: m.EditEndpointPage,
  })),
);

export const editEndpointRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/endpoints/$endpointId/edit',
  component: function EditEndpointRouteComponent() {
    const { endpointId } = editEndpointRoute.useParams();
    return <EditEndpointPage endpointId={endpointId} />;
  },
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(endpointDetailQueryOptions(params.endpointId)),
});

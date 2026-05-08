/**
 * endpoints.$endpointId.schemas.tsx - per-endpoint schemas tab route.
 *
 * Phase D3: nested route under /endpoints/$endpointId. No URL search
 * params - the schemas tree is fully expanded/collapsed via local
 * component state (each user's interaction is private to their tab).
 * Phase A4 loader pre-fetches the schemas list (5min staleTime) so
 * click feels instant.
 */
import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import { SchemasTab } from '../pages/SchemasTab';
import { endpointSchemasQueryOptions } from '../api/queries';

function SchemasTabRouteComponent(): React.JSX.Element {
  const { endpointId } = endpointDetailRoute.useParams();
  return <SchemasTab endpointId={endpointId} />;
}

export const schemasTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: 'schemas',
  component: SchemasTabRouteComponent,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(endpointSchemasQueryOptions(params.endpointId)),
});

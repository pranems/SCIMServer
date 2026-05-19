/**
 * endpoints.$endpointId.resource-types.tsx - Phase M3 nested tab.
 *
 * Mounts ResourceTypesTab (lazy) under the endpoint detail layout,
 * between the Schemas and Credentials tabs. No loader pre-fetch -
 * the page reads from useEndpoint(id) which is already pre-fetched
 * by the parent endpointDetailRoute loader.
 */
import React from 'react';
import { createRoute, useParams } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';

// Phase K1 - lazy-load ResourceTypesTab into its own chunk.
const ResourceTypesTab = React.lazy(() =>
  import('../pages/ResourceTypesTab').then((m) => ({ default: m.ResourceTypesTab })),
);

function ResourceTypesTabRouteComponent(): React.JSX.Element {
  const { endpointId } = useParams({ from: '/endpoints/$endpointId/resource-types' });
  return <ResourceTypesTab endpointId={endpointId} />;
}

export const resourceTypesTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: 'resource-types',
  component: ResourceTypesTabRouteComponent,
});

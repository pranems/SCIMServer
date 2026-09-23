import React from 'react';
import { createRoute, useParams } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import {
  endpointResourceTypesQueryOptions,
  endpointSchemasQueryOptions,
} from '../api/queries';

const GenericResourcesTab = React.lazy(() =>
  import('../pages/GenericResourcesTab').then((module) => ({
    default: module.GenericResourcesTab,
  })),
);

function GenericResourcesTabRouteComponent(): React.JSX.Element {
  const { endpointId, resourceTypeId } = useParams({
    from: '/endpoints/$endpointId/resources/$resourceTypeId',
  });
  return (
    <GenericResourcesTab
      endpointId={endpointId}
      resourceTypeId={resourceTypeId}
    />
  );
}

export const genericResourcesTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: 'resources/$resourceTypeId',
  component: GenericResourcesTabRouteComponent,
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(endpointSchemasQueryOptions(params.endpointId)),
      context.queryClient.ensureQueryData(endpointResourceTypesQueryOptions(params.endpointId)),
    ]);
  },
});
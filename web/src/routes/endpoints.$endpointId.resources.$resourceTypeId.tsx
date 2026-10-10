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
  loader: ({ context, params }) => {
    void context.queryClient
      .prefetchQuery(endpointSchemasQueryOptions(params.endpointId))
      .then(() =>
        context.queryClient.prefetchQuery(
          endpointResourceTypesQueryOptions(params.endpointId),
        ),
      );
  },
});
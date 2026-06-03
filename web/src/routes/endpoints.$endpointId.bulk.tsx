/**
 * endpoints.$endpointId.bulk.tsx - Phase M2 nested tab.
 *
 * Mounts BulkTab (lazy) under the endpoint detail layout, between
 * the Activity and Schemas tabs. No loader pre-fetch - the page
 * starts empty and only fans out a request when the operator clicks
 * Submit.
 */
import React from 'react';
import { createRoute, useParams } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';

// Phase K1 - lazy-load BulkTab into its own chunk.
const BulkTab = React.lazy(() =>
  import('../pages/BulkTab').then((m) => ({ default: m.BulkTab })),
);

function BulkTabRouteComponent(): React.JSX.Element {
  const { endpointId } = useParams({ from: '/endpoints/$endpointId/bulk' });
  return <BulkTab endpointId={endpointId} />;
}

export const bulkTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: 'bulk',
  component: BulkTabRouteComponent,
});

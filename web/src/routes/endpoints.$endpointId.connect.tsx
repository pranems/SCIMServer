/**
 * endpoints.$endpointId.connect.tsx - per-endpoint Connect tab route (WI-5).
 *
 * The ConnectTab consumes useEndpointOverview (which embeds the WI-3
 * connectionInfo) already pre-fetched by the endpoint detail route loader; we
 * re-ensure here for deep-links straight to /connect.
 */
import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import { endpointOverviewQueryOptions } from '../api/queries';

// Lazy-load ConnectTab into its own chunk (a new lazy route -> new size budget).
const ConnectTab = React.lazy(() =>
  import('../pages/ConnectTab').then((m) => ({ default: m.ConnectTab })),
);

function ConnectTabRouteComponent(): React.JSX.Element {
  const { endpointId } = endpointDetailRoute.useParams();
  return <ConnectTab endpointId={endpointId} />;
}

export const connectTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: 'connect',
  component: ConnectTabRouteComponent,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(endpointOverviewQueryOptions(params.endpointId)),
});

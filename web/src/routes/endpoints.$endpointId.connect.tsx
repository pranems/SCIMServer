/**
 * endpoints.$endpointId.connect.tsx - per-endpoint unified "Connect" tab route.
 *
 * P5 - the Connect tab now hosts the UNIFIED method-centric surface (merged
 * Credentials + Connect): per method Setup (create/rotate/reveal/WIF-config) ->
 * Connect (copyable bundle + export, secret when visibility Always) -> Health
 * (recent auth decisions). It is the single auth-management surface; the old
 * separate Credentials tab redirects here.
 */
import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import { endpointOverviewQueryOptions } from '../api/queries';

// Lazy-load the unified tab (CredentialsTab is the merged Connect surface).
const CredentialsTab = React.lazy(() =>
  import('../pages/CredentialsTab').then((m) => ({ default: m.CredentialsTab })),
);

function ConnectTabRouteComponent(): React.JSX.Element {
  const { endpointId } = endpointDetailRoute.useParams();
  return <CredentialsTab endpointId={endpointId} />;
}

export const connectTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: 'connect',
  component: ConnectTabRouteComponent,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(endpointOverviewQueryOptions(params.endpointId)),
});

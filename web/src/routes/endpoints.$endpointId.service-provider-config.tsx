import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import { endpointServiceProviderConfigQueryOptions } from '../api/queries';

const ServiceProviderConfigTab = React.lazy(() =>
  import('../pages/ServiceProviderConfigTab').then((module) => ({
    default: module.ServiceProviderConfigTab,
  })),
);

function ServiceProviderConfigRouteComponent(): React.JSX.Element {
  const { endpointId } = endpointDetailRoute.useParams();
  return <ServiceProviderConfigTab endpointId={endpointId} />;
}

export const serviceProviderConfigTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: 'service-provider-config',
  component: ServiceProviderConfigRouteComponent,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(endpointServiceProviderConfigQueryOptions(params.endpointId)),
});
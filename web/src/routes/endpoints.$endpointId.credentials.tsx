/**
 * endpoints.$endpointId.credentials.tsx - per-endpoint credentials tab route.
 *
 * Phase E1 per UI_REDESIGN_REMAINING_GAPS_PLAN.md S8.1.
 *
 * The CredentialsTab consumes useEndpointOverview which is already
 * pre-fetched by the endpoint detail route loader. We re-ensure here
 * for the case where the user deep-links straight to /credentials
 * (the parent loader still runs, but explicit ensureQueryData makes
 * the dependency obvious).
 */
import { createRoute } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import { CredentialsTab } from '../pages/CredentialsTab';
import { endpointOverviewQueryOptions } from '../api/queries';

function CredentialsTabRouteComponent(): React.JSX.Element {
  const { endpointId } = endpointDetailRoute.useParams();
  return <CredentialsTab endpointId={endpointId} />;
}

export const credentialsTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: 'credentials',
  component: CredentialsTabRouteComponent,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(endpointOverviewQueryOptions(params.endpointId)),
});

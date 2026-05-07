/**
 * endpoints.$endpointId.index.tsx - default ("overview") tab route.
 *
 * Mounted at the bare URL /endpoints/$endpointId (no child segment). Renders
 * the OverviewTab component. Without this index child, navigating to a bare
 * endpoint URL would render the parent layout's <Outlet /> as null.
 *
 * Phase A4: loader pre-fetches the endpoint stats payload so the KPI
 * cards skip the spinner state.
 */
import { createRoute } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import { OverviewTab } from '../pages/OverviewTab';
import { endpointStatsQueryOptions } from '../api/queries';

function OverviewTabRouteComponent(): React.JSX.Element {
  const { endpointId } = endpointDetailRoute.useParams();
  return <OverviewTab endpointId={endpointId} />;
}

export const overviewTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: '/',
  component: OverviewTabRouteComponent,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(endpointStatsQueryOptions(params.endpointId)),
});

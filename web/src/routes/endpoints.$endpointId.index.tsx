/**
 * endpoints.$endpointId.index.tsx - default ("overview") tab route.
 *
 * Mounted at the bare URL /endpoints/$endpointId (no child segment). Renders
 * the OverviewTab component. Without this index child, navigating to a bare
 * endpoint URL would render the parent layout's <Outlet /> as null.
 */
import { createRoute } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import { OverviewTab } from '../pages/OverviewTab';

function OverviewTabRouteComponent(): React.JSX.Element {
  const { endpointId } = endpointDetailRoute.useParams();
  return <OverviewTab endpointId={endpointId} />;
}

export const overviewTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: '/',
  component: OverviewTabRouteComponent,
});

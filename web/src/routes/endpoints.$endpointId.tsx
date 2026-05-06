/**
 * endpoints.$endpointId.tsx - layout route for a single endpoint.
 *
 * Acts as the parent route for the per-endpoint tabs (overview, users,
 * groups, logs, settings). Today it renders the existing EndpointDetailPage
 * which still owns its own internal tab state. Phase A3 will replace that
 * with a thin layout component that renders <Outlet /> for nested tab
 * routes, at which point the children defined in this file's siblings
 * become the actual content surfaces.
 */
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { EndpointDetailPage } from '../pages/EndpointDetailPage';

function EndpointDetailRouteComponent(): React.JSX.Element {
  const { endpointId } = endpointDetailRoute.useParams();
  return <EndpointDetailPage endpointId={endpointId} />;
}

export const endpointDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/endpoints/$endpointId',
  component: EndpointDetailRouteComponent,
});

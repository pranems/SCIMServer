/**
 * endpoints.$endpointId.users.tsx - users tab route.
 *
 * Phase A1: placeholder route registered under the endpoint detail layout.
 * Wires the usersSearchSchema so pagination and SCIM filters live in the
 * URL. Phase A3 will replace EndpointDetailPage's internal tab state with
 * <Outlet /> so this route's component renders directly.
 */
import { createRoute } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import { UsersTab } from '../pages/UsersTab';
import { usersSearchSchema } from './search-schemas';

function UsersTabRouteComponent(): React.JSX.Element {
  const { endpointId } = endpointDetailRoute.useParams();
  return <UsersTab endpointId={endpointId} />;
}

export const usersTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: 'users',
  component: UsersTabRouteComponent,
  validateSearch: usersSearchSchema,
});

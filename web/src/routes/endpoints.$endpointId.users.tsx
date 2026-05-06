/**
 * endpoints.$endpointId.users.tsx - users tab route.
 *
 * Wires the usersSearchSchema so `?page=N&pageSize=N&filter=...` are
 * parsed and exposed via `useSearch` inside UsersTab. State lives in
 * the URL (Phase A3); UsersTab reads via useSearch and updates via
 * useNavigate.
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

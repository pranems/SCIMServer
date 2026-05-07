/**
 * endpoints.$endpointId.users.tsx - users tab route.
 *
 * Wires the usersSearchSchema so `?page=N&pageSize=N&filter=...` are
 * parsed and exposed via `useSearch` inside UsersTab. State lives in
 * the URL (Phase A3); UsersTab reads via useSearch and updates via
 * useNavigate.
 *
 * Phase A4: loader pre-fetches the SCIM Users list using the URL's
 * page/pageSize/filter so the table renders with data on hover, not
 * after click.
 */
import { createRoute } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import { UsersTab } from '../pages/UsersTab';
import { usersSearchSchema } from './search-schemas';
import { endpointUsersQueryOptions } from '../api/queries';

function UsersTabRouteComponent(): React.JSX.Element {
  const { endpointId } = endpointDetailRoute.useParams();
  return <UsersTab endpointId={endpointId} />;
}

export const usersTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: 'users',
  component: UsersTabRouteComponent,
  validateSearch: usersSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page,
    pageSize: search.pageSize,
    filter: search.filter,
  }),
  loader: ({ context, params, deps }) =>
    context.queryClient.ensureQueryData(
      endpointUsersQueryOptions(params.endpointId, {
        startIndex: (deps.page - 1) * deps.pageSize + 1,
        count: deps.pageSize,
        filter: deps.filter,
      }),
    ),
});

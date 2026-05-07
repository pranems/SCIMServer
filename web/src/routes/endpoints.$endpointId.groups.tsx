/**
 * endpoints.$endpointId.groups.tsx - groups tab route.
 *
 * Wires groupsSearchSchema; pagination state is URL-driven (Phase A3).
 * Phase A4 loader pre-fetches the SCIM Groups list using the URL's
 * page/pageSize.
 */
import { createRoute } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import { GroupsTab } from '../pages/GroupsTab';
import { groupsSearchSchema } from './search-schemas';
import { endpointGroupsQueryOptions } from '../api/queries';

function GroupsTabRouteComponent(): React.JSX.Element {
  const { endpointId } = endpointDetailRoute.useParams();
  return <GroupsTab endpointId={endpointId} />;
}

export const groupsTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: 'groups',
  component: GroupsTabRouteComponent,
  validateSearch: groupsSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page,
    pageSize: search.pageSize,
    filter: search.filter,
  }),
  loader: ({ context, params, deps }) =>
    context.queryClient.ensureQueryData(
      endpointGroupsQueryOptions(params.endpointId, {
        startIndex: (deps.page - 1) * deps.pageSize + 1,
        count: deps.pageSize,
        filter: deps.filter,
      }),
    ),
});

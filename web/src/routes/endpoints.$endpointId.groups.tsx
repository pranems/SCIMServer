/**
 * endpoints.$endpointId.groups.tsx - groups tab route.
 *
 * Phase A1 placeholder; Phase A3 will switch to URL-driven pagination
 * via the groupsSearchSchema search params.
 */
import { createRoute } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import { GroupsTab } from '../pages/GroupsTab';
import { groupsSearchSchema } from './search-schemas';

function GroupsTabRouteComponent(): React.JSX.Element {
  const { endpointId } = endpointDetailRoute.useParams();
  return <GroupsTab endpointId={endpointId} />;
}

export const groupsTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: 'groups',
  component: GroupsTabRouteComponent,
  validateSearch: groupsSearchSchema,
});

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
import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import { usersSearchSchema } from './search-schemas';
import { endpointUsersQueryOptions } from '../api/queries';
import { usePreferencesStore } from '../store/preferences-store';

// Phase K1 - lazy-load UsersTab into its own chunk.
const UsersTab = React.lazy(() =>
  import('../pages/UsersTab').then((m) => ({ default: m.UsersTab })),
);

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
  loader: ({ context, params, deps }) => {
    // Phase N4: fall back to the persisted user preference when the URL
    // has no explicit `?pageSize` so loader prefetch matches what the
    // component will request.
    const pageSize = deps.pageSize ?? usePreferencesStore.getState().defaultPageSize;
    return context.queryClient.ensureQueryData(
      endpointUsersQueryOptions(params.endpointId, {
        startIndex: (deps.page - 1) * pageSize + 1,
        count: pageSize,
        filter: deps.filter,
      }),
    );
  },
});

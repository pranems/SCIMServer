/**
 * endpoints.$endpointId.activity.tsx - per-endpoint activity tab route.
 *
 * Phase D2: nested route under /endpoints/$endpointId. URL search
 * params (page / pageSize / type / severity / search) are validated
 * by `activitySearchSchema` and read by the page component via
 * `useSearch`. Phase A4 loader pre-fetches the matching activity
 * page so click feels instant.
 */
import React from 'react';
import { createRoute, useSearch, useNavigate } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import { ActivityTab } from '../pages/ActivityTab';
import { activitySearchSchema, type ActivitySearch } from './search-schemas';
import { endpointActivityQueryOptions } from '../api/queries';

function ActivityTabRouteComponent(): React.JSX.Element {
  const { endpointId } = endpointDetailRoute.useParams();
  const search = useSearch({ from: activityTabRoute.id });
  const navigate = useNavigate({ from: activityTabRoute.id });

  // Adapter from ActivityTab's onSearchChange contract to TanStack
  // Router's typed search merge. Returning `(prev) => merged` lets
  // TanStack Router preserve unrelated keys + drop undefined ones.
  const onSearchChange = React.useCallback(
    (partial: Partial<ActivitySearch>): void => {
      navigate({
        to: '/endpoints/$endpointId/activity',
        params: { endpointId },
        search: (prev) => ({ ...prev, ...partial }),
      });
    },
    [endpointId, navigate],
  );

  return (
    <ActivityTab
      endpointId={endpointId}
      search={search}
      onSearchChange={onSearchChange}
    />
  );
}

export const activityTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: 'activity',
  component: ActivityTabRouteComponent,
  validateSearch: activitySearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page,
    pageSize: search.pageSize,
    type: search.type,
    severity: search.severity,
    search: search.search,
  }),
  loader: ({ context, params, deps }) =>
    context.queryClient.ensureQueryData(
      endpointActivityQueryOptions({
        endpointId: params.endpointId,
        page: deps.page,
        limit: deps.pageSize,
        type: deps.type,
        severity: deps.severity,
        search: deps.search,
      }),
    ),
});

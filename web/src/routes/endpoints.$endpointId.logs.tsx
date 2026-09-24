/**
 * endpoints.$endpointId.logs.tsx - per-endpoint logs tab route.
 *
 * Wires logsSearchSchema; pagination + urlContains filter are
 * URL-driven (Phase A3). Phase A4 loader pre-fetches the matching
 * page of admin logs.
 */
import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import { logsSearchSchema } from './search-schemas';
import { endpointLogsQueryOptions } from '../api/queries';
import { usePreferencesStore } from '../store/preferences-store';
import { timeRangeToSince } from '../components/logs/LogFiltersToolbar';

// Phase K1 - lazy-load LogsTab into its own chunk.
const LogsTab = React.lazy(() =>
  import('../pages/LogsTab').then((m) => ({ default: m.LogsTab })),
);

function LogsTabRouteComponent(): React.JSX.Element {
  const { endpointId } = endpointDetailRoute.useParams();
  return <LogsTab endpointId={endpointId} />;
}

export const logsTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: 'logs',
  component: LogsTabRouteComponent,
  validateSearch: logsSearchSchema,
  loaderDeps: ({ search }) => ({
    page: search.page,
    pageSize: search.pageSize,
    urlContains: search.urlContains,
    method: search.method,
    status: search.status,
    timeRange: search.timeRange,
    hasError: search.hasError,
    minDurationMs: search.minDurationMs,
    requestId: search.requestId,
  }),
  loader: ({ context, params, deps }) => {
    // Phase N4: fall back to the persisted user preference when the URL
    // has no explicit `?pageSize`.
    const pageSize = deps.pageSize ?? usePreferencesStore.getState().defaultPageSize;
    return context.queryClient.ensureQueryData(
      endpointLogsQueryOptions({
        endpointId: params.endpointId,
        page: deps.page,
        pageSize,
        urlContains: deps.urlContains,
        method: deps.method,
        status: deps.status,
        since: timeRangeToSince(deps.timeRange),
        hasError: deps.hasError,
        minDurationMs: deps.minDurationMs,
        requestId: deps.requestId,
      }),
    );
  },
});

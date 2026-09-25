/**
 * logs.tsx - global logs page route at "/logs".
 *
 * Wires globalLogsSearchSchema (page, pageSize, endpointId, status,
 * timeRange, urlContains). LogsPage reads via useSearch and updates
 * via useNavigate (Phase A3 - urlContains today; remaining filter
 * inputs land in Phase D5).
 *
 * Phase A4: loader pre-fetches the global logs page using the
 * URL's urlContains filter.
 */
import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { globalLogsSearchSchema } from './search-schemas';
import { globalLogsQueryOptions } from '../api/queries';
import { timeRangeToSince } from '../components/logs/LogFiltersToolbar';

// Phase K1 - lazy-load LogsPage into its own chunk.
const LogsPage = React.lazy(() =>
  import('../pages/LogsPage').then((m) => ({ default: m.LogsPage })),
);

function LogsRouteComponent(): React.JSX.Element {
  const { since } = logsRoute.useLoaderData();
  return <LogsPage routeSince={since} />;
}

export const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logs',
  component: LogsRouteComponent,
  validateSearch: globalLogsSearchSchema,
  loaderDeps: ({ search }) => ({
    pageSize: search.pageSize,
    urlContains: search.urlContains,
    endpointId: search.endpointId,
    status: search.status,
    timeRange: search.timeRange,
    requestId: search.requestId,
    method: search.method,
    hasError: search.hasError,
    minDurationMs: search.minDurationMs,
  }),
  loader: async ({ context, deps }) => {
    const since = timeRangeToSince(deps.timeRange);
    await context.queryClient.ensureQueryData(
      globalLogsQueryOptions({
        pageSize: deps.pageSize,
        urlContains: deps.urlContains,
        endpointId: deps.endpointId,
        status: deps.status,
        since,
        requestId: deps.requestId,
        method: deps.method,
        hasError: deps.hasError,
        minDurationMs: deps.minDurationMs,
      }),
    );
    return { since };
  },
});

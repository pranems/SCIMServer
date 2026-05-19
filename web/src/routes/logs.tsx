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

// Phase K1 - lazy-load LogsPage into its own chunk.
const LogsPage = React.lazy(() =>
  import('../pages/LogsPage').then((m) => ({ default: m.LogsPage })),
);

export const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logs',
  component: LogsPage,
  validateSearch: globalLogsSearchSchema,
  loaderDeps: ({ search }) => ({
    urlContains: search.urlContains,
  }),
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(
      globalLogsQueryOptions({ urlContains: deps.urlContains }),
    ),
});

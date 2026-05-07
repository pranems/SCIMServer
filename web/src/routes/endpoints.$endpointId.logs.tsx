/**
 * endpoints.$endpointId.logs.tsx - per-endpoint logs tab route.
 *
 * Wires logsSearchSchema; pagination + urlContains filter are
 * URL-driven (Phase A3). Phase A4 loader pre-fetches the matching
 * page of admin logs.
 */
import { createRoute } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import { LogsTab } from '../pages/LogsTab';
import { logsSearchSchema } from './search-schemas';
import { endpointLogsQueryOptions } from '../api/queries';

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
  }),
  loader: ({ context, params, deps }) =>
    context.queryClient.ensureQueryData(
      endpointLogsQueryOptions({
        endpointId: params.endpointId,
        page: deps.page,
        pageSize: deps.pageSize,
        urlContains: deps.urlContains,
      }),
    ),
});

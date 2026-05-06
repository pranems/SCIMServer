/**
 * endpoints.$endpointId.logs.tsx - per-endpoint logs tab route.
 *
 * Wires logsSearchSchema; pagination + urlContains filter are
 * URL-driven (Phase A3).
 */
import { createRoute } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import { LogsTab } from '../pages/LogsTab';
import { logsSearchSchema } from './search-schemas';

function LogsTabRouteComponent(): React.JSX.Element {
  const { endpointId } = endpointDetailRoute.useParams();
  return <LogsTab endpointId={endpointId} />;
}

export const logsTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: 'logs',
  component: LogsTabRouteComponent,
  validateSearch: logsSearchSchema,
});

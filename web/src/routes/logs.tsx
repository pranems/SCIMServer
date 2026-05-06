/**
 * logs.tsx - global logs page route at "/logs".
 *
 * Wires globalLogsSearchSchema (page, pageSize, endpointId, status,
 * timeRange, urlContains). LogsPage reads via useSearch and updates
 * via useNavigate (Phase A3 - urlContains today; remaining filter
 * inputs land in Phase D5).
 */
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { LogsPage } from '../pages/LogsPage';
import { globalLogsSearchSchema } from './search-schemas';

export const logsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/logs',
  component: LogsPage,
  validateSearch: globalLogsSearchSchema,
});

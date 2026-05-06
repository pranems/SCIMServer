/**
 * logs.tsx - global logs page route at "/logs".
 *
 * Mounts the LogsPage. Phase D5 will wire endpoint, status, and time-range
 * filters via globalLogsSearchSchema search params.
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

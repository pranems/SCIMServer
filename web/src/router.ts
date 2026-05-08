/**
 * router.ts - TanStack Router configuration.
 *
 * Assembles the route tree from individual route files in src/routes/ and
 * builds the Router instance the application mounts in App.tsx.
 *
 * Phase A2 (cutover): the Router is now mounted in App.tsx via
 * <RouterProvider router={router} />. The legacy currentPath / regex
 * matcher inside AppShell.AppRouter has been removed. URL is the single
 * source of truth for view state.
 *
 * Route tree:
 *   /                                       DashboardPage
 *   /endpoints                              EndpointsPage
 *   /endpoints/$endpointId                  EndpointDetailPage (layout)
 *     +-- /         (index)                 OverviewTab
 *     +-- /users                            UsersTab
 *     +-- /groups                           GroupsTab
 *     +-- /logs                             LogsTab
 *     +-- /settings                         SettingsTab
 *   /logs                                   LogsPage (global)
 *   /settings                               SettingsPage (global)
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase A
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md section 5.2
 */
import { createRouter } from '@tanstack/react-router';
import { rootRoute } from './routes/__root';
import { indexRoute } from './routes/index';
import { endpointsRoute } from './routes/endpoints';
import { endpointDetailRoute } from './routes/endpoints.$endpointId';
import { overviewTabRoute } from './routes/endpoints.$endpointId.index';
import { usersTabRoute } from './routes/endpoints.$endpointId.users';
import { groupsTabRoute } from './routes/endpoints.$endpointId.groups';
import { logsTabRoute } from './routes/endpoints.$endpointId.logs';
import { settingsTabRoute } from './routes/endpoints.$endpointId.settings';
import { activityTabRoute } from './routes/endpoints.$endpointId.activity';
import { schemasTabRoute } from './routes/endpoints.$endpointId.schemas';
import { credentialsTabRoute } from './routes/endpoints.$endpointId.credentials';
import { logsRoute } from './routes/logs';
import { settingsRoute } from './routes/settings';
import { manualProvisionRoute } from './routes/manual-provision';
import { queryClient } from './api/query-client';

/** Endpoint detail layout with its 8 nested tab routes (overview + 7 explicit). */
const endpointDetailRouteWithChildren = endpointDetailRoute.addChildren([
  overviewTabRoute,
  usersTabRoute,
  groupsTabRoute,
  logsTabRoute,
  settingsTabRoute,
  activityTabRoute,
  schemasTabRoute,
  credentialsTabRoute,
]);

/** Full route tree exported for inspection in tests. */
export const routeTree = rootRoute.addChildren([
  indexRoute,
  endpointsRoute,
  endpointDetailRouteWithChildren,
  logsRoute,
  settingsRoute,
  manualProvisionRoute,
]);

/**
 * Router instance.
 * - defaultPreload 'intent' triggers loaders on hover/focus to make
 *   navigation feel instant.
 * - defaultPreloadStaleTime mirrors the TanStack Query default so we
 *   don't double-fetch.
 * - context: { queryClient } is consumed by per-route loaders that call
 *   context.queryClient.ensureQueryData(...) to pre-fetch data before
 *   the matched component renders. Phase A4 wires this for every route
 *   with a meaningful initial fetch.
 */
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 30_000,
  context: { queryClient },
});

/**
 * Module augmentation so `router` is fully typed when consumed via the
 * <RouterProvider /> hooks (useParams, useSearch, etc.).
 */
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

/**
 * router.ts - TanStack Router configuration.
 *
 * Assembles the route tree from individual route files in src/routes/ and
 * builds the Router instance the application will mount in Phase A2.
 *
 * Phase A1 (current): additive only. This module is created but not yet
 * imported by App.tsx, so all existing tests stay green and the running
 * UI continues to use the manual currentPath / regex matcher in
 * AppShell.AppRouter.
 *
 * Phase A2 will replace AppShell.AppRouter with <RouterProvider router=...
 * /> so URL-driven navigation becomes the single source of truth for view
 * state.
 *
 * Route tree:
 *   /                                       DashboardPage
 *   /endpoints                              EndpointsPage
 *   /endpoints/$endpointId                  EndpointDetailPage (layout)
 *     +-- /users    (Phase A3 nested)       UsersTab
 *     +-- /groups   (Phase A3 nested)       GroupsTab
 *     +-- /logs     (Phase A3 nested)       LogsTab
 *     +-- /settings (Phase A3 nested)       SettingsTab
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
import { usersTabRoute } from './routes/endpoints.$endpointId.users';
import { groupsTabRoute } from './routes/endpoints.$endpointId.groups';
import { logsTabRoute } from './routes/endpoints.$endpointId.logs';
import { settingsTabRoute } from './routes/endpoints.$endpointId.settings';
import { logsRoute } from './routes/logs';
import { settingsRoute } from './routes/settings';

/** Endpoint detail layout with its 4 nested tab routes. */
const endpointDetailRouteWithChildren = endpointDetailRoute.addChildren([
  usersTabRoute,
  groupsTabRoute,
  logsTabRoute,
  settingsTabRoute,
]);

/** Full route tree exported for inspection in tests. */
export const routeTree = rootRoute.addChildren([
  indexRoute,
  endpointsRoute,
  endpointDetailRouteWithChildren,
  logsRoute,
  settingsRoute,
]);

/**
 * Router instance.
 * - defaultPreload 'intent' triggers loaders on hover/focus to make
 *   navigation feel instant.
 * - defaultPreloadStaleTime mirrors the TanStack Query default so we
 *   don't double-fetch.
 */
export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 30_000,
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

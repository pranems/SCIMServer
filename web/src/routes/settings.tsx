/**
 * settings.tsx - global settings page route at "/settings".
 *
 * Phase A4 loader pre-fetches both /scim/admin/version and /scim/health
 * so the SettingsPage cards render with data on the first paint.
 */
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { SettingsPage } from '../pages/SettingsPage';
import { versionQueryOptions, healthQueryOptions } from '../api/queries';

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(versionQueryOptions()),
      context.queryClient.ensureQueryData(healthQueryOptions()),
    ]),
});

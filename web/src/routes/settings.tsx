/**
 * settings.tsx - global settings page route at "/settings".
 *
 * Phase A4 loader pre-fetches both /scim/admin/version and /scim/health
 * so the SettingsPage cards render with data on the first paint.
 */
import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { versionQueryOptions, healthQueryOptions } from '../api/queries';

// Phase K1 - lazy-load SettingsPage into its own chunk.
const SettingsPage = React.lazy(() =>
  import('../pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
  loader: ({ context }) => {
    void context.queryClient
      .prefetchQuery(versionQueryOptions())
      .then(() => context.queryClient.prefetchQuery(healthQueryOptions()));
  },
});

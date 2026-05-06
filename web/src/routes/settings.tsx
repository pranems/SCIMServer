/**
 * settings.tsx - global settings page route at "/settings".
 *
 * Phase A1 placeholder for the global settings/admin page.
 */
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { SettingsPage } from '../pages/SettingsPage';

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

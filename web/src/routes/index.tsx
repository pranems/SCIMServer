/**
 * index.tsx - dashboard route at "/".
 *
 * Mounts DashboardPage as the home route of the new URL-driven UI.
 * Phase A1: additive - created but not wired into the app shell yet.
 */
import { createRoute } from '@tanstack/react-router';
import { rootRoute } from './__root';
import { DashboardPage } from '../pages/DashboardPage';

export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardPage,
});

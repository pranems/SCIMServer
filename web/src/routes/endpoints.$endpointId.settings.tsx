/**
 * endpoints.$endpointId.settings.tsx - per-endpoint settings tab route.
 *
 * Today renders the read-only SettingsTab; the interactive config-flag
 * toggles arrive in Phase E2 alongside the mutation layer.
 *
 * Phase A4: loader pre-fetches the endpoint stats payload (used by
 * SettingsTab's status sub-section) so the tab pops in fully populated.
 */
import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import { endpointStatsQueryOptions } from '../api/queries';

// Phase K1 - lazy-load SettingsTab into its own chunk.
const SettingsTab = React.lazy(() =>
  import('../pages/SettingsTab').then((m) => ({ default: m.SettingsTab })),
);

function SettingsTabRouteComponent(): React.JSX.Element {
  const { endpointId } = endpointDetailRoute.useParams();
  return <SettingsTab endpointId={endpointId} />;
}

export const settingsTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: 'settings',
  component: SettingsTabRouteComponent,
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(endpointStatsQueryOptions(params.endpointId)),
});

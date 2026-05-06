/**
 * endpoints.$endpointId.settings.tsx - per-endpoint settings tab route.
 *
 * Phase A1 placeholder. Today renders the read-only SettingsTab; the
 * interactive config-flag toggles arrive in Phase E2 alongside the
 * mutation layer.
 */
import { createRoute } from '@tanstack/react-router';
import { endpointDetailRoute } from './endpoints.$endpointId';
import { SettingsTab } from '../pages/SettingsTab';

function SettingsTabRouteComponent(): React.JSX.Element {
  const { endpointId } = endpointDetailRoute.useParams();
  return <SettingsTab endpointId={endpointId} />;
}

export const settingsTabRoute = createRoute({
  getParentRoute: () => endpointDetailRoute,
  path: 'settings',
  component: SettingsTabRouteComponent,
});

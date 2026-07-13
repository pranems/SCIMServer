/**
 * ConnectTab (WI-5) - the per-endpoint "Connect" tab. It shows the operator
 * exactly what to paste into Microsoft Entra ID (or any SCIM client) to
 * connect a provisioning job to THIS endpoint, using the WI-4 `ConnectionPanel`
 * driven by the WI-2/WI-3 `connectionInfo` (assembled server-side; no URL
 * hand-building).
 *
 * The connection-info is already embedded in the per-endpoint Overview BFF
 * (WI-3), so this tab reads it from `useEndpointOverview` with zero extra round
 * trips on a warm cache.
 *
 * Design: docs/auth/CONNECTION_INFO_AND_ENTRA_SETUP.md Part 7 (surface 2:
 * "Connect tab, always available").
 */
import React from 'react';
import { makeStyles, tokens, Text, Subtitle2, Caption1, Card, Link } from '@fluentui/react-components';
import { useNavigate } from '@tanstack/react-router';
import { useEndpointOverview, useConnectionRetainedSecrets } from '../api/queries';
import { ConnectionPanel, LoadingSkeleton, AuthDiagnosticsPanel } from '../components/primitives';
import { ScimErrorMessage } from '../components/primitives/ScimErrorMessage';
import type { ConnectionInfo } from '@scim/types/connection-info.types';

const useStyles = makeStyles({
  page: { display: 'flex', flexDirection: 'column', gap: '16px' },
  intro: { display: 'flex', flexDirection: 'column', gap: '4px' },
  crossLinks: { display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' },
  disabledCard: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' },
  disabledRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    padding: '8px 0',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  hint: { color: tokens.colorNeutralForeground3 },
});

interface ConnectTabProps {
  endpointId: string;
}

export const ConnectTab: React.FC<ConnectTabProps> = ({ endpointId }) => {
  const classes = useStyles();
  const navigate = useNavigate();
  const { data, isLoading, error } = useEndpointOverview(endpointId);

  if (isLoading) {
    return (
      <div className={classes.page} data-testid="connect-tab-loading">
        <LoadingSkeleton count={1} height="36px" />
        <LoadingSkeleton count={4} height="28px" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={classes.page} data-testid="connect-tab-error">
        <ScimErrorMessage error={error ?? new Error('Failed to load connection info')} />
      </div>
    );
  }

  const { connectionInfo } = data;

  return (
    <div className={classes.page} data-testid="connect-tab">
      <div className={classes.intro}>
        <Subtitle2>Connect a provisioning client to this endpoint</Subtitle2>
        <Caption1 className={classes.hint}>
          These are the exact values to paste into Microsoft Entra ID (or any SCIM client). URLs
          are assembled by the server, so they always match this deployment. A per-endpoint secret
          is shown here only when its credential secret visibility is set to Always; otherwise
          secrets appear once, at credential-create time.
        </Caption1>
        <div className={classes.crossLinks} data-testid="connect-tab-cross-links">
          <Link
            data-testid="connect-tab-link-credentials"
            onClick={() => void navigate({ to: '/endpoints/$endpointId/credentials', params: { endpointId } })}
          >
            Manage credentials
          </Link>
          <Link
            data-testid="connect-tab-link-settings"
            onClick={() => void navigate({ to: '/endpoints/$endpointId/settings', params: { endpointId } })}
          >
            Enable / disable auth methods (Settings)
          </Link>
        </div>
      </div>

      <ConnectPanelSection endpointId={endpointId} connectionInfo={connectionInfo} />

      <AuthDiagnosticsPanel endpointId={endpointId} data-testid="connect-tab-auth-diagnostics" />

      {connectionInfo.disabledMethods.length > 0 && (
        <Card className={classes.disabledCard} data-testid="connect-tab-disabled">
          <Subtitle2>Other methods (not enabled)</Subtitle2>
          {connectionInfo.disabledMethods.map((m) => (
            <div key={m.method} className={classes.disabledRow} data-testid={`connect-tab-disabled-${m.method}`}>
              <Text>{m.method}</Text>
              <Caption1 className={classes.hint}>{m.enableHint}</Caption1>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
};

/**
 * R3 - renders the ConnectionPanel and, for any enabled method whose credential
 * kept a retained secret (effective visibility Always), reveals it so the panel
 * ALWAYS displays the secret. Extracted so the reveal hook is called
 * unconditionally (rules-of-hooks) after ConnectTab's loading/error guards.
 */
const ConnectPanelSection: React.FC<{ endpointId: string; connectionInfo: ConnectionInfo }> = ({
  endpointId,
  connectionInfo,
}) => {
  const retainedSecrets = useConnectionRetainedSecrets(endpointId, connectionInfo.enabledMethods);
  return (
    <ConnectionPanel
      connectionInfo={connectionInfo}
      retainedSecrets={retainedSecrets}
      data-testid="connect-tab-panel"
    />
  );
};

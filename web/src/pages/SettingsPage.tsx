/**
 * SettingsPage - global app settings and version info.
 * Accessible via /settings sidebar link.
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Card,
  Text,
  Spinner,
  Subtitle1,
  Subtitle2,
  Caption1,
} from '@fluentui/react-components';
import { useVersion, useHealth } from '../api/queries';

const useStyles = makeStyles({
  page: { display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '1000px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' },
  card: { padding: '20px' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  center: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '200px' },
});

export const SettingsPage: React.FC = () => {
  const classes = useStyles();
  const { data: version, isLoading: vLoading } = useVersion();
  const { data: health, isLoading: hLoading } = useHealth();

  if (vLoading || hLoading) {
    return (
      <div className={classes.center} data-testid="settings-page-loading">
        <Spinner label="Loading..." />
      </div>
    );
  }

  return (
    <div className={classes.page} data-testid="settings-page">
      <Subtitle1>Settings</Subtitle1>

      <div className={classes.grid}>
        <Card className={classes.card}>
          <Subtitle2>Server Info</Subtitle2>
          {version && (
            <>
              <div className={classes.row}>
                <Text>Version</Text>
                <Text weight="semibold">{version.version}</Text>
              </div>
              <div className={classes.row}>
                <Text>Node.js</Text>
                <Caption1>{version.runtime?.node}</Caption1>
              </div>
              <div className={classes.row}>
                <Text>Platform</Text>
                <Caption1>{version.runtime?.platform} / {version.runtime?.arch}</Caption1>
              </div>
              <div className={classes.row}>
                <Text>Uptime</Text>
                <Caption1>{Math.floor(version.service?.uptimeSeconds / 60)}m {Math.floor(version.service?.uptimeSeconds % 60)}s</Caption1>
              </div>
            </>
          )}
        </Card>

        <Card className={classes.card}>
          <Subtitle2>Health</Subtitle2>
          <div className={classes.row}>
            <Text>Status</Text>
            <Text weight="semibold" style={{ color: health?.status === 'ok' ? tokens.colorPaletteGreenForeground1 : tokens.colorPaletteRedForeground1 }}>
              {health?.status ?? 'unknown'}
            </Text>
          </div>
          <div className={classes.row}>
            <Text>Uptime</Text>
            <Caption1>{health?.uptime ? `${Math.floor(health.uptime)}s` : '-'}</Caption1>
          </div>
        </Card>

        {version?.storage && (
          <Card className={classes.card}>
            <Subtitle2>Storage</Subtitle2>
            <div className={classes.row}>
              <Text>Backend</Text>
              <Caption1>{version.storage.persistenceBackend}</Caption1>
            </div>
            <div className={classes.row}>
              <Text>Provider</Text>
              <Caption1>{version.storage.databaseProvider}</Caption1>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

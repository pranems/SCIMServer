/**
 * SettingsTab - displays read-only endpoint configuration flags.
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Spinner,
  Card,
  Subtitle2,
  Caption1,
} from '@fluentui/react-components';
import { useEndpoint } from '../api/queries';

const useStyles = makeStyles({
  container: { display: 'flex', flexDirection: 'column', gap: '16px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' },
  card: { padding: '16px' },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' },
  center: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '150px' },
});

interface SettingsTabProps {
  endpointId: string;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({ endpointId }) => {
  const classes = useStyles();
  const { data: endpoint, isLoading, error } = useEndpoint(endpointId);

  if (isLoading) {
    return (
      <div className={classes.center} data-testid="settings-loading">
        <Spinner label="Loading settings..." />
      </div>
    );
  }

  if (error || !endpoint) {
    return (
      <div className={classes.center} data-testid="settings-error">
        <Text>Failed to load settings.</Text>
      </div>
    );
  }

  const settings = (endpoint.profileSummary?.activeSettings ?? {}) as Record<string, unknown>;
  const entries = Object.entries(settings);

  return (
    <div className={classes.container} data-testid="settings-tab">
      <Subtitle2>Endpoint Configuration</Subtitle2>

      <div className={classes.grid}>
        <Card className={classes.card}>
          <Caption1>General</Caption1>
          <div className={classes.row}>
            <Text>Name</Text>
            <Text weight="semibold">{endpoint.name}</Text>
          </div>
          <div className={classes.row}>
            <Text>SCIM Path</Text>
            <Caption1 style={{ fontFamily: 'monospace' }}>{endpoint.scimBasePath}</Caption1>
          </div>
          <div className={classes.row}>
            <Text>Status</Text>
            <Badge appearance="filled" color={endpoint.active ? 'success' : 'warning'}>
              {endpoint.active ? 'Active' : 'Inactive'}
            </Badge>
          </div>
        </Card>

        {entries.length > 0 && (
          <Card className={classes.card}>
            <Caption1>Config Flags</Caption1>
            {entries.map(([key, value]) => (
              <div key={key} className={classes.row}>
                <Text>{key}</Text>
                <Badge appearance="outline" color={value === true || value === 'True' ? 'success' : 'informative'}>
                  {String(value)}
                </Badge>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
};

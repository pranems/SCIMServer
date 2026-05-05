/**
 * LogsTab - filterable request log list for an endpoint.
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Spinner,
  Caption1,
  Subtitle2,
} from '@fluentui/react-components';
import { fetchWithAuth, queryKeys } from '../api/queries';
import { useQuery } from '@tanstack/react-query';

const useStyles = makeStyles({
  container: { display: 'flex', flexDirection: 'column', gap: '12px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: `2px solid ${tokens.colorNeutralStroke1}`, fontWeight: 600, fontSize: '13px', color: tokens.colorNeutralForeground3 },
  td: { padding: '10px 12px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, fontSize: '13px' },
  tr: { ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover } },
  center: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '150px' },
  empty: { textAlign: 'center' as const, padding: '32px', color: tokens.colorNeutralForeground3 },
  method: { fontFamily: 'monospace', minWidth: '48px', textAlign: 'center' as const },
});

function methodColor(m: string): 'brand' | 'success' | 'warning' | 'danger' | 'informative' {
  switch (m.toUpperCase()) {
    case 'GET': return 'brand';
    case 'POST': return 'success';
    case 'PUT': case 'PATCH': return 'warning';
    case 'DELETE': return 'danger';
    default: return 'informative';
  }
}

interface LogsTabProps {
  endpointId: string;
}

/** Hook to fetch logs for an endpoint */
export function useEndpointLogs(endpointId: string) {
  return useQuery<{ items: any[]; total: number }>({
    queryKey: ['endpoint-logs', endpointId],
    queryFn: () => fetchWithAuth(`/scim/admin/logs?endpointId=${endpointId}&pageSize=50`),
    enabled: !!endpointId,
    staleTime: 10_000,
  });
}

export const LogsTab: React.FC<LogsTabProps> = ({ endpointId }) => {
  const classes = useStyles();
  const { data, isLoading, error } = useEndpointLogs(endpointId);

  if (isLoading) {
    return (
      <div className={classes.center} data-testid="logs-loading">
        <Spinner label="Loading logs..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={classes.center} data-testid="logs-error">
        <Text>Failed to load logs: {(error as Error).message}</Text>
      </div>
    );
  }

  const logs = data?.items ?? [];

  if (logs.length === 0) {
    return (
      <div className={classes.empty} data-testid="logs-empty">
        <Text>No request logs for this endpoint.</Text>
      </div>
    );
  }

  return (
    <div className={classes.container} data-testid="logs-tab">
      <div className={classes.header}>
        <Subtitle2>{data?.total ?? logs.length} logs</Subtitle2>
      </div>
      <table className={classes.table}>
        <thead>
          <tr>
            <th className={classes.th}>Method</th>
            <th className={classes.th}>URL</th>
            <th className={classes.th}>Status</th>
            <th className={classes.th}>Duration</th>
            <th className={classes.th}>Time</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log: any) => (
            <tr key={log.id} className={classes.tr}>
              <td className={classes.td}>
                <Badge appearance="filled" color={methodColor(log.method)} className={classes.method}>
                  {log.method}
                </Badge>
              </td>
              <td className={classes.td}>
                <Caption1 style={{ fontFamily: 'monospace' }}>{log.url}</Caption1>
              </td>
              <td className={classes.td}>
                <Badge appearance="outline" color={log.status >= 400 ? 'danger' : 'success'}>
                  {log.status}
                </Badge>
              </td>
              <td className={classes.td}>
                <Caption1>{log.durationMs}ms</Caption1>
              </td>
              <td className={classes.td}>
                <Caption1>
                  {log.createdAt ? new Date(log.createdAt).toLocaleTimeString() : '-'}
                </Caption1>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

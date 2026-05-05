/**
 * LogsTab - filterable request log list for an endpoint.
 */
import React, { useState } from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Button,
  Spinner,
  SearchBox,
  Caption1,
  Subtitle2,
} from '@fluentui/react-components';
import { fetchWithAuth } from '../api/queries';
import { useQuery } from '@tanstack/react-query';

const PAGE_SIZE = 20;

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
  pagination: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', padding: '12px 0' },
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
export function useEndpointLogs(endpointId: string, page: number = 1, search: string = '') {
  return useQuery<{ items: any[]; total: number; page: number; pageSize: number; hasNext: boolean; hasPrev: boolean }>({
    queryKey: ['endpoint-logs', endpointId, page, search],
    queryFn: () => {
      const params = new URLSearchParams({
        endpointId,
        pageSize: String(PAGE_SIZE),
        page: String(page),
      });
      if (search) params.set('urlContains', search);
      return fetchWithAuth(`/scim/admin/logs?${params.toString()}`);
    },
    enabled: !!endpointId,
    staleTime: 10_000,
  });
}

export const LogsTab: React.FC<LogsTabProps> = ({ endpointId }) => {
  const classes = useStyles();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const { data, isLoading, error } = useEndpointLogs(endpointId, page, search);

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
        <SearchBox
          placeholder="Filter by URL..."
          value={search}
          onChange={(_, d) => { setSearch(d.value); setPage(1); }}
          data-testid="logs-tab-search"
          style={{ minWidth: '200px' }}
        />
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

      {(data?.total ?? 0) > PAGE_SIZE && (
        <div className={classes.pagination} data-testid="logs-pagination">
          <Button appearance="subtle" disabled={!data?.hasPrev} onClick={() => setPage(Math.max(1, page - 1))}>Previous</Button>
          <Text>Page {page}</Text>
          <Button appearance="subtle" disabled={!data?.hasNext} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
};

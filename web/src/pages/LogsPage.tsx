/**
 * LogsPage - global request logs page (all endpoints).
 * Accessible via /logs sidebar link.
 *
 * Phase A3: filter state (urlContains, endpointId, status, timeRange,
 * page, pageSize) lives in the URL via globalLogsSearchSchema. The page
 * component reads via useSearch and writes via useNavigate, with empty
 * inputs normalized to undefined so URLs stay clean.
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Spinner,
  SearchBox,
  Subtitle1,
  Caption1,
} from '@fluentui/react-components';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { globalLogsQueryOptions } from '../api/queries';
import type { GlobalLogsSearch } from '../routes/search-schemas';

const LOGS_ROUTE_PATH = '/logs' as const;

const useStyles = makeStyles({
  page: { display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '1400px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: `2px solid ${tokens.colorNeutralStroke1}`, fontWeight: 600, fontSize: '13px', color: tokens.colorNeutralForeground3 },
  td: { padding: '10px 12px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, fontSize: '13px' },
  tr: { ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover } },
  center: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '200px' },
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

export const LogsPage: React.FC = () => {
  const classes = useStyles();
  const search = useSearch({ strict: false }) as Partial<GlobalLogsSearch>;
  const urlContains = search.urlContains ?? '';
  const navigate = useNavigate();

  const updateFilter = (value: string): void => {
    navigate({
      to: LOGS_ROUTE_PATH,
      search: (prev) => ({
        ...(prev as GlobalLogsSearch),
        urlContains: value.trim() === '' ? undefined : value,
        page: 1, // reset pagination when the filter changes
      }),
    });
  };

  const { data, isLoading, error } = useQuery(
    globalLogsQueryOptions({ urlContains: urlContains || undefined }),
  );

  if (isLoading) {
    return (
      <div className={classes.center} data-testid="global-logs-loading">
        <Spinner label="Loading logs..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={classes.center} data-testid="global-logs-error">
        <Text>Failed to load logs: {(error as Error).message}</Text>
      </div>
    );
  }

  const logs = data?.items ?? [];

  return (
    <div className={classes.page} data-testid="global-logs-page">
      <div className={classes.header}>
        <Subtitle1>Request Logs ({data?.total ?? 0})</Subtitle1>
        <SearchBox
          placeholder="Filter by URL..."
          value={urlContains}
          onChange={(_, d) => updateFilter(d.value)}
          data-testid="logs-search"
        />
      </div>

      {logs.length === 0 ? (
        <div className={classes.center}>
          <Text>No logs found.</Text>
        </div>
      ) : (
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
                  <Badge appearance="outline" color={(log.status ?? 0) >= 400 ? 'danger' : 'success'}>
                    {log.status}
                  </Badge>
                </td>
                <td className={classes.td}>
                  <Caption1>{log.durationMs}ms</Caption1>
                </td>
                <td className={classes.td}>
                  <Caption1>
                    {log.createdAt ? new Date(log.createdAt).toLocaleString() : '-'}
                  </Caption1>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

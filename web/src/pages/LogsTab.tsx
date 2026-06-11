/**
 * LogsTab - filterable request log list for an endpoint.
 *
 * Phase A3: page + urlContains filter are URL-driven via
 * logsSearchSchema. SearchBox typing dispatches a navigate that resets
 * page to 1 (typical filter-input UX).
 *
 * Phase G1: loading state migrated from Spinner to LoadingSkeleton
 * (table-row shaped).
 * Phase G2: empty state migrated from plain Text to EmptyState
 * with a contextual "Reset filter" CTA when a filter is active.
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Button,
  SearchBox,
  Caption1,
  Subtitle2,
} from '@fluentui/react-components';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { endpointLogsQueryOptions } from '../api/queries';
import type { LogsSearch } from '../routes/search-schemas';
import { EmptyState, ExportSplitButton, LoadingSkeleton, CopyableField } from '../components/primitives';
import { usePreferencesStore } from '../store/preferences-store';

const LOGS_ROUTE_PATH = '/endpoints/$endpointId/logs' as const;
const DEFAULT_PAGE_SIZE = 20;

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

/** Hook to fetch logs for an endpoint - delegates to the shared queryOptions. */
export function useEndpointLogs(endpointId: string, page: number, search: string, pageSize: number = DEFAULT_PAGE_SIZE) {
  return useQuery(
    endpointLogsQueryOptions({
      endpointId,
      page,
      pageSize,
      urlContains: search || undefined,
    }),
  );
}

export const LogsTab: React.FC<LogsTabProps> = ({ endpointId }) => {
  const classes = useStyles();
  const search = useSearch({ strict: false }) as Partial<LogsSearch>;
  const page = search.page ?? 1;
  // Phase N4: fall back to the persisted user preference when no URL override is set.
  const defaultPageSize = usePreferencesStore((s) => s.defaultPageSize);
  const pageSize = search.pageSize ?? defaultPageSize;
  const urlContains = search.urlContains ?? '';
  const navigate = useNavigate();
  const { data, isLoading, error } = useEndpointLogs(endpointId, page, urlContains, pageSize);

  const updateSearch = (next: { page?: number; urlContains?: string }): void => {
    navigate({
      to: LOGS_ROUTE_PATH,
      params: (prev) => ({ ...prev, endpointId }),
      search: (prev) => {
        const previous = prev as LogsSearch;
        return {
          ...previous,
          // Always normalize empty filter -> undefined so URLs stay clean.
          urlContains:
            next.urlContains !== undefined
              ? next.urlContains.trim() === ''
                ? undefined
                : next.urlContains
              : previous.urlContains,
          // When the filter changes, snap pagination back to page 1.
          page: next.page ?? (next.urlContains !== undefined ? 1 : previous.page),
        };
      },
    });
  };

  if (isLoading) {
    // G1 - row-shaped skeleton mirrors the final table.
    return (
      <div className={classes.container} data-testid="logs-loading">
        <LoadingSkeleton
          count={8}
          height="40px"
          data-testid="logs-tab-skeleton"
        />
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
    // G2 - EmptyState replaces plain Text. CTA appears only when a
    // filter is active (so the user can recover from over-narrow
    // input).
    return urlContains ? (
      <EmptyState
        data-testid="logs-tab-empty-filtered"
        title="No logs match these filters"
        body={`No request logs contain "${urlContains}".`}
        actionLabel="Reset filter"
        onAction={() => updateSearch({ urlContains: '' })}
      />
    ) : (
      <EmptyState
        data-testid="logs-tab-empty"
        title="No request logs yet"
        body="This endpoint has not received any SCIM requests in the visible window."
      />
    );
  }

  return (
    <div className={classes.container} data-testid="logs-tab">
      <div className={classes.header}>
        <Subtitle2>{data?.total ?? logs.length} logs</Subtitle2>
        <ExportSplitButton
          rows={logs.map((l: any) => ({
            id: l.id,
            method: l.method ?? '',
            url: l.url ?? '',
            status: l.status ?? '',
            durationMs: l.durationMs ?? '',
            createdAt: l.createdAt ?? '',
          }))}
          filenameBase={`logs-${endpointId}`}
          columns={['id', 'method', 'url', 'status', 'durationMs', 'createdAt']}
        />
        <SearchBox
          placeholder="Filter by URL..."
          value={urlContains}
          onChange={(_, d) => updateSearch({ urlContains: d.value })}
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
                <CopyableField
                  value={log.url}
                  truncate
                  monospace
                  maxWidth="500px"
                  data-testid={`log-url-${log.id}`}
                />
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

      {(data?.total ?? 0) > pageSize && (
        <div className={classes.pagination} data-testid="logs-pagination">
          <Button appearance="subtle" disabled={!data?.hasPrev} onClick={() => updateSearch({ page: Math.max(1, page - 1) })}>Previous</Button>
          <Text>Page {page}</Text>
          <Button appearance="subtle" disabled={!data?.hasNext} onClick={() => updateSearch({ page: page + 1 })}>Next</Button>
        </div>
      )}
    </div>
  );
};

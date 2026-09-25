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
  mergeClasses,
  tokens,
  Text,
  Badge,
  Button,
  Caption1,
  Subtitle2,
} from '@fluentui/react-components';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { endpointLogsQueryOptions, useEndpointLog, useAuthDecisions } from '../api/queries';
import type { LogsSearch } from '../routes/search-schemas';
import { EmptyState, ExportSplitButton, LoadingSkeleton, CopyableField, CopyableJsonBlock, DetailDrawer, AuthDecisionForRequest } from '../components/primitives';
import { AuthMethodChip } from '../components/primitives/AuthMethodChip';
import { ColumnResizeHandle } from '../components/primitives/ColumnResizeHandle';
import { useResizableColumns } from '../hooks/useResizableColumns';
import { clickableProps } from '../utils/interactive';
import { usePreferencesStore } from '../store/preferences-store';
import { EndpointRelatedSettings } from './EndpointRelatedSettings';
import { TAB_SETTING_KEYS } from './endpoint-settings-definitions';
import { LogFiltersToolbar, timeRangeToSince } from '../components/logs/LogFiltersToolbar';

const LOGS_ROUTE_PATH = '/endpoints/$endpointId/logs' as const;
const DEFAULT_PAGE_SIZE = 20;

const useStyles = makeStyles({
  container: { display: 'flex', flexDirection: 'column', gap: '12px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  tableScroll: { width: '100%', overflowX: 'auto' },
  table: { width: '100%', minWidth: '720px', borderCollapse: 'collapse', tableLayout: 'fixed' },
  colMethod: { width: '9%' },
  colUrl: { width: '46%' },
  colStatus: { width: '11%' },
  colDuration: { width: '12%' },
  colTime: { width: '22%' },
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: `2px solid ${tokens.colorNeutralStroke1}`, fontWeight: 600, fontSize: '13px', color: tokens.colorNeutralForeground3 },
  td: { padding: '10px 12px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, fontSize: '13px', overflow: 'hidden' },
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
export function useEndpointLogs(endpointId: string, page: number, filters: Partial<LogsSearch>, pageSize: number = DEFAULT_PAGE_SIZE) {
  const since = React.useMemo(() => timeRangeToSince(filters.timeRange), [filters.timeRange]);
  return useQuery(
    endpointLogsQueryOptions({
      endpointId,
      page,
      pageSize,
      urlContains: filters.urlContains || undefined,
      method: filters.method,
      status: filters.status,
      since,
      hasError: filters.hasError,
      minDurationMs: filters.minDurationMs,
      requestId: filters.requestId,
    }),
  );
}

export const LogsTab: React.FC<LogsTabProps> = ({ endpointId }) => {
  const classes = useStyles();
  // X7 - drag-to-resize the 6 log columns (Method|URL|Status|Auth|Duration|Time).
  const cols = useResizableColumns('logs-tab', 6, 'logs-tab-col');
  const search = useSearch({ strict: false }) as Partial<LogsSearch>;
  const page = search.page ?? 1;
  // Phase N4: fall back to the persisted user preference when no URL override is set.
  const defaultPageSize = usePreferencesStore((s) => s.defaultPageSize);
  const pageSize = search.pageSize ?? defaultPageSize;
  const urlContains = search.urlContains ?? '';
  const navigate = useNavigate();
  const { data, isLoading, error } = useEndpointLogs(endpointId, page, search, pageSize);

  // Clickable log detail is URL-owned so global Back/Forward restores the drawer.
  const detailId = search.detail;
  const detailQuery = useEndpointLog(endpointId, detailId);

  // U12 - recent auth decisions for this endpoint, keyed by correlation id, so
  // each request-log row can show a glanceable auth-outcome chip.
  const authDecisions = useAuthDecisions({ endpointId, limit: 100 });
  const authByCorrelation = React.useMemo(() => {
    const map = new Map<string, { outcome: 'accept' | 'reject'; reasonCode?: string }>();
    for (const r of authDecisions.data?.records ?? []) {
      if (r.correlationId && !map.has(r.correlationId)) {
        map.set(r.correlationId, { outcome: r.outcome, reasonCode: r.reasonCode });
      }
    }
    return map;
  }, [authDecisions.data]);

  const relatedSettings = (
    <EndpointRelatedSettings
      endpointId={endpointId}
      settingKeys={TAB_SETTING_KEYS.logs}
      title="Log capture settings"
      description="Per-endpoint persistence, file output, and verbosity controls for these request logs."
      data-testid="logs-related-settings"
    />
  );

  const updateSearch = (next: Partial<LogsSearch>): void => {
    navigate({
      to: LOGS_ROUTE_PATH,
      params: (prev) => ({ ...prev, endpointId }),
      search: (prev) => {
        const previous = prev as LogsSearch;
        return {
          ...previous,
          ...next,
          // Always normalize empty filter -> undefined so URLs stay clean.
          urlContains:
            next.urlContains !== undefined
              ? next.urlContains.trim() === ''
                ? undefined
                : next.urlContains
              : previous.urlContains,
          // When the filter changes, snap pagination back to page 1.
          page: next.page ?? 1,
        };
      },
    });
  };

  const resetFilters = (): void => {
    navigate({
      to: LOGS_ROUTE_PATH,
      params: { endpointId },
      search: { page: 1 },
    });
  };

  const openDetail = (id: string): void => {
    navigate({
      to: LOGS_ROUTE_PATH,
      params: { endpointId },
      search: (previous) => ({ ...(previous as LogsSearch), detail: id }),
    });
  };

  const closeDetail = (): void => {
    navigate({
      to: LOGS_ROUTE_PATH,
      params: { endpointId },
      search: (previous) => ({ ...(previous as LogsSearch), detail: undefined }),
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
  const hasFilters = Boolean(
    urlContains ||
    search.method ||
    search.status ||
    search.timeRange ||
    search.hasError !== undefined ||
    search.minDurationMs !== undefined ||
    search.requestId,
  );
  const filtersToolbar = (
    <LogFiltersToolbar
      values={search}
      onChange={updateSearch}
      onReset={resetFilters}
      legacyTestIds={{ url: 'logs-tab-search' }}
      data-testid="logs-tab-filters"
    />
  );

  if (logs.length === 0) {
    // G2 - EmptyState replaces plain Text. CTA appears only when a
    // filter is active (so the user can recover from over-narrow
    // input).
    return hasFilters ? (
      <div className={classes.container} data-testid="logs-tab-empty-filtered-wrap">
        {relatedSettings}
        {filtersToolbar}
        <EmptyState
          data-testid="logs-tab-empty-filtered"
          title="No logs match these filters"
          body="Try widening the time range or clearing one or more filters."
          actionLabel="Reset filters"
          onAction={resetFilters}
        />
      </div>
    ) : (
      <div className={classes.container} data-testid="logs-tab-empty-wrap">
        {relatedSettings}
        {filtersToolbar}
        <EmptyState
          data-testid="logs-tab-empty"
          title="No request logs yet"
          body="This endpoint has not received any SCIM requests in the visible window."
        />
      </div>
    );
  }

  return (
    <div className={classes.container} data-testid="logs-tab">
      {relatedSettings}
      {/* U12 - the endpoint auth-diagnostics panel is re-scoped to Connect ->
          Health. Per-request auth now renders inline in the log detail (U11)
          and as a per-row chip below. */}
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
      </div>
      {filtersToolbar}
      <div className={classes.tableScroll}>
      <table className={classes.table}>
        <thead>
          <tr>
            <th className={mergeClasses(classes.th, classes.colMethod)} style={cols.headerProps(0).style}>Method<ColumnResizeHandle {...cols.handleProps(0)} /></th>
            <th className={mergeClasses(classes.th, classes.colUrl)} style={cols.headerProps(1).style}>URL<ColumnResizeHandle {...cols.handleProps(1)} /></th>
            <th className={mergeClasses(classes.th, classes.colStatus)} style={cols.headerProps(2).style}>Status<ColumnResizeHandle {...cols.handleProps(2)} /></th>
            <th className={mergeClasses(classes.th, classes.colStatus)} style={cols.headerProps(3).style}>Auth<ColumnResizeHandle {...cols.handleProps(3)} /></th>
            <th className={mergeClasses(classes.th, classes.colDuration)} style={cols.headerProps(4).style}>Duration<ColumnResizeHandle {...cols.handleProps(4)} /></th>
            <th className={mergeClasses(classes.th, classes.colTime)} style={cols.headerProps(5).style}>Time</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log: any) => (
            <tr
              key={log.id}
              className={classes.tr}
              {...clickableProps(() => openDetail(log.id), `Open log ${log.method} ${log.url}`)}
              data-testid={`logs-tab-row-${log.id}`}
              style={{ cursor: 'pointer' }}
            >
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
                  maxWidth="100%"
                  data-testid={`log-url-${log.id}`}
                />
              </td>
              <td className={classes.td}>
                <Badge appearance="outline" color={log.status >= 400 ? 'danger' : 'success'}>
                  {log.status}
                </Badge>
              </td>
              <td className={classes.td}>
                {(() => {
                  // V10/V12 - prefer the auth summary PERSISTED on the row
                  // (durable, instant); fall back to the live auth-decision map
                  // for rows written before the persisted fields existed.
                  const persisted = log.authOutcome
                    ? { outcome: log.authOutcome as 'accept' | 'reject', reasonCode: log.authReason as string | undefined, method: log.authMethod as string | undefined }
                    : undefined;
                  const live = log.requestId ? authByCorrelation.get(log.requestId) : undefined;
                  const auth = persisted ?? live;
                  return (
                    <AuthMethodChip
                      outcome={auth?.outcome}
                      method={(auth as { method?: string } | undefined)?.method ?? log.authMethod}
                      reason={auth?.reasonCode}
                      url={log.url}
                      data-testid={`log-row-auth-${log.id}`}
                    />
                  );
                })()}
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

      {(data?.total ?? 0) > pageSize && (
        <div className={classes.pagination} data-testid="logs-pagination">
          <Button appearance="subtle" disabled={!data?.hasPrev} onClick={() => updateSearch({ page: Math.max(1, page - 1) })}>Previous</Button>
          <Text>Page {page}</Text>
          <Button appearance="subtle" disabled={!data?.hasNext} onClick={() => updateSearch({ page: page + 1 })}>Next</Button>
        </div>
      )}

      <DetailDrawer
        open={Boolean(detailId)}
        onClose={closeDetail}
        title={detailQuery.data ? `${detailQuery.data.method} ${detailQuery.data.url}` : 'Log detail'}
        jsonData={detailQuery.data}
        jsonFilename={detailId ? `log-${detailId}` : 'log-detail'}
        data-testid="logs-tab-detail-drawer"
      >
        {detailQuery.isLoading && (
          <LoadingSkeleton count={6} height="36px" data-testid="logs-tab-detail-skeleton" />
        )}
        {detailQuery.error && (
          <Text data-testid="logs-tab-detail-error">
            Failed to load log: {(detailQuery.error as Error).message}
          </Text>
        )}
        {detailQuery.data && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <CopyableField value={detailQuery.data.url ?? ''} truncate monospace maxWidth="100%" data-testid="logs-tab-detail-url" />
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <Badge appearance="filled" color={(detailQuery.data.status ?? 0) >= 400 ? 'danger' : 'success'}>
                {detailQuery.data.status ?? '-'}
              </Badge>
              <Caption1>{detailQuery.data.durationMs ?? 0}ms</Caption1>
            </div>
            {detailQuery.data.requestId && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }} data-testid="logs-tab-detail-correlation">
                <Caption1>Correlation id</Caption1>
                <CopyableField value={detailQuery.data.requestId} monospace maxWidth="100%" data-testid="logs-tab-detail-request-id" />
              </div>
            )}
            {/* V11 - durable one-line auth summary from the fields PERSISTED on
                the row (present even after the short-TTL auth-decision store
                expires, unlike the deep U11 diff below). */}
            {detailQuery.data.authOutcome && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }} data-testid="log-detail-auth-summary">
                <Caption1>Authentication</Caption1>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <Badge
                    appearance="filled"
                    color={detailQuery.data.authOutcome === 'accept' ? 'success' : 'danger'}
                  >
                    {detailQuery.data.authOutcome === 'accept' ? 'auth ok' : 'auth fail'}
                  </Badge>
                  <Text>
                    {detailQuery.data.authOutcome === 'accept' ? 'Authenticated via ' : 'Rejected via '}
                    <strong>{detailQuery.data.authMethod ?? 'unknown method'}</strong>
                    {detailQuery.data.authCredentialId ? (
                      <>
                        {' using '}
                        <strong>{detailQuery.data.authCredentialId}</strong>
                      </>
                    ) : null}
                    {detailQuery.data.authReason && detailQuery.data.authReason !== 'ok' ? (
                      <>
                        {' because '}
                        <strong>{detailQuery.data.authReason}</strong>
                      </>
                    ) : null}
                  </Text>
                </div>
              </div>
            )}
            {/* U11 - the authentication decision for this request, inline. */}
            {detailQuery.data.requestId && (
              <AuthDecisionForRequest
                correlationId={detailQuery.data.requestId}
                endpointId={endpointId}
                persistedDecision={detailQuery.data.authDecision}
                data-testid="log-detail-auth-section"
              />
            )}
            <CopyableJsonBlock value={detailQuery.data.requestHeaders ?? {}} label="Request headers" data-testid="logs-tab-detail-request-headers" />
            <CopyableJsonBlock value={detailQuery.data.requestBody ?? null} label="Request body" data-testid="logs-tab-detail-request-body" />
            <CopyableJsonBlock value={detailQuery.data.responseHeaders ?? {}} label="Response headers" data-testid="logs-tab-detail-response-headers" />
            <CopyableJsonBlock value={detailQuery.data.responseBody ?? null} label="Response body" data-testid="logs-tab-detail-response-body" />
            {detailQuery.data.errorMessage && (
              <Text data-testid="logs-tab-detail-error-message">{detailQuery.data.errorMessage}</Text>
            )}
          </div>
        )}
      </DetailDrawer>
    </div>
  );
};

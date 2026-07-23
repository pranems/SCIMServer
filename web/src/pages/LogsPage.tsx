/**
 * LogsPage - global request logs page (across all endpoints).
 *
 * Phase D5 enhancement (v0.45.0-alpha.5):
 *   - Endpoint filter (Combobox driven by useEndpoints)
 *   - Status code filter (closed-set chips: 200 / 201 / 400 / 401 / 403 / 404 / 409 / 500)
 *   - Time range picker (closed-set chips: 1h / 24h / 7d / 30d)
 *   - URL contains free text (existing)
 *   - Click row -> DetailDrawer slides open with full request/response
 *     headers + bodies via useGlobalLog(id)
 *   - Filters live in URL search params (Phase A pattern). The selected
 *     row id also lives in the URL (?detail=...) so deep-links land
 *     directly on the open drawer state.
 *   - R4 polish: Spinner -> LoadingSkeleton, "No logs found" -> EmptyState
 *   - R6: useGlobalLogs hook wraps the existing options for ergonomics
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase D5
 * @see docs/PHASE_D5_GLOBAL_LOGS_ENHANCEMENT.md
 */
import React from 'react';
import {
  makeStyles,
  mergeClasses,
  tokens,
  Text,
  Badge,
  Subtitle1,
  Caption1,
  SearchBox,
  Combobox,
  Option,
  Button,
  Tooltip,
  Field,
} from '@fluentui/react-components';
import {
  ArrowReset24Regular,
  DocumentSearch24Regular,
  Open24Regular,
  Open16Regular,
} from '@fluentui/react-icons';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  useGlobalLogs,
  useGlobalLog,
  useEndpoints,
  useAuthDecisions,
  type GlobalLogsParams,
} from '../api/queries';
import type { GlobalLogsSearch, TimeRange } from '../routes/search-schemas';
import { TIME_RANGE_VALUES } from '../routes/search-schemas';
import { CopyableField, CopyableJsonBlock, DetailDrawer, EmptyState, LoadingSkeleton, AuthDecisionForRequest } from '../components/primitives';
import { AuthMethodChip } from '../components/primitives/AuthMethodChip';
import { ColumnResizeHandle } from '../components/primitives/ColumnResizeHandle';
import { useResizableColumns } from '../hooks/useResizableColumns';
import { clickableProps, toggleChipProps } from '../utils/interactive';

const LOGS_ROUTE_PATH = '/logs' as const;

// Closed-set status codes the picker offers - matches the spec's
// allowlist + the actual HTTP statuses the server emits.
const STATUS_OPTIONS = [200, 201, 400, 401, 403, 404, 409, 500] as const;

// Human labels for the time-range chips. Keep aligned with TIME_RANGE_VALUES.
const TIME_RANGE_LABEL: Record<TimeRange, string> = {
  '1h': 'Last 1 hour',
  '24h': 'Last 24 hours',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  custom: 'Custom',
};

const useStyles = makeStyles({
  page: { display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '1400px' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    flexWrap: 'wrap',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    alignItems: 'flex-end',
    padding: '12px',
    backgroundColor: tokens.colorNeutralBackground2,
    borderRadius: tokens.borderRadiusMedium,
  },
  toolbarItem: {
    minWidth: '180px',
  },
  chipRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    alignItems: 'center',
  },
  chip: {
    cursor: 'pointer',
  },
  // R5: horizontal-scroll wrapper so a narrow window scrolls instead of
  // clipping; the table stays >= minWidth for readability and expands to
  // fill wider windows.
  tableScroll: { width: '100%', overflowX: 'auto' },
  table: { width: '100%', minWidth: '720px', borderCollapse: 'collapse', tableLayout: 'fixed' },
  // Percentage column widths (R5.1) - scale proportionally on resize.
  colMethod: { width: '8%' },
  colUrl: { width: '31%' },
  colEndpoint: { width: '15%' },
  colStatus: { width: '10%' },
  colDuration: { width: '10%' },
  colTime: { width: '16%' },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    borderBottom: `2px solid ${tokens.colorNeutralStroke1}`,
    fontWeight: 600,
    fontSize: '13px',
    color: tokens.colorNeutralForeground3,
  },
  td: {
    padding: '10px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: '13px',
    overflow: 'hidden',
  },
  tr: {
    cursor: 'pointer',
    ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  trSelected: {
    backgroundColor: tokens.colorNeutralBackground1Selected,
  },
  method: {
    fontFamily: 'monospace',
    minWidth: '48px',
    textAlign: 'center' as const,
  },
  drawerSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '16px',
  },
  drawerSectionTitle: {
    color: tokens.colorNeutralForeground3,
    textTransform: 'uppercase',
    fontSize: '11px',
    letterSpacing: '0.5px',
  },
  drawerSectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  pre: {
    backgroundColor: tokens.colorNeutralBackground3,
    padding: '8px 12px',
    borderRadius: tokens.borderRadiusMedium,
    fontFamily: 'monospace',
    fontSize: '12px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    margin: 0,
    maxHeight: '320px',
    overflowY: 'auto',
  },
  errorBlock: {
    padding: '24px',
    color: tokens.colorPaletteRedForeground1,
  },
});

function methodColor(m: string): 'brand' | 'success' | 'warning' | 'danger' | 'informative' {
  switch (m.toUpperCase()) {
    case 'GET': return 'brand';
    case 'POST': return 'success';
    case 'PUT':
    case 'PATCH': return 'warning';
    case 'DELETE': return 'danger';
    default: return 'informative';
  }
}

function statusColor(s: number | undefined): 'success' | 'warning' | 'danger' | 'informative' {
  if (s === undefined) return 'informative';
  if (s >= 500) return 'danger';
  if (s >= 400) return 'warning';
  if (s >= 300) return 'informative';
  return 'success';
}

/**
 * Convert a TimeRange enum to an ISO 'since' timestamp. 'custom' is a
 * placeholder for a future date-picker; for now it falls back to no
 * filter so the UI doesn't lock the user into an empty result.
 */
function timeRangeToSince(range: TimeRange | undefined): string | undefined {
  if (!range || range === 'custom') return undefined;
  const now = Date.now();
  const ms = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  }[range];
  return new Date(now - ms).toISOString();
}

/** Row shape of GET /scim/admin/logs items. AdminLogsResponse uses
 *  Record<string, unknown> for forward compatibility; we cast inside
 *  the table renderer where we know the contract.
 */
interface LogRow {
  id: string;
  method: string;
  url: string;
  status?: number;
  durationMs?: number;
  createdAt: string | Date;
  /** X6 - the endpoint this request targeted, so the row can show its name. */
  endpointId?: string;
  /** P3 - the X-Request-Id correlation id echoed on each list item (U12). */
  requestId?: string;
  /** V10 - the auth decision persisted on the row itself (durable, instant). */
  authOutcome?: 'accept' | 'reject';
  authMethod?: string;
  authReason?: string;
  authCredentialId?: string;
}

export const LogsPage: React.FC = () => {
  const classes = useStyles();
  const search = useSearch({ strict: false }) as Partial<GlobalLogsSearch> & { detail?: string };
  const navigate = useNavigate();

  const urlContains = search.urlContains ?? '';
  const endpointId = search.endpointId;
  const status = search.status;
  const timeRange = search.timeRange;
  const detailId = search.detail;
  const requestId = search.requestId;

  // Endpoint dropdown source. Loads in parallel; harmless if it 404s
  // (just renders an empty Combobox).
  const endpointsQuery = useEndpoints();
  const endpointOptions = endpointsQuery.data?.endpoints ?? [];
  // X6 - endpointId -> name map so a log row can show the endpoint NAME + a
  // quick-open link, not just the opaque id in the URL.
  const endpointNameById = React.useMemo(
    () => new Map(endpointOptions.map((e) => [e.id, e.name])),
    [endpointOptions],
  );

  // X7 - drag-to-resize the 7 log columns (Method|URL|Endpoint|Status|Auth|Duration|Time).
  const cols = useResizableColumns('logs', 7, 'logs-col');

  // Compose the filter object that drives both the query key + the URL
  // search params on the API call. Keep this single source of truth so
  // we never request with one set of filters and cache under another.
  const params: GlobalLogsParams = {
    urlContains: urlContains || undefined,
    endpointId,
    status,
    since: timeRangeToSince(timeRange),
    requestId,
  };
  const { data, isLoading, error } = useGlobalLogs(params);
  const detailQuery = useGlobalLog(detailId);

  // U12 - the recent auth decisions, keyed by correlation id, so each request
  // log row can show a glanceable auth-outcome chip without opening the row.
  const authDecisions = useAuthDecisions({ limit: 100 });
  const authByCorrelation = React.useMemo(() => {
    const map = new Map<string, { outcome: 'accept' | 'reject'; reasonCode?: string }>();
    for (const r of authDecisions.data?.records ?? []) {
      if (r.correlationId && !map.has(r.correlationId)) {
        map.set(r.correlationId, { outcome: r.outcome, reasonCode: r.reasonCode });
      }
    }
    return map;
  }, [authDecisions.data]);

  // Helper that merges a partial filter patch into the current URL,
  // resetting page to 1 (we don't track page in this view yet but the
  // schema includes it for future pagination).
  const updateFilter = (patch: Partial<GlobalLogsSearch>): void => {
    navigate({
      to: LOGS_ROUTE_PATH,
      search: (prev) => {
        const merged = { ...(prev as GlobalLogsSearch), ...patch, page: 1 };
        // Normalize falsy strings to undefined so URLs stay clean.
        if (merged.urlContains === '') merged.urlContains = undefined;
        if (merged.endpointId === '') merged.endpointId = undefined;
        return merged;
      },
    });
  };

  const openDetail = (id: string): void => {
    navigate({
      to: LOGS_ROUTE_PATH,
      search: (prev) => ({ ...(prev as GlobalLogsSearch), detail: id }),
    });
  };

  const closeDetail = (): void => {
    navigate({
      to: LOGS_ROUTE_PATH,
      search: (prev) => {
        const next = { ...(prev as GlobalLogsSearch & { detail?: string }) };
        delete next.detail;
        return next;
      },
    });
  };

  const resetFilters = (): void => {
    navigate({
      to: LOGS_ROUTE_PATH,
      // Phase N4: omit pageSize so the schema's optional() leaves it
      // unset; consumers fall back to the persisted user preference.
      search: () => ({ page: 1 } as GlobalLogsSearch),
    });
  };

  const hasFilters = Boolean(urlContains || endpointId || status || timeRange || requestId);

  if (error) {
    return (
      <div className={classes.errorBlock} data-testid="global-logs-error">
        <Text>Failed to load logs: {(error as Error).message}</Text>
      </div>
    );
  }

  return (
    <div className={classes.page} data-testid="global-logs-page">
      <div className={classes.header}>
        <Subtitle1>Request Logs ({data?.total ?? 0})</Subtitle1>
        {hasFilters && (
          <Button
            appearance="subtle"
            icon={<ArrowReset24Regular />}
            onClick={resetFilters}
            data-testid="logs-reset-filters"
          >
            Reset filters
          </Button>
        )}
      </div>

      {/* U12 - the standalone auth-diagnostics panel is re-scoped to the
          endpoint Connect -> Health surface. Per-request auth now lives inside
          the request's own DetailDrawer (U11). The logs surface shows an auth
          chip per row + the full decision inline in the drawer. */}

      {/* Phase D5 toolbar: endpoint + status + time range + free-text */}
      <div className={classes.toolbar} data-testid="logs-toolbar">
        <Field label="URL contains" className={classes.toolbarItem}>
          <SearchBox
            placeholder="Filter by URL..."
            value={urlContains}
            onChange={(_, d) => updateFilter({ urlContains: d.value })}
            data-testid="logs-search"
          />
        </Field>

        <Field label="Endpoint" className={classes.toolbarItem}>
          <Combobox
            placeholder="All endpoints"
            value={
              endpointId
                ? endpointOptions.find((e) => e.id === endpointId)?.name ?? endpointId
                : ''
            }
            selectedOptions={endpointId ? [endpointId] : []}
            onOptionSelect={(_, d) => updateFilter({ endpointId: d.optionValue || undefined })}
            data-testid="logs-endpoint-select"
            clearable
          >
            {endpointOptions.map((ep) => (
              <Option key={ep.id} value={ep.id} text={ep.displayName ?? ep.name}>
                {ep.displayName ?? ep.name}
              </Option>
            ))}
          </Combobox>
        </Field>

        <Field label="Status" className={classes.toolbarItem}>
          <div className={classes.chipRow} data-testid="logs-status-chips">
            {STATUS_OPTIONS.map((s) => (
              <Badge
                key={s}
                appearance={status === s ? 'filled' : 'outline'}
                color={statusColor(s)}
                className={classes.chip}
                {...toggleChipProps(() => updateFilter({ status: status === s ? undefined : s }), status === s)}
                data-testid={`logs-status-chip-${s}`}
              >
                {s}
              </Badge>
            ))}
          </div>
        </Field>

        <Field label="Time range" className={classes.toolbarItem}>
          <div className={classes.chipRow} data-testid="logs-time-chips">
            {TIME_RANGE_VALUES.filter((v) => v !== 'custom').map((tr) => (
              <Badge
                key={tr}
                appearance={timeRange === tr ? 'filled' : 'outline'}
                color="brand"
                className={classes.chip}
                {...toggleChipProps(() => updateFilter({ timeRange: timeRange === tr ? undefined : tr }), timeRange === tr)}
                data-testid={`logs-time-chip-${tr}`}
              >
                {TIME_RANGE_LABEL[tr]}
              </Badge>
            ))}
          </div>
        </Field>
      </div>

      {/* Body: skeleton -> table -> empty state */}
      {isLoading ? (
        // R4 - LoadingSkeleton replaces Spinner. Mirror final table row
        // shape for zero CLS.
        <LoadingSkeleton count={8} height="40px" data-testid="logs-loading-skeleton" />
      ) : (data?.items ?? []).length === 0 ? (
        // R4 - EmptyState replaces "No logs found" plain text. CTA
        // appears only when filters are active (so an actually-empty
        // server doesn't get a misleading "Reset filters" prompt).
        <EmptyState
          icon={<DocumentSearch24Regular />}
          title="No logs match these filters"
          body={
            hasFilters
              ? 'Try widening the time range, choosing a different endpoint, or clearing filters.'
              : 'No request logs have been recorded yet. SCIM operations will appear here as they occur.'
          }
          actionLabel={hasFilters ? 'Reset filters' : undefined}
          onAction={hasFilters ? resetFilters : undefined}
          data-testid="logs-empty"
        />
      ) : (
        <div className={classes.tableScroll}>
        <table className={classes.table}>
          <thead>
            <tr>
              <th className={mergeClasses(classes.th, classes.colMethod)} style={cols.headerProps(0).style}>Method<ColumnResizeHandle {...cols.handleProps(0)} /></th>
              <th className={mergeClasses(classes.th, classes.colUrl)} style={cols.headerProps(1).style}>URL<ColumnResizeHandle {...cols.handleProps(1)} /></th>
              <th className={mergeClasses(classes.th, classes.colEndpoint)} style={cols.headerProps(2).style}>Endpoint<ColumnResizeHandle {...cols.handleProps(2)} /></th>
              <th className={mergeClasses(classes.th, classes.colStatus)} style={cols.headerProps(3).style}>Status<ColumnResizeHandle {...cols.handleProps(3)} /></th>
              <th className={mergeClasses(classes.th, classes.colStatus)} style={cols.headerProps(4).style}>Auth<ColumnResizeHandle {...cols.handleProps(4)} /></th>
              <th className={mergeClasses(classes.th, classes.colDuration)} style={cols.headerProps(5).style}>Duration<ColumnResizeHandle {...cols.handleProps(5)} /></th>
              <th className={mergeClasses(classes.th, classes.colTime)} style={cols.headerProps(6).style}>Time</th>
            </tr>
          </thead>
          <tbody>
            {((data?.items ?? []) as unknown as LogRow[]).map((log) => (
              <tr
                key={log.id}
                className={`${classes.tr} ${log.id === detailId ? classes.trSelected : ''}`}
                {...clickableProps(() => openDetail(log.id), `Open log ${log.method} ${log.url}`)}
                data-testid={`logs-row-${log.id}`}
              >
                <td className={classes.td}>
                  <Badge
                    appearance="filled"
                    color={methodColor(log.method)}
                    className={classes.method}
                  >
                    {log.method}
                  </Badge>
                </td>
                <td className={classes.td}>
                  <CopyableField
                    value={log.url}
                    truncate
                    monospace
                    maxWidth="100%"
                    data-testid={`log-row-url-${log.id}`}
                  />
                </td>
                <td className={classes.td}>
                  {log.endpointId ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0 }}>
                      <CopyableField
                        value={endpointNameById.get(log.endpointId) ?? log.endpointId}
                        truncate
                        maxWidth="100%"
                        data-testid={`log-row-endpoint-${log.id}`}
                      />
                      <Tooltip content="Open this endpoint" relationship="label" positioning="above">
                        <Button
                          appearance="subtle"
                          size="small"
                          icon={<Open16Regular />}
                          onClick={(e) => {
                            e.stopPropagation();
                            void navigate({ to: '/endpoints/$endpointId', params: { endpointId: log.endpointId! } });
                          }}
                          aria-label={`Open endpoint ${endpointNameById.get(log.endpointId) ?? log.endpointId}`}
                          data-testid={`log-row-endpoint-open-${log.id}`}
                        />
                      </Tooltip>
                    </div>
                  ) : (
                    <Caption1 data-testid={`log-row-endpoint-${log.id}`}>-</Caption1>
                  )}
                </td>
                <td className={classes.td}>
                  <Badge appearance="outline" color={statusColor(log.status)}>
                    {log.status ?? '-'}
                  </Badge>
                </td>
                <td className={classes.td}>
                  {(() => {
                    // V10/V12 - prefer the auth summary PERSISTED on the row
                    // (durable, survives the short-TTL auth-decision store, no
                    // second query). Fall back to the live auth-decision map for
                    // rows written before the persisted fields existed.
                    const persisted = log.authOutcome
                      ? { outcome: log.authOutcome, reasonCode: log.authReason, method: log.authMethod }
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
                    {log.createdAt ? new Date(log.createdAt).toLocaleString() : '-'}
                  </Caption1>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {/* Phase D5 - DetailDrawer for log inspection */}
      <DetailDrawer
        open={Boolean(detailId)}
        onClose={closeDetail}
        title={
          detailQuery.data
            ? `${detailQuery.data.method} ${detailQuery.data.url}`
            : 'Log detail'
        }
        data-testid="logs-detail-drawer"
        footer={
          <Button
            appearance="subtle"
            icon={<Open24Regular />}
            onClick={closeDetail}
            data-testid="logs-detail-close"
          >
            Close
          </Button>
        }
      >
        {detailQuery.isLoading && (
          <LoadingSkeleton count={6} height="40px" data-testid="logs-detail-skeleton" />
        )}
        {detailQuery.error && (
          <Text className={classes.errorBlock}>
            Failed to load log: {(detailQuery.error as Error).message}
          </Text>
        )}
        {detailQuery.data && (
          <>
            <div className={classes.drawerSection}>
              <Caption1 className={classes.drawerSectionTitle}>URL</Caption1>
              <CopyableField
                value={detailQuery.data.url ?? ''}
                truncate
                monospace
                maxWidth="100%"
                data-testid="log-detail-url"
              />
            </div>

            <div className={classes.drawerSection}>
              <Caption1 className={classes.drawerSectionTitle}>Status</Caption1>
              <Badge appearance="filled" color={statusColor(detailQuery.data.status)}>
                {detailQuery.data.status ?? '-'}
              </Badge>
            </div>

            <div className={classes.drawerSection}>
              <Caption1 className={classes.drawerSectionTitle}>Duration</Caption1>
              <Text>{detailQuery.data.durationMs ?? 0}ms</Text>
            </div>

            {detailQuery.data.requestId && (
              <div className={classes.drawerSection} data-testid="log-detail-correlation">
                <Caption1 className={classes.drawerSectionTitle}>Correlation id</Caption1>
                <CopyableField
                  value={detailQuery.data.requestId}
                  monospace
                  maxWidth="100%"
                  data-testid="log-detail-request-id"
                />
              </div>
            )}

            {/* V11 - durable one-line auth summary from the fields PERSISTED on
                the row. Present even after the short-TTL auth-decision store
                has expired, unlike the deep U11 diff below. */}
            {detailQuery.data.authOutcome && (
              <div className={classes.drawerSection} data-testid="log-detail-auth-summary">
                <Caption1 className={classes.drawerSectionTitle}>Authentication</Caption1>
                <Badge
                  appearance="filled"
                  color={detailQuery.data.authOutcome === 'accept' ? 'success' : 'danger'}
                >
                  {detailQuery.data.authOutcome === 'accept' ? 'auth ok' : 'auth fail'}
                </Badge>
                <Text block>
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
            )}

            {/* U11 - the authentication decision for this request, inline. */}
            {detailQuery.data.requestId && (
              <div className={classes.drawerSection}>
                <AuthDecisionForRequest
                  correlationId={detailQuery.data.requestId}
                  persistedDecision={detailQuery.data.authDecision}
                  data-testid="log-detail-auth-section"
                />
              </div>
            )}

            <div className={classes.drawerSection}>
              <CopyableJsonBlock
                value={detailQuery.data.requestHeaders ?? {}}
                label="Request headers"
                data-testid="log-detail-request-headers"
              />
            </div>

            <div className={classes.drawerSection}>
              <CopyableJsonBlock
                value={detailQuery.data.requestBody ?? null}
                label="Request body"
                data-testid="log-detail-request-body"
              />
            </div>

            <div className={classes.drawerSection}>
              <CopyableJsonBlock
                value={detailQuery.data.responseHeaders ?? {}}
                label="Response headers"
                data-testid="log-detail-response-headers"
              />
            </div>

            <div className={classes.drawerSection}>
              <CopyableJsonBlock
                value={detailQuery.data.responseBody ?? null}
                label="Response body"
                data-testid="log-detail-response-body"
              />
            </div>

            {detailQuery.data.errorMessage && (
              <div className={classes.drawerSection}>
                <Caption1 className={classes.drawerSectionTitle}>Error message</Caption1>
                <Text className={classes.errorBlock}>
                  {detailQuery.data.errorMessage}
                </Text>
              </div>
            )}
          </>
        )}
      </DetailDrawer>
    </div>
  );
};

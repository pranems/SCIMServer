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
  tokens,
  Text,
  Badge,
  Subtitle1,
  Caption1,
  SearchBox,
  Combobox,
  Option,
  Button,
  Field,
} from '@fluentui/react-components';
import {
  ArrowReset24Regular,
  DocumentSearch24Regular,
  Open24Regular,
} from '@fluentui/react-icons';
import { useNavigate, useSearch } from '@tanstack/react-router';
import {
  useGlobalLogs,
  useGlobalLog,
  useEndpoints,
  type GlobalLogsParams,
} from '../api/queries';
import type { GlobalLogsSearch, TimeRange } from '../routes/search-schemas';
import { TIME_RANGE_VALUES } from '../routes/search-schemas';
import { DetailDrawer, EmptyState, LoadingSkeleton } from '../components/primitives';

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
  table: { width: '100%', borderCollapse: 'collapse' },
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

  // Endpoint dropdown source. Loads in parallel; harmless if it 404s
  // (just renders an empty Combobox).
  const endpointsQuery = useEndpoints();
  const endpointOptions = endpointsQuery.data?.endpoints ?? [];

  // Compose the filter object that drives both the query key + the URL
  // search params on the API call. Keep this single source of truth so
  // we never request with one set of filters and cache under another.
  const params: GlobalLogsParams = {
    urlContains: urlContains || undefined,
    endpointId,
    status,
    since: timeRangeToSince(timeRange),
  };
  const { data, isLoading, error } = useGlobalLogs(params);
  const detailQuery = useGlobalLog(detailId);

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
      search: () => ({ page: 1, pageSize: 20 } as GlobalLogsSearch),
    });
  };

  const hasFilters = Boolean(urlContains || endpointId || status || timeRange);

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
                onClick={() =>
                  updateFilter({ status: status === s ? undefined : s })
                }
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
                onClick={() =>
                  updateFilter({ timeRange: timeRange === tr ? undefined : tr })
                }
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
            {((data?.items ?? []) as unknown as LogRow[]).map((log) => (
              <tr
                key={log.id}
                className={`${classes.tr} ${log.id === detailId ? classes.trSelected : ''}`}
                onClick={() => openDetail(log.id)}
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
                  <Caption1 style={{ fontFamily: 'monospace' }}>{log.url}</Caption1>
                </td>
                <td className={classes.td}>
                  <Badge appearance="outline" color={statusColor(log.status)}>
                    {log.status ?? '-'}
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
              <Caption1 className={classes.drawerSectionTitle}>Status</Caption1>
              <Badge appearance="filled" color={statusColor(detailQuery.data.status)}>
                {detailQuery.data.status ?? '-'}
              </Badge>
            </div>

            <div className={classes.drawerSection}>
              <Caption1 className={classes.drawerSectionTitle}>Duration</Caption1>
              <Text>{detailQuery.data.durationMs ?? 0}ms</Text>
            </div>

            <div className={classes.drawerSection}>
              <Caption1 className={classes.drawerSectionTitle}>Request headers</Caption1>
              <pre className={classes.pre}>
                {JSON.stringify(detailQuery.data.requestHeaders ?? {}, null, 2)}
              </pre>
            </div>

            <div className={classes.drawerSection}>
              <Caption1 className={classes.drawerSectionTitle}>Request body</Caption1>
              <pre className={classes.pre}>
                {JSON.stringify(detailQuery.data.requestBody ?? null, null, 2)}
              </pre>
            </div>

            <div className={classes.drawerSection}>
              <Caption1 className={classes.drawerSectionTitle}>Response headers</Caption1>
              <pre className={classes.pre}>
                {JSON.stringify(detailQuery.data.responseHeaders ?? {}, null, 2)}
              </pre>
            </div>

            <div className={classes.drawerSection}>
              <Caption1 className={classes.drawerSectionTitle}>Response body</Caption1>
              <pre className={classes.pre}>
                {JSON.stringify(detailQuery.data.responseBody ?? null, null, 2)}
              </pre>
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

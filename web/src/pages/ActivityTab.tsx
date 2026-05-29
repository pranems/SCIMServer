/**
 * ActivityTab - per-endpoint parsed-activity surface (Phase D2).
 *
 * Renders the BFF-parsed ActivitySummary stream for one endpoint,
 * with type / severity / search filters that live in the URL.
 *
 * Compositional contract:
 *   - Loading: LoadingSkeleton primitive (mirrors final layout - G1)
 *   - Empty: EmptyState primitive ("No activity matches these filters")
 *   - Real-time: SSE channel-aware invalidation (Phase B3 + D2 wiring)
 *   - Filter inputs are driven by + drive the URL search params via
 *     activitySearchSchema (zod). Refresh / deep-link preserve them.
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase D2
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md S5.2 (route table)
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Card,
  Subtitle2,
  Caption1,
  Body1,
  Dropdown,
  Option,
  Input,
  Badge,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
} from '@fluentui/react-components';
import {
  History24Regular,
  ArrowReset24Regular,
} from '@fluentui/react-icons';
import { useEndpointActivity, type ActivitySummaryItem } from '../api/queries';
import { EmptyState, ExportSplitButton, LoadingSkeleton } from '../components/primitives';
import { usePreferencesStore } from '../store/preferences-store';
import {
  ACTIVITY_TYPE_VALUES,
  ACTIVITY_SEVERITY_VALUES,
  type ActivityType,
  type ActivitySeverity,
} from '../routes/search-schemas';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  toolbar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    alignItems: 'center',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: 'auto auto auto 1fr auto',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 12px',
    borderRadius: tokens.borderRadiusMedium,
    fontSize: '13px',
  },
  rowAlt: {
    backgroundColor: tokens.colorNeutralBackground2,
  },
  meta: { color: tokens.colorNeutralForeground3 },
  message: { color: tokens.colorNeutralForeground1 },
  details: { color: tokens.colorNeutralForeground2 },
  pagination: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: '8px',
    color: tokens.colorNeutralForeground3,
  },
  errorBlock: {
    padding: '16px',
    color: tokens.colorPaletteRedForeground1,
  },
});

export interface ActivityTabProps {
  endpointId: string;
  /** Current URL-driven filter state (from useSearch on the route). */
  search: {
    page: number;
    // Phase N4: pageSize is now optional in the URL schema (preference
    // store provides the fallback). Component honors `defaultPageSize`
    // from `usePreferencesStore` when this is undefined.
    pageSize?: number;
    type?: ActivityType;
    severity?: ActivitySeverity;
    search?: string;
  };
  /**
   * Apply a partial change to the URL search params. Pages that mount
   * this component pass an adapter around `useNavigate({ to: ... })`.
   * Passing a value of `undefined` removes that key from the URL.
   */
  onSearchChange: (partial: Partial<ActivityTabProps['search']>) => void;
}

/** Severity -> Fluent badge color map. */
function severityColor(s: ActivitySeverity | string): 'success' | 'informative' | 'warning' | 'danger' | 'subtle' {
  switch (s) {
    case 'success': return 'success';
    case 'info': return 'informative';
    case 'warning': return 'warning';
    case 'error': return 'danger';
    default: return 'subtle';
  }
}

function formatTime(ts: string | Date): string {
  try {
    const d = typeof ts === 'string' ? new Date(ts) : ts;
    return d.toLocaleTimeString();
  } catch {
    return String(ts);
  }
}

export const ActivityTab: React.FC<ActivityTabProps> = ({
  endpointId,
  search,
  onSearchChange,
}) => {
  const classes = useStyles();
  // Phase N4: fall back to the persisted user preference when the URL
  // has no explicit `?pageSize`.
  const defaultPageSize = usePreferencesStore((s) => s.defaultPageSize);
  const limit = search.pageSize ?? defaultPageSize;
  const { data, isLoading, error } = useEndpointActivity({
    endpointId,
    page: search.page,
    limit,
    type: search.type,
    severity: search.severity,
    search: search.search,
  });

  // Local controlled input mirror so each keystroke doesn't push to
  // the URL (only on commit / Enter / debounce). Kept simple here -
  // commit on blur or Enter. URL stays clean.
  const [searchDraft, setSearchDraft] = React.useState<string>(search.search ?? '');
  React.useEffect(() => {
    setSearchDraft(search.search ?? '');
  }, [search.search]);

  const commitSearch = (): void => {
    const v = searchDraft.trim();
    onSearchChange({ search: v.length > 0 ? v : undefined, page: 1 });
  };

  const resetFilters = (): void => {
    setSearchDraft('');
    onSearchChange({
      type: undefined,
      severity: undefined,
      search: undefined,
      page: 1,
    });
  };

  const filtersActive =
    !!search.type || !!search.severity || !!search.search;

  return (
    <div className={classes.root} data-testid="tab-activity">
      <Subtitle2>Activity</Subtitle2>

      {/* Phase N3 - Export button (CSV / JSON / NDJSON) for the current activity page */}
      <ExportSplitButton
        rows={(data?.activities ?? []).map((a) => ({
          id: a.id,
          timestamp: a.timestamp ?? '',
          type: a.type ?? '',
          severity: a.severity ?? '',
          message: a.message ?? '',
          details: a.details ?? '',
        }))}
        filenameBase={`activity-${endpointId}`}
        columns={['id', 'timestamp', 'type', 'severity', 'message', 'details']}
      />

      {/* Filter toolbar (URL-driven) */}
      <Toolbar className={classes.toolbar} aria-label="Activity filters">
        <Dropdown
          aria-label="Filter by activity type"
          placeholder="All types"
          value={search.type ?? 'All types'}
          selectedOptions={search.type ? [search.type] : []}
          onOptionSelect={(_, d) =>
            onSearchChange({
              type: (d.optionValue as ActivityType | undefined) || undefined,
              page: 1,
            })
          }
          data-testid="activity-filter-type"
        >
          <Option value="">All types</Option>
          {ACTIVITY_TYPE_VALUES.map((v) => (
            <Option key={v} value={v}>
              {v}
            </Option>
          ))}
        </Dropdown>

        <Dropdown
          aria-label="Filter by severity"
          placeholder="All severities"
          value={search.severity ?? 'All severities'}
          selectedOptions={search.severity ? [search.severity] : []}
          onOptionSelect={(_, d) =>
            onSearchChange({
              severity: (d.optionValue as ActivitySeverity | undefined) || undefined,
              page: 1,
            })
          }
          data-testid="activity-filter-severity"
        >
          <Option value="">All severities</Option>
          {ACTIVITY_SEVERITY_VALUES.map((v) => (
            <Option key={v} value={v}>
              {v}
            </Option>
          ))}
        </Dropdown>

        <Input
          aria-label="Search activity"
          placeholder="Search..."
          value={searchDraft}
          onChange={(_, d) => setSearchDraft(d.value)}
          onBlur={commitSearch}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitSearch();
          }}
          data-testid="activity-filter-search"
        />

        {filtersActive && (
          <>
            <ToolbarDivider />
            <ToolbarButton
              icon={<ArrowReset24Regular />}
              onClick={resetFilters}
              data-testid="activity-filter-reset"
            >
              Reset
            </ToolbarButton>
          </>
        )}
      </Toolbar>

      {/* Loading - skeleton mirrors final layout */}
      {isLoading && (
        <LoadingSkeleton count={10} height="32px" data-testid="activity-skeleton" />
      )}

      {/* Error */}
      {error && !isLoading && (
        <div className={classes.errorBlock} data-testid="activity-error">
          <Body1>Failed to load activity: {(error as Error).message}</Body1>
        </div>
      )}

      {/* Empty (after load) */}
      {!isLoading && !error && data && data.activities.length === 0 && (
        <EmptyState
          icon={<History24Regular />}
          title={filtersActive ? 'No activity matches these filters' : 'No activity yet'}
          body={
            filtersActive
              ? 'Try widening or resetting the filters above.'
              : 'SCIM operations against this endpoint will appear here.'
          }
          actionLabel={filtersActive ? 'Reset filters' : undefined}
          onAction={filtersActive ? resetFilters : undefined}
          data-testid="activity-empty"
        />
      )}

      {/* Rows */}
      {!isLoading && !error && data && data.activities.length > 0 && (
        <Card>
          <div className={classes.list} data-testid="activity-list">
            {data.activities.map((entry, i) => (
              <ActivityRow key={entry.id} entry={entry} alternate={i % 2 === 1} />
            ))}
          </div>
          <div className={classes.pagination} data-testid="activity-pagination">
            <Caption1>
              Page {data.pagination.page} of {Math.max(1, data.pagination.pages)} ({data.pagination.total} total)
            </Caption1>
          </div>
        </Card>
      )}
    </div>
  );
};

interface ActivityRowProps {
  entry: ActivitySummaryItem;
  alternate: boolean;
}

const ActivityRow: React.FC<ActivityRowProps> = ({ entry, alternate }) => {
  const classes = useStyles();
  return (
    <div
      className={`${classes.row} ${alternate ? classes.rowAlt : ''}`}
      data-testid={`activity-row-${entry.id}`}
    >
      <Caption1 className={classes.meta}>{formatTime(entry.timestamp)}</Caption1>
      <Badge appearance="outline">{entry.type}</Badge>
      <Badge appearance="filled" color={severityColor(entry.severity)}>
        {entry.severity}
      </Badge>
      <span className={classes.message} title={entry.details}>
        {entry.icon} {entry.message}
      </span>
      <Caption1 className={classes.details}>{entry.details}</Caption1>
    </div>
  );
};

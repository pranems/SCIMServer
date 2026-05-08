/**
 * OverviewTab - per-endpoint overview surface (KPIs + recent activity + flags).
 *
 * Phase A2 (cutover): extracted from EndpointDetailPage so it can render
 * as the index child route of `/endpoints/$endpointId` via TanStack Router's
 * <Outlet /> mechanism instead of being switched in by component-local state.
 *
 * Phase B2: replaced two separate hooks (useEndpoint + useEndpointStats)
 * with a single useEndpointOverview that hits the BFF endpoint added in
 * Phase B1. One round trip, no waterfall.
 *
 * Phase D1: data-completeness pass per UI_REDESIGN_REMAINING_GAPS_PLAN
 * Section 7.1. Adds:
 *   - Recent Activity list (up to 10 entries, server already capped)
 *   - EmptyState in the Recent Activity slot when there is nothing yet
 *   - Config Flags KPI card with the count of explicitly-enabled flags
 *   - LoadingSkeleton primitive instead of an ad-hoc Spinner so the
 *     loading shape mirrors the final layout (Phase G1 pattern)
 *
 * The rendered layout is:
 *   Stats KPI grid (Users / Groups / Generic / Credentials / Flags)
 *   Recent Activity card (table-of-rows OR EmptyState)
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md S7.1
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Card,
  Text,
  Subtitle2,
  Caption1,
  Badge,
} from '@fluentui/react-components';
import {
  People24Regular,
  PeopleTeam24Regular,
  PeopleCommunity24Regular,
  Key24Regular,
  Settings24Regular,
  History24Regular,
} from '@fluentui/react-icons';
import { useEndpointOverview } from '../api/queries';
import type { EndpointOverviewActivity } from '@scim/types/dashboard.types';
import { EmptyState, LoadingSkeleton } from '../components/primitives';

const useStyles = makeStyles({
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: '12px',
  },
  kpiCard: {
    padding: '16px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  kpiIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
  },
  kpiValues: {
    display: 'flex',
    flexDirection: 'column',
  },
  section: {
    marginTop: '24px',
  },
  activityList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  activityRow: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr auto auto auto',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 12px',
    borderRadius: tokens.borderRadiusMedium,
    fontFamily: 'monospace',
    fontSize: '12px',
  },
  activityRowAlt: {
    backgroundColor: tokens.colorNeutralBackground2,
  },
  activityPath: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: tokens.colorNeutralForeground2,
  },
  activityMeta: {
    color: tokens.colorNeutralForeground3,
  },
  errorBlock: {
    padding: '16px',
    color: tokens.colorPaletteRedForeground1,
  },
});

interface OverviewTabProps {
  endpointId: string;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({ endpointId }) => {
  const classes = useStyles();
  const { data, isLoading, error } = useEndpointOverview(endpointId);

  // While loading we mirror the final layout with skeletons. This is the
  // Phase G1 pattern (no "Loading..." text) AND keeps the visible
  // layout stable when data arrives - reduces CLS.
  if (isLoading || !data) {
    return (
      <div data-testid="tab-overview">
        <Subtitle2 style={{ marginBottom: '12px' }}>Resource Statistics</Subtitle2>
        <div className={classes.kpiRow} data-testid="overview-skeleton">
          <LoadingSkeleton count={5} height="72px" data-testid="overview-skeleton-kpi" />
        </div>
        <div className={classes.section}>
          <Subtitle2 style={{ marginBottom: '12px' }}>Recent Activity</Subtitle2>
          <LoadingSkeleton count={5} height="28px" data-testid="overview-skeleton-activity" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={classes.errorBlock} data-testid="tab-overview-error">
        <Text>Failed to load overview: {(error as Error).message}</Text>
      </div>
    );
  }

  const { stats, credentials, recentActivity, configFlags } = data;
  // Active credential count for the KPI card. The Credentials tab will
  // render the full list and detail (Phase E1).
  const activeCredentialCount = credentials.filter((c) => c.active).length;
  // Count only flags that are explicitly the boolean `true`. Strings
  // (e.g. logLevel='INFO') and `false` flags should not contribute to
  // the "enabled" tally because they would falsely inflate it.
  const enabledFlagCount = Object.values(configFlags).filter(
    (v) => v === true,
  ).length;

  return (
    <div data-testid="tab-overview">
      <Subtitle2 style={{ marginBottom: '12px' }}>Resource Statistics</Subtitle2>
      <div className={classes.kpiRow}>
        <KpiCard
          icon={<People24Regular />}
          label="Users"
          value={stats.userCount}
          subtitle={`${stats.activeUserCount} active`}
        />
        <KpiCard
          icon={<PeopleTeam24Regular />}
          label="Groups"
          value={stats.groupCount}
          subtitle={`${stats.activeGroupCount} active`}
        />
        <KpiCard
          icon={<PeopleCommunity24Regular />}
          label="Generic Resources"
          value={stats.genericResourceCount}
        />
        <KpiCard
          icon={<Key24Regular />}
          label="Credentials"
          value={credentials.length}
          subtitle={`${activeCredentialCount} active`}
        />
        <KpiCard
          icon={<Settings24Regular />}
          label="Config Flags"
          value={Object.keys(configFlags).length}
          subtitle={`${enabledFlagCount} enabled`}
          data-testid="overview-flags-card"
        />
      </div>

      <div className={classes.section}>
        <Subtitle2 style={{ marginBottom: '12px' }}>Recent Activity</Subtitle2>
        {recentActivity.length === 0 ? (
          <EmptyState
            icon={<History24Regular />}
            title="No recent activity"
            body="SCIM operations against this endpoint will appear here."
            data-testid="overview-activity-empty"
          />
        ) : (
          <Card data-testid="overview-activity">
            <div className={classes.activityList}>
              {recentActivity.map((entry, i) => (
                <ActivityRow key={entry.id} entry={entry} alternate={i % 2 === 1} />
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
};

interface KpiCardProps {
  icon: React.ReactElement;
  label: string;
  value: number;
  subtitle?: string;
  'data-testid'?: string;
}

const KpiCard: React.FC<KpiCardProps> = ({
  icon,
  label,
  value,
  subtitle,
  ...rest
}) => {
  const classes = useStyles();
  return (
    <Card className={classes.kpiCard} data-testid={rest['data-testid']}>
      <div className={classes.kpiIcon}>{icon}</div>
      <div className={classes.kpiValues}>
        <Text size={500} weight="semibold">{value}</Text>
        <Caption1>{label}</Caption1>
        {subtitle && <Caption1>{subtitle}</Caption1>}
      </div>
    </Card>
  );
};

interface ActivityRowProps {
  entry: EndpointOverviewActivity;
  alternate: boolean;
}

/**
 * Status code -> Fluent badge color mapping. 2xx green, 3xx informative,
 * 4xx warning, 5xx danger. Anything else (0, undefined) renders neutral.
 */
function statusBadgeColor(status: number): 'success' | 'informative' | 'warning' | 'danger' | 'subtle' {
  if (status >= 200 && status < 300) return 'success';
  if (status >= 300 && status < 400) return 'informative';
  if (status >= 400 && status < 500) return 'warning';
  if (status >= 500) return 'danger';
  return 'subtle';
}

const ActivityRow: React.FC<ActivityRowProps> = ({ entry, alternate }) => {
  const classes = useStyles();
  // Format timestamp as HH:MM:SS local. Recent activity is by definition
  // recent so the date is implicit; saving column space.
  const time = (() => {
    try {
      return new Date(entry.timestamp).toLocaleTimeString();
    } catch {
      return entry.timestamp;
    }
  })();
  return (
    <div
      className={`${classes.activityRow} ${alternate ? classes.activityRowAlt : ''}`}
      data-testid={`overview-activity-row-${entry.id}`}
    >
      <Caption1 className={classes.activityMeta}>{time}</Caption1>
      <span className={classes.activityPath} title={entry.path}>{entry.path}</span>
      <Badge appearance="outline">{entry.method}</Badge>
      <Badge appearance="filled" color={statusBadgeColor(entry.statusCode)}>
        {entry.statusCode}
      </Badge>
      <Caption1 className={classes.activityMeta}>{entry.durationMs}ms</Caption1>
    </div>
  );
};

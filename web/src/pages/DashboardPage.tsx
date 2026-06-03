/**
 * DashboardPage - main dashboard with KPI cards, 24h request chart,
 * endpoint cards, and recent activity.
 *
 * Reads from BFF /admin/dashboard endpoint (0 DB queries for stats via
 * StatsProjectionService). All data comes from TanStack Query cache.
 *
 * Phase D4 additions:
 *   - 24-hour request volume chart wired to `requestsLast24hSeries`
 *     (via the Phase C4 KpiChart sparkline primitive)
 *   - Loading state migrated from Spinner to LoadingSkeleton (R2)
 *   - Empty states migrated from plain Text to EmptyState (R3)
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md Phase 2 Step 2.1
 * @see docs/PHASE_D4_DASHBOARD_CHARTS.md
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Card,
  CardHeader,
  Text,
  Badge,
  Subtitle1,
  Body1,
  Caption1,
} from '@fluentui/react-components';
import {
  People24Regular,
  PeopleTeam24Regular,
  Server24Regular,
  CheckmarkCircle24Regular,
  History24Regular,
  ChartMultiple24Regular,
  DataPie24Regular,
} from '@fluentui/react-icons';
import { useDashboard, useActivitySummary } from '../api/queries';
import { useNavigate } from '@tanstack/react-router';
import type { DashboardResponse, DashboardEndpoint } from '@scim/types/dashboard.types';
import { EmptyState, KpiChart, LoadingSkeleton } from '../components/primitives';

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
    maxWidth: '1400px',
  },
  kpiRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
  },
  kpiCard: {
    padding: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  kpiIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '48px',
    height: '48px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
  },
  kpiValues: {
    display: 'flex',
    flexDirection: 'column',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  endpointGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: '16px',
  },
  endpointCard: {
    padding: '16px',
    cursor: 'pointer',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  endpointStats: {
    display: 'flex',
    gap: '16px',
    marginTop: '8px',
  },
  activityList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  activityItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 12px',
    borderRadius: tokens.borderRadiusMedium,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  methodBadge: {
    fontFamily: 'monospace',
    minWidth: '56px',
    textAlign: 'center' as const,
  },
  errorItem: {
    color: tokens.colorPaletteRedForeground1,
  },
  // Phase D4 - chart card. Fixed height keeps the layout stable while
  // recharts measures its own width via ResponsiveContainer.
  chartCard: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  chartArea: {
    height: '120px',
    width: '100%',
  },
  chartHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  chartHeaderText: {
    flex: 1,
  },
  errorBlock: {
    padding: '24px',
    color: tokens.colorPaletteRedForeground1,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  // Phase L3 - activity analytics section. Sits between the sparkline
  // chart and the endpoint grid. The 4 KPI tiles reuse the kpiRow grid
  // layout. The ops-split bar uses a flex pair of colored fills with
  // proportional widths.
  analyticsCard: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  analyticsHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  opsSplitBar: {
    display: 'flex',
    width: '100%',
    height: '24px',
    borderRadius: tokens.borderRadiusMedium,
    overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground3,
  },
  opsSplitUsers: {
    backgroundColor: tokens.colorBrandBackground,
    height: '100%',
  },
  opsSplitGroups: {
    backgroundColor: tokens.colorPaletteGreenBackground2,
    height: '100%',
  },
  opsSplitLegend: {
    display: 'flex',
    justifyContent: 'space-between',
    color: tokens.colorNeutralForeground3,
  },
});

/** Returns color for HTTP method badge */
function methodColor(method: string): 'brand' | 'success' | 'warning' | 'danger' | 'informative' {
  switch (method.toUpperCase()) {
    case 'GET': return 'brand';
    case 'POST': return 'success';
    case 'PUT': return 'warning';
    case 'PATCH': return 'warning';
    case 'DELETE': return 'danger';
    default: return 'informative';
  }
}

export const DashboardPage: React.FC = () => {
  const classes = useStyles();
  const { data, isLoading, error } = useDashboard();

  if (isLoading) {
    // R2 - replaced Spinner with LoadingSkeleton mirroring the final
    // layout (4 KPI cards row + chart + endpoints grid + activity rows).
    // Same Phase G1 pattern D1 introduced for OverviewTab. Zero CLS
    // because the skeleton heights match the rendered cards.
    return (
      <div className={classes.page} data-testid="dashboard-loading">
        <div className={classes.kpiRow} aria-hidden>
          <LoadingSkeleton count={4} height="80px" />
        </div>
        <LoadingSkeleton count={1} height="160px" data-testid="dashboard-chart-skeleton" />
        <LoadingSkeleton count={3} height="120px" />
        <LoadingSkeleton count={5} height="36px" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={classes.errorBlock} data-testid="dashboard-error">
        <Text>Failed to load dashboard: {error?.message ?? 'Unknown error'}</Text>
      </div>
    );
  }

  // Phase D4 - chart series + headline current-hour value.
  const series = data.requestsLast24hSeries ?? [];
  const currentHourCount = series.length > 0 ? series[series.length - 1] : 0;
  const sumLast24h = series.reduce((a, b) => a + b, 0);

  return (
    <div className={classes.page} data-testid="dashboard-page">
      {/* KPI Cards */}
      <div className={classes.kpiRow} data-testid="kpi-row">
        <KpiCard
          icon={<Server24Regular />}
          label="Endpoints"
          value={data.stats.totalEndpoints}
        />
        <KpiCard
          icon={<People24Regular />}
          label="Total Users"
          value={data.stats.totalUsers}
        />
        <KpiCard
          icon={<PeopleTeam24Regular />}
          label="Total Groups"
          value={data.stats.totalGroups}
        />
        <KpiCard
          icon={<CheckmarkCircle24Regular />}
          label="Status"
          value={data.health.status === 'ok' ? 'Healthy' : 'Error'}
        />
      </div>

      {/* Phase D4 - 24h request volume chart */}
      <Card className={classes.chartCard} data-testid="dashboard-chart-card">
        <div className={classes.chartHeader}>
          <ChartMultiple24Regular />
          <div className={classes.chartHeaderText}>
            <Subtitle1>Requests (last 24h)</Subtitle1>
            <Caption1>
              {sumLast24h} total / {currentHourCount} this hour
            </Caption1>
          </div>
        </div>
        <div className={classes.chartArea}>
          <KpiChart
            data={series}
            label="Hourly request volume for the last 24 hours"
            colorScheme="accent"
            data-testid="dashboard-chart"
          />
        </div>
      </Card>

      {/* Phase L3 - Activity Analytics aggregations */}
      <ActivityAnalyticsSection />

      {/* Endpoint Cards */}
      <div className={classes.section}>
        <Subtitle1>Endpoints</Subtitle1>
        <div className={classes.endpointGrid} data-testid="endpoint-grid">
          {data.endpoints.map((ep) => (
            <EndpointCard key={ep.id} endpoint={ep} />
          ))}
          {data.endpoints.length === 0 && (
            // R3 - replaced plain Text with EmptyState. Phase G2 inventory.
            <EmptyState
              icon={<Server24Regular />}
              title="No endpoints configured"
              body="Create an endpoint to start provisioning users via SCIM."
              data-testid="dashboard-empty-endpoints"
            />
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className={classes.section}>
        <Subtitle1>Recent Activity</Subtitle1>
        {data.recentActivity.length === 0 ? (
          // R3 - replaced plain Text with EmptyState (matches the same
          // pattern used in OverviewTab for per-endpoint activity).
          <EmptyState
            icon={<History24Regular />}
            title="No recent activity"
            body="SCIM operations across your endpoints will appear here in real time."
            data-testid="dashboard-empty-activity"
          />
        ) : (
          <div className={classes.activityList} data-testid="activity-list">
            {data.recentActivity.slice(0, 10).map((activity) => (
              <div
                key={activity.id}
                className={`${classes.activityItem} ${activity.statusCode >= 400 ? classes.errorItem : ''}`}
              >
                <Badge
                  appearance="filled"
                  color={methodColor(activity.method)}
                  className={classes.methodBadge}
                >
                  {activity.method}
                </Badge>
                <Caption1 style={{ fontFamily: 'monospace', flex: 1 }}>
                  {activity.path}
                </Caption1>
                <Badge
                  appearance="outline"
                  color={activity.statusCode >= 400 ? 'danger' : 'success'}
                >
                  {activity.statusCode}
                </Badge>
                <Caption1>{activity.durationMs}ms</Caption1>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Sub-components ──────────────────────────────────────────────────

interface KpiCardProps {
  icon: React.ReactElement;
  label: string;
  value: string | number;
}

const KpiCard: React.FC<KpiCardProps> = ({ icon, label, value }) => {
  const classes = useStyles();
  return (
    <Card className={classes.kpiCard} data-testid={`kpi-${label.toLowerCase().replace(/\s+/g, '-')}`}>
      <div className={classes.kpiIcon}>{icon}</div>
      <div className={classes.kpiValues}>
        <Text size={600} weight="semibold">{value}</Text>
        <Caption1>{label}</Caption1>
      </div>
    </Card>
  );
};

interface EndpointCardProps {
  endpoint: DashboardEndpoint;
}

// ─── Phase L3: ActivityAnalyticsSection ──────────────────────────
//
// Renders the rolled-up counts from `/scim/admin/activity/summary`:
//   - 4 KPI tiles in the same kpiRow grid as the top of the page
//     (last 24h, last 7d, user ops 30d, group ops 30d)
//   - one ops-split horizontal bar showing users vs groups share
//
// In-memory backend returns a zeroed summary; section still renders
// (caption text explains the empty state).

const ActivityAnalyticsSection: React.FC = () => {
  const classes = useStyles();
  const { data, isLoading, isError } = useActivitySummary();

  if (isLoading) {
    return (
      <Card className={classes.analyticsCard} data-testid="dashboard-analytics-section">
        <LoadingSkeleton count={1} height="40px" />
        <LoadingSkeleton count={1} height="24px" />
      </Card>
    );
  }

  // On error, render nothing extra - the rest of the dashboard already
  // shows its own error block from useDashboard. Activity analytics is
  // a soft addition; missing data should not break the page.
  if (isError || !data) return null;

  const s = data.summary;
  const userOps = s.operations.users;
  const groupOps = s.operations.groups;
  const opsTotal = userOps + groupOps;
  const usersPct = opsTotal > 0 ? Math.round((userOps / opsTotal) * 100) : 0;
  const groupsPct = opsTotal > 0 ? 100 - usersPct : 0;

  return (
    <Card className={classes.analyticsCard} data-testid="dashboard-analytics-section">
      <div className={classes.analyticsHeader}>
        <DataPie24Regular />
        <Subtitle1>Activity analytics</Subtitle1>
      </div>

      <div className={classes.kpiRow}>
        <Card className={classes.kpiCard} data-testid="analytics-kpi-last24h">
          <div className={classes.kpiIcon}><History24Regular /></div>
          <div className={classes.kpiValues}>
            <Text size={600} weight="semibold">{s.last24Hours}</Text>
            <Caption1>Operations (24h)</Caption1>
          </div>
        </Card>
        <Card className={classes.kpiCard} data-testid="analytics-kpi-last7d">
          <div className={classes.kpiIcon}><History24Regular /></div>
          <div className={classes.kpiValues}>
            <Text size={600} weight="semibold">{s.lastWeek}</Text>
            <Caption1>Operations (7d)</Caption1>
          </div>
        </Card>
        <Card className={classes.kpiCard} data-testid="analytics-kpi-users-30d">
          <div className={classes.kpiIcon}><People24Regular /></div>
          <div className={classes.kpiValues}>
            <Text size={600} weight="semibold">{userOps}</Text>
            <Caption1>User ops (30d)</Caption1>
          </div>
        </Card>
        <Card className={classes.kpiCard} data-testid="analytics-kpi-groups-30d">
          <div className={classes.kpiIcon}><PeopleTeam24Regular /></div>
          <div className={classes.kpiValues}>
            <Text size={600} weight="semibold">{groupOps}</Text>
            <Caption1>Group ops (30d)</Caption1>
          </div>
        </Card>
      </div>

      <div data-testid="analytics-ops-split">
        <Caption1>Operations split (last 30 days)</Caption1>
        <div
          className={classes.opsSplitBar}
          role="img"
          aria-label={`Users ${usersPct}%, Groups ${groupsPct}%`}
        >
          <div
            className={classes.opsSplitUsers}
            style={{ width: `${usersPct}%` }}
            data-testid="analytics-ops-split-users"
          />
          <div
            className={classes.opsSplitGroups}
            style={{ width: `${groupsPct}%` }}
            data-testid="analytics-ops-split-groups"
          />
        </div>
        <div className={classes.opsSplitLegend}>
          <Caption1>Users {usersPct}% ({userOps})</Caption1>
          <Caption1>Groups {groupsPct}% ({groupOps})</Caption1>
        </div>
      </div>
    </Card>
  );
};

const EndpointCard: React.FC<EndpointCardProps> = ({ endpoint }) => {
  const classes = useStyles();
  const navigate = useNavigate();
  return (
    <Card
      className={classes.endpointCard}
      data-testid={`endpoint-card-${endpoint.id}`}
      onClick={() => navigate({ to: '/endpoints/$endpointId', params: { endpointId: endpoint.id } })}
    >
      <CardHeader
        header={
          <Text weight="semibold">{endpoint.displayName ?? endpoint.name}</Text>
        }
        description={
          <Caption1>{endpoint.name}</Caption1>
        }
        action={
          <Badge appearance="filled" color={endpoint.active ? 'success' : 'warning'}>
            {endpoint.active ? 'Active' : 'Inactive'}
          </Badge>
        }
      />
      <div className={classes.endpointStats}>
        <Body1>{endpoint.users.total} users</Body1>
        <Body1>{endpoint.groups.total} groups</Body1>
      </div>
    </Card>
  );
};

/**
 * DashboardPage - main dashboard with KPI cards, endpoint cards, recent activity.
 *
 * Reads from BFF /admin/dashboard endpoint (0 DB queries for stats via
 * StatsProjectionService). All data comes from TanStack Query cache.
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md Phase 2 Step 2.1
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Card,
  CardHeader,
  Text,
  Badge,
  Spinner,
  Subtitle1,
  Body1,
  Caption1,
} from '@fluentui/react-components';
import {
  People24Regular,
  PeopleTeam24Regular,
  Server24Regular,
  CheckmarkCircle24Regular,
} from '@fluentui/react-icons';
import { useDashboard } from '../api/queries';
import { useNavigate } from '@tanstack/react-router';
import type { DashboardResponse, DashboardEndpoint } from '@scim/types/dashboard.types';

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
  center: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '200px',
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
    return (
      <div className={classes.center} data-testid="dashboard-loading">
        <Spinner label="Loading dashboard..." />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={classes.center} data-testid="dashboard-error">
        <Text>Failed to load dashboard: {error?.message ?? 'Unknown error'}</Text>
      </div>
    );
  }

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

      {/* Endpoint Cards */}
      <div className={classes.section}>
        <Subtitle1>Endpoints</Subtitle1>
        <div className={classes.endpointGrid} data-testid="endpoint-grid">
          {data.endpoints.map((ep) => (
            <EndpointCard key={ep.id} endpoint={ep} />
          ))}
          {data.endpoints.length === 0 && (
            <Text>No endpoints configured.</Text>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className={classes.section}>
        <Subtitle1>Recent Activity</Subtitle1>
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
          {data.recentActivity.length === 0 && (
            <Text>No recent activity.</Text>
          )}
        </div>
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

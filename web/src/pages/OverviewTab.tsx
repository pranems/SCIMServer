/**
 * OverviewTab - per-endpoint overview surface (KPIs).
 *
 * Phase A2 (cutover): extracted from EndpointDetailPage so it can render
 * as the index child route of `/endpoints/$endpointId` via TanStack Router's
 * <Outlet /> mechanism instead of being switched in by component-local state.
 *
 * Phase B2: replaced two separate hooks (useEndpoint + useEndpointStats)
 * with a single useEndpointOverview that hits the BFF endpoint added in
 * Phase B1. One round trip, no waterfall, room to grow into the
 * Activity / Credentials sub-sections without adding more hooks.
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Card,
  Text,
  Spinner,
  Subtitle2,
  Caption1,
} from '@fluentui/react-components';
import {
  People24Regular,
  PeopleTeam24Regular,
  PeopleCommunity24Regular,
  Key24Regular,
} from '@fluentui/react-icons';
import { useEndpointOverview } from '../api/queries';

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
  center: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '200px',
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

  if (isLoading || !data) {
    return (
      <div className={classes.center} data-testid="tab-overview">
        <Spinner label="Loading overview..." />
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

  const { stats, credentials } = data;
  // Active credential count for the KPI card. The Credentials tab will
  // render the full list and detail (Phase E2).
  const activeCredentialCount = credentials.filter((c) => c.active).length;

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
      </div>
    </div>
  );
};

interface KpiCardProps {
  icon: React.ReactElement;
  label: string;
  value: number;
  subtitle?: string;
}

const KpiCard: React.FC<KpiCardProps> = ({ icon, label, value, subtitle }) => {
  const classes = useStyles();
  return (
    <Card className={classes.kpiCard}>
      <div className={classes.kpiIcon}>{icon}</div>
      <div className={classes.kpiValues}>
        <Text size={500} weight="semibold">{value}</Text>
        <Caption1>{label}</Caption1>
        {subtitle && <Caption1>{subtitle}</Caption1>}
      </div>
    </Card>
  );
};

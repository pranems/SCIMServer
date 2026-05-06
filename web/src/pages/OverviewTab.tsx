/**
 * OverviewTab - per-endpoint overview surface (KPIs).
 *
 * Phase A2 (cutover): extracted from EndpointDetailPage so it can render
 * as the index child route of `/endpoints/$endpointId` via TanStack Router's
 * <Outlet /> mechanism instead of being switched in by component-local state.
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
  DocumentText24Regular,
} from '@fluentui/react-icons';
import { useEndpointStats } from '../api/queries';

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
});

interface OverviewTabProps {
  endpointId: string;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({ endpointId }) => {
  const classes = useStyles();
  const { data: stats, isLoading } = useEndpointStats(endpointId);

  if (isLoading || !stats) {
    return (
      <div className={classes.center} data-testid="tab-overview">
        <Spinner label="Loading stats..." />
      </div>
    );
  }

  return (
    <div data-testid="tab-overview">
      <Subtitle2 style={{ marginBottom: '12px' }}>Resource Statistics</Subtitle2>
      <div className={classes.kpiRow}>
        <KpiCard icon={<People24Regular />} label="Users" value={stats.users.total} subtitle={`${stats.users.active} active`} />
        <KpiCard icon={<PeopleTeam24Regular />} label="Groups" value={stats.groups.total} subtitle={`${stats.groups.active} active`} />
        <KpiCard icon={<PeopleCommunity24Regular />} label="Members" value={stats.groupMembers.total} />
        <KpiCard icon={<DocumentText24Regular />} label="Requests" value={stats.requestLogs.total} />
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

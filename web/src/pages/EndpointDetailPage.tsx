/**
 * EndpointDetailPage - tabbed detail view for a single SCIM endpoint.
 *
 * Tabs: Overview | Users | Groups | Logs | Settings
 * Each tab is a separate content panel; data from TanStack Query.
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md Phase 2 Step 2.3
 */
import React, { useState } from 'react';
import {
  makeStyles,
  tokens,
  Card,
  Text,
  Badge,
  Spinner,
  Tab,
  TabList,
  Subtitle1,
  Subtitle2,
  Body1,
  Caption1,
} from '@fluentui/react-components';
import {
  People24Regular,
  PeopleTeam24Regular,
  PeopleCommunity24Regular,
  DocumentText24Regular,
} from '@fluentui/react-icons';
import { useEndpoint, useEndpointStats } from '../api/queries';
import type { EndpointStatsResponse } from '@scim/types/dashboard.types';
import { UsersTab } from './UsersTab';
import { GroupsTab } from './GroupsTab';
import { LogsTab } from './LogsTab';
import { SettingsTab } from './SettingsTab';

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    maxWidth: '1400px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  meta: {
    display: 'flex',
    gap: '16px',
    flexWrap: 'wrap',
    color: tokens.colorNeutralForeground3,
  },
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
  tabContent: {
    marginTop: '8px',
  },
  center: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '200px',
  },
  placeholder: {
    padding: '24px',
    textAlign: 'center' as const,
    color: tokens.colorNeutralForeground3,
  },
});

type TabValue = 'overview' | 'users' | 'groups' | 'logs' | 'settings';

interface EndpointDetailPageProps {
  endpointId: string;
}

export const EndpointDetailPage: React.FC<EndpointDetailPageProps> = ({ endpointId }) => {
  const classes = useStyles();
  const [activeTab, setActiveTab] = useState<TabValue>('overview');

  const { data: endpoint, isLoading: loadingEndpoint, error: endpointError } = useEndpoint(endpointId);
  const { data: stats, isLoading: loadingStats } = useEndpointStats(endpointId);

  if (loadingEndpoint) {
    return (
      <div className={classes.center} data-testid="endpoint-detail-loading">
        <Spinner label="Loading endpoint..." />
      </div>
    );
  }

  if (endpointError || !endpoint) {
    return (
      <div className={classes.center} data-testid="endpoint-detail-error">
        <Text>Failed to load endpoint: {endpointError?.message ?? 'Not found'}</Text>
      </div>
    );
  }

  return (
    <div className={classes.page} data-testid="endpoint-detail-page">
      {/* Header: Name + Status */}
      <div className={classes.header}>
        <Subtitle1>{endpoint.displayName ?? endpoint.name}</Subtitle1>
        <Badge
          appearance="filled"
          color={endpoint.active ? 'success' : 'warning'}
        >
          {endpoint.active ? 'Active' : 'Inactive'}
        </Badge>
      </div>

      {/* Metadata row */}
      <div className={classes.meta}>
        <Caption1>ID: {endpoint.id}</Caption1>
        <Caption1>SCIM: {endpoint.scimBasePath}</Caption1>
        <Caption1>Created: {new Date(endpoint.createdAt).toLocaleDateString()}</Caption1>
      </div>

      {/* Tab bar */}
      <TabList
        selectedValue={activeTab}
        onTabSelect={(_, d) => setActiveTab(d.value as TabValue)}
      >
        <Tab value="overview">Overview</Tab>
        <Tab value="users">Users</Tab>
        <Tab value="groups">Groups</Tab>
        <Tab value="logs">Logs</Tab>
        <Tab value="settings">Settings</Tab>
      </TabList>

      {/* Tab content */}
      <div className={classes.tabContent}>
        {activeTab === 'overview' && (
          <OverviewTab stats={stats} loading={loadingStats} />
        )}
        {activeTab === 'users' && (
          <div data-testid="tab-users"><UsersTab endpointId={endpointId} /></div>
        )}
        {activeTab === 'groups' && (
          <div data-testid="tab-groups"><GroupsTab endpointId={endpointId} /></div>
        )}
        {activeTab === 'logs' && (
          <div data-testid="tab-logs"><LogsTab endpointId={endpointId} /></div>
        )}
        {activeTab === 'settings' && (
          <div data-testid="tab-settings"><SettingsTab endpointId={endpointId} /></div>
        )}
      </div>
    </div>
  );
};

// ─── Overview tab ────────────────────────────────────────────────────

interface OverviewTabProps {
  stats?: EndpointStatsResponse;
  loading: boolean;
}

const OverviewTab: React.FC<OverviewTabProps> = ({ stats, loading }) => {
  const classes = useStyles();

  if (loading || !stats) {
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

// ─── Shared sub-components ───────────────────────────────────────────

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

interface PlaceholderTabProps {
  name: string;
  testId: string;
}

const PlaceholderTab: React.FC<PlaceholderTabProps> = ({ name, testId }) => {
  const classes = useStyles();
  return (
    <div className={classes.placeholder} data-testid={testId}>
      <Body1>{name} tab - coming in Phase 2.4+</Body1>
    </div>
  );
};

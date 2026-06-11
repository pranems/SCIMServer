/**
 * EndpointDetailPage - tabbed detail layout for a single SCIM endpoint.
 *
 * Tabs: Overview | Users | Groups | Logs | Settings
 *
 * Phase A2 (cutover): this component is now a pure LAYOUT. The active tab
 * is read from the URL via TanStack Router (useRouterState) and the tab
 * content is rendered through <Outlet /> from the nested route tree:
 *
 *   /endpoints/$endpointId/         -> OverviewTab  (index route)
 *   /endpoints/$endpointId/users    -> UsersTab
 *   /endpoints/$endpointId/groups   -> GroupsTab
 *   /endpoints/$endpointId/logs     -> LogsTab
 *   /endpoints/$endpointId/settings -> SettingsTab
 *
 * Tab clicks call useNavigate() to push the new URL; the back button uses
 * <Link to="/endpoints">. The legacy useState<TabValue> + Zustand navigate
 * have been removed.
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md Phase 2 Step 2.3
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase A2
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Button,
  Tab,
  TabList,
  Subtitle1,
  Caption1,
} from '@fluentui/react-components';
import { Edit24Regular, Delete24Regular } from '@fluentui/react-icons';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEndpoint } from '../api/queries';
import { CopyableField, LoadingSkeleton } from '../components/primitives';
import { DeleteEndpointDialog } from '../components/endpoint/DeleteEndpointDialog';

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
  scimRow: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: 0,
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
});

type TabValue = 'overview' | 'users' | 'groups' | 'logs' | 'settings' | 'activity' | 'schemas' | 'credentials' | 'bulk' | 'resource-types';

interface EndpointDetailPageProps {
  endpointId: string;
}

/** Derive the active tab from the current pathname. */
function pathToTab(pathname: string, endpointId: string): TabValue {
  const base = `/endpoints/${endpointId}`;
  if (pathname === base || pathname === `${base}/`) return 'overview';
  if (pathname.startsWith(`${base}/users`)) return 'users';
  if (pathname.startsWith(`${base}/groups`)) return 'groups';
  if (pathname.startsWith(`${base}/activity`)) return 'activity';
  if (pathname.startsWith(`${base}/bulk`)) return 'bulk';
  if (pathname.startsWith(`${base}/resource-types`)) return 'resource-types';
  if (pathname.startsWith(`${base}/schemas`)) return 'schemas';
  if (pathname.startsWith(`${base}/credentials`)) return 'credentials';
  if (pathname.startsWith(`${base}/logs`)) return 'logs';
  if (pathname.startsWith(`${base}/settings`)) return 'settings';
  return 'overview';
}

export const EndpointDetailPage: React.FC<EndpointDetailPageProps> = ({ endpointId }) => {
  const classes = useStyles();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeTab = pathToTab(pathname, endpointId);

  const { data: endpoint, isLoading: loadingEndpoint, error: endpointError } = useEndpoint(endpointId);
  // Phase L1 - delete confirmation modal mounted in the header.
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  if (loadingEndpoint) {
    // G1 - skeleton mirrors header (title row) + tablist row + an
    // initial content block so the page does not jump on data arrival.
    return (
      <div className={classes.page} data-testid="endpoint-detail-loading">
        <LoadingSkeleton count={1} height="40px" data-testid="endpoint-detail-skeleton-header" />
        <LoadingSkeleton count={1} height="36px" data-testid="endpoint-detail-skeleton-tabs" />
        <LoadingSkeleton count={5} height="32px" data-testid="endpoint-detail-skeleton-content" />
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

  const handleTabSelect = (next: TabValue): void => {
    if (next === 'overview') {
      navigate({ to: '/endpoints/$endpointId', params: { endpointId } });
      return;
    }
    if (next === 'users') {
      navigate({ to: '/endpoints/$endpointId/users', params: { endpointId } });
      return;
    }
    if (next === 'groups') {
      navigate({ to: '/endpoints/$endpointId/groups', params: { endpointId } });
      return;
    }
    if (next === 'activity') {
      navigate({ to: '/endpoints/$endpointId/activity', params: { endpointId } });
      return;
    }
    if (next === 'bulk') {
      navigate({ to: '/endpoints/$endpointId/bulk', params: { endpointId } });
      return;
    }
    if (next === 'resource-types') {
      navigate({ to: '/endpoints/$endpointId/resource-types', params: { endpointId } });
      return;
    }
    if (next === 'schemas') {
      navigate({ to: '/endpoints/$endpointId/schemas', params: { endpointId } });
      return;
    }
    if (next === 'credentials') {
      navigate({ to: '/endpoints/$endpointId/credentials', params: { endpointId } });
      return;
    }
    if (next === 'logs') {
      navigate({ to: '/endpoints/$endpointId/logs', params: { endpointId } });
      return;
    }
    if (next === 'settings') {
      navigate({ to: '/endpoints/$endpointId/settings', params: { endpointId } });
    }
  };

  return (
    <div className={classes.page} data-testid="endpoint-detail-page">
      {/* Back button - real <Link> so middle-click / right-click work */}
      <Link
        to="/endpoints"
        style={{ alignSelf: 'flex-start', marginBottom: '8px', textDecoration: 'none' }}
        data-testid="back-to-endpoints"
      >
        <Button appearance="subtle">← Back to Endpoints</Button>
      </Link>

      {/* Header: Name + Status */}
      <div className={classes.header}>
        <Subtitle1>{endpoint.displayName ?? endpoint.name}</Subtitle1>
        <Badge
          appearance="filled"
          color={endpoint.active ? 'success' : 'warning'}
        >
          {endpoint.active ? 'Active' : 'Inactive'}
        </Badge>
        {/* Phase L1 - Edit + Delete buttons sit at the right edge of the header. */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <Button
            appearance="subtle"
            icon={<Edit24Regular />}
            data-testid="endpoint-edit-button"
            onClick={() =>
              navigate({ to: '/endpoints/$endpointId/edit', params: { endpointId } })
            }
          >
            Edit
          </Button>
          <Button
            appearance="subtle"
            icon={<Delete24Regular />}
            data-testid="endpoint-delete-button"
            onClick={() => setDeleteOpen(true)}
          >
            Delete
          </Button>
        </div>
      </div>

      <DeleteEndpointDialog
        open={deleteOpen}
        endpointId={endpoint.id}
        endpointName={endpoint.name}
        onCancel={() => setDeleteOpen(false)}
        onConfirmed={() => {
          setDeleteOpen(false);
          void navigate({ to: '/endpoints' });
        }}
      />

      {/* Metadata row */}
      <div className={classes.meta}>
        <Caption1>ID: {endpoint.id}</Caption1>
        <span className={classes.scimRow}>
          <Caption1>SCIM:</Caption1>
          <CopyableField
            value={endpoint.scimBasePath}
            monospace
            truncate
            maxWidth="480px"
            data-testid="endpoint-scim-base-path"
          />
        </span>
        <Caption1>Created: {new Date(endpoint.createdAt).toLocaleDateString()}</Caption1>
      </div>

      {/* Tab bar - selectedValue comes from URL */}
      <TabList
        selectedValue={activeTab}
        onTabSelect={(_, d) => handleTabSelect(d.value as TabValue)}
      >
        <Tab value="overview">Overview</Tab>
        <Tab value="users">Users</Tab>
        <Tab value="groups">Groups</Tab>
        <Tab value="activity">Activity</Tab>
        <Tab value="bulk">Bulk</Tab>
        <Tab value="resource-types">Resource types</Tab>
        <Tab value="schemas">Schemas</Tab>
        <Tab value="credentials">Credentials</Tab>
        <Tab value="logs">Logs</Tab>
        <Tab value="settings">Settings</Tab>
      </TabList>

      {/* Tab content - rendered by the matched child route via <Outlet /> */}
      <div className={classes.tabContent}>
        <Outlet />
      </div>
    </div>
  );
};

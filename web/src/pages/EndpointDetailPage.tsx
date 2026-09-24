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
 * Tab clicks call useNavigate() to push the new URL. Back uses in-app router
 * history so list filters and prior route state are restored; a direct deep
 * link falls back to /endpoints.
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
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEndpoint } from '../api/queries';
import { endpointSupportsResourceType } from '../api/endpoint-capabilities';
import { ContextBackButton, CopyableField, LoadingSkeleton } from '../components/primitives';
import { DeleteEndpointDialog } from '../components/endpoint/DeleteEndpointDialog';

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    maxWidth: '1400px',
    width: '100%',
    minWidth: 0,
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
    minWidth: 0,
  },
  tabList: {
    maxWidth: '100%',
    overflowX: 'auto',
    overflowY: 'hidden',
  },
  center: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '200px',
  },
});

type StaticTabValue = 'overview' | 'users' | 'groups' | 'logs' | 'settings' | 'activity' | 'schemas' | 'credentials' | 'connect' | 'bulk' | 'resource-types' | 'service-provider-config';
type TabValue = StaticTabValue | `resource:${string}`;

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
  if (pathname.startsWith(`${base}/service-provider-config`)) return 'service-provider-config';
  if (pathname.startsWith(`${base}/resources/`)) {
    const resourceTypeId = pathname.slice(`${base}/resources/`.length).split('/')[0];
    return `resource:${decodeURIComponent(resourceTypeId ?? '')}`;
  }
  if (pathname.startsWith(`${base}/schemas`)) return 'schemas';
  if (pathname.startsWith(`${base}/credentials`)) return 'connect';
  if (pathname.startsWith(`${base}/connect`)) return 'connect';
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

  const supportsUsers = endpointSupportsResourceType(endpoint?.profile, {
    name: 'User',
    endpointPath: '/Users',
  });
  const supportsGroups = endpointSupportsResourceType(endpoint?.profile, {
    name: 'Group',
    endpointPath: '/Groups',
  });
  const declaredResourceTypes = (
    endpoint?.profile as { resourceTypes?: Array<{ id?: string; name?: string; endpoint?: string }> } | undefined
  )?.resourceTypes ?? [];
  const customResourceTypes = declaredResourceTypes.filter((resourceType) =>
    resourceType.name !== 'User' && resourceType.name !== 'Group' &&
    resourceType.id && resourceType.name && resourceType.endpoint);

  React.useEffect(() => {
    if (!endpoint) return;
    const selectedCustomId = activeTab.startsWith('resource:')
      ? activeTab.slice('resource:'.length)
      : undefined;
    const selectedTypeRemoved = selectedCustomId !== undefined
      && !customResourceTypes.some((resourceType) => resourceType.id === selectedCustomId);
    if ((activeTab === 'users' && !supportsUsers)
      || (activeTab === 'groups' && !supportsGroups)
      || selectedTypeRemoved) {
      void navigate({
        to: '/endpoints/$endpointId/resource-types',
        params: { endpointId },
        replace: true,
      });
    }
  }, [activeTab, customResourceTypes, endpoint, endpointId, navigate, supportsGroups, supportsUsers]);

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

  // Profile-enforcement (v0.53.3): the SCIM CRUD layer 404s a resource
  // type the endpoint profile does not declare. Hide the matching tab so
  // the operator never navigates into a tab that would fatally error.
  // Fail-open mirrors the server resolver - absent/empty resourceTypes
  // means "serves everything", so legacy endpoints show all tabs.
  const handleTabSelect = (next: TabValue): void => {
    if (next.startsWith('resource:')) {
      navigate({
        to: '/endpoints/$endpointId/resources/$resourceTypeId',
        params: { endpointId, resourceTypeId: next.slice('resource:'.length) },
      });
      return;
    }
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
    if (next === 'service-provider-config') {
      navigate({ to: '/endpoints/$endpointId/service-provider-config', params: { endpointId } });
      return;
    }
    if (next === 'schemas') {
      navigate({ to: '/endpoints/$endpointId/schemas', params: { endpointId } });
      return;
    }
    if (next === 'connect') {
      navigate({ to: '/endpoints/$endpointId/connect', params: { endpointId } });
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
      <div style={{ alignSelf: 'flex-start', marginBottom: '8px' }}>
        <ContextBackButton
          onFallback={() => { void navigate({ to: '/endpoints' }); }}
          data-testid="back-to-endpoints"
        />
      </div>

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
        className={classes.tabList}
        data-testid="endpoint-detail-tabs"
        selectedValue={activeTab}
        onTabSelect={(_, d) => handleTabSelect(d.value as TabValue)}
      >
        <Tab value="overview">Overview</Tab>
        {supportsUsers && <Tab value="users" data-testid="endpoint-tab-users">Users</Tab>}
        {supportsGroups && <Tab value="groups" data-testid="endpoint-tab-groups">Groups</Tab>}
        {customResourceTypes.map((resourceType) => (
          <Tab
            key={resourceType.id}
            value={`resource:${resourceType.id}`}
            data-testid={`endpoint-tab-resource-${resourceType.id}`}
          >
            {resourceType.name}
          </Tab>
        ))}
        <Tab value="activity">Activity</Tab>
        <Tab value="bulk">Bulk</Tab>
        <Tab value="resource-types">Resource types</Tab>
        <Tab value="service-provider-config">Service Provider Config</Tab>
        <Tab value="schemas">Schemas</Tab>
        <Tab value="connect" data-testid="endpoint-tab-connect">Connect</Tab>
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

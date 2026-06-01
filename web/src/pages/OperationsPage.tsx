/**
 * OperationsPage (Phase L6) - cross-endpoint operator view.
 *
 * Restores the legacy "Database Browser" tab as a top-level
 * `/operations` route. Per
 * [docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md](../../docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md)
 * S4.9, the redesigned UI never restored it; operators couldn't see
 * "all users across all endpoints" without curl + database access.
 *
 * Three sub-tabs:
 *   - All Users      - paginated cross-endpoint user table with
 *                       per-row endpoint Badge that deep-links into
 *                       that endpoint's UsersTab pre-filtered by the
 *                       user's userName
 *   - All Groups     - same pattern for groups
 *   - Statistics     - 4 KPI tiles (users total/active/inactive,
 *                       groups total) + 24h request count + database
 *                       backend identification
 *
 * Each list has a Search box + Download CSV button. The CSV button
 * exports ONLY the visible (filtered) page so the operator can pipe
 * "the rows I'm currently looking at" into a spreadsheet without
 * having to wonder about scope.
 *
 * @see docs/PHASE_L6_OPERATIONS_VIEW.md
 * @see web/src/utils/csv-export.ts (the serializer)
 */
import React, { useMemo, useState } from 'react';
import {
  makeStyles,
  tokens,
  Card,
  Subtitle1,
  Subtitle2,
  Caption1,
  Text,
  Badge,
  Button,
  TabList,
  Tab,
  SearchBox,
  Switch,
} from '@fluentui/react-components';
import {
  DataUsage24Regular,
  ArrowDownload24Regular,
  People24Regular,
  Group24Regular,
  Pulse24Regular,
} from '@fluentui/react-icons';
import { useNavigate } from '@tanstack/react-router';
import {
  useDatabaseUsers,
  useDatabaseGroups,
  useDatabaseStatistics,
  type DatabaseUserRow,
  type DatabaseGroupRow,
} from '../api/queries';
import { EmptyState, LoadingSkeleton, CopyableField } from '../components/primitives';
import { ScimErrorMessage } from '../components/primitives/ScimErrorMessage';
import { toCsv, triggerCsvDownload } from '../utils/csv-export';

type OperationsTabKey = 'users' | 'groups' | 'statistics';

const PAGE_SIZE = 50;

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '24px',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
  },
  toolbarGrow: {
    flex: 1,
    minWidth: '200px',
  },
  rowTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: tokens.fontSizeBase300,
  },
  rowHeader: {
    textAlign: 'left',
    padding: '8px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    color: tokens.colorNeutralForeground3,
    fontWeight: 600,
  },
  rowCell: {
    padding: '8px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke3}`,
  },
  endpointBadgeLink: {
    textDecoration: 'none',
  },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '12px',
  },
  kpiCard: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  kpiValue: {
    fontSize: tokens.fontSizeHero700,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorBrandForeground1,
  },
  kpiLabel: {
    color: tokens.colorNeutralForeground3,
  },
  pagination: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: '12px',
    color: tokens.colorNeutralForeground3,
  },
});

// ─── Component ───────────────────────────────────────────────────────

export const OperationsPage: React.FC = () => {
  const classes = useStyles();
  const [activeTab, setActiveTab] = useState<OperationsTabKey>('users');

  // Per-tab params (independent so switching tabs doesn't reset filters).
  const [userSearch, setUserSearch] = useState('');
  const [userActiveOnly, setUserActiveOnly] = useState(false);
  const [userPage, setUserPage] = useState(1);

  const [groupSearch, setGroupSearch] = useState('');
  const [groupPage, setGroupPage] = useState(1);

  const users = useDatabaseUsers({
    page: userPage,
    limit: PAGE_SIZE,
    search: userSearch || undefined,
    active: userActiveOnly ? true : undefined,
  });

  const groups = useDatabaseGroups({
    page: groupPage,
    limit: PAGE_SIZE,
    search: groupSearch || undefined,
  });

  const stats = useDatabaseStatistics();

  return (
    <div className={classes.page} data-testid="operations-page">
      <Subtitle1>Operations</Subtitle1>
      <Caption1>
        Cross-endpoint operator view of users and groups across every endpoint registered on
        this server. Click an endpoint badge on a row to jump to that endpoint`s tab pre-filtered
        by the user or group. Use Download CSV to export the currently visible page.
      </Caption1>

      <TabList
        selectedValue={activeTab}
        onTabSelect={(_e, d) => setActiveTab(d.value as OperationsTabKey)}
        data-testid="operations-subtabs"
      >
        <Tab value="users" data-testid="operations-tab-users" icon={<People24Regular />}>
          All Users
        </Tab>
        <Tab value="groups" data-testid="operations-tab-groups" icon={<Group24Regular />}>
          All Groups
        </Tab>
        <Tab value="statistics" data-testid="operations-tab-statistics" icon={<DataUsage24Regular />}>
          Statistics
        </Tab>
      </TabList>

      {activeTab === 'users' && (
        <UsersSection
          data={users.data}
          isLoading={users.isLoading}
          error={users.error}
          search={userSearch}
          activeOnly={userActiveOnly}
          page={userPage}
          onSearch={(v) => {
            setUserSearch(v);
            setUserPage(1);
          }}
          onActiveOnly={(v) => {
            setUserActiveOnly(v);
            setUserPage(1);
          }}
          onPage={setUserPage}
        />
      )}

      {activeTab === 'groups' && (
        <GroupsSection
          data={groups.data}
          isLoading={groups.isLoading}
          error={groups.error}
          search={groupSearch}
          page={groupPage}
          onSearch={(v) => {
            setGroupSearch(v);
            setGroupPage(1);
          }}
          onPage={setGroupPage}
        />
      )}

      {activeTab === 'statistics' && (
        <StatsSection
          data={stats.data}
          isLoading={stats.isLoading}
          error={stats.error}
        />
      )}
    </div>
  );
};

// ─── Users sub-tab ───────────────────────────────────────────────────

const USER_CSV_COLUMNS = [
  'id',
  'userName',
  'externalId',
  'active',
  'endpointId',
  'createdAt',
  'updatedAt',
];

const UsersSection: React.FC<{
  data:
    | {
        users: DatabaseUserRow[];
        pagination: { page: number; limit: number; total: number; pages: number };
      }
    | undefined;
  isLoading: boolean;
  error: unknown;
  search: string;
  activeOnly: boolean;
  page: number;
  onSearch: (v: string) => void;
  onActiveOnly: (v: boolean) => void;
  onPage: (p: number) => void;
}> = ({ data, isLoading, error, search, activeOnly, page, onSearch, onActiveOnly, onPage }) => {
  const classes = useStyles();

  const rows = data?.users ?? [];
  const pagination = data?.pagination;

  const handleDownload = (): void => {
    const csv = toCsv(
      rows as ReadonlyArray<Record<string, unknown>>,
      { columns: USER_CSV_COLUMNS },
    );
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    triggerCsvDownload(`operations-users-${ts}.csv`, csv);
  };

  return (
    <div>
      <div className={classes.toolbar}>
        <div className={classes.toolbarGrow}>
          <SearchBox
            placeholder="Search by userName / externalId / scimId"
            value={search}
            onChange={(_e, d) => onSearch(d.value ?? '')}
            data-testid="operations-users-search"
          />
        </div>
        <Switch
          label="Active only"
          checked={activeOnly}
          onChange={(_e, d) => onActiveOnly(d.checked)}
          data-testid="operations-users-active-only"
        />
        <Button
          appearance="secondary"
          icon={<ArrowDownload24Regular />}
          onClick={handleDownload}
          disabled={rows.length === 0}
          data-testid="operations-users-download-csv"
        >
          Download CSV
        </Button>
      </div>

      {isLoading && <LoadingSkeleton count={8} height="36px" />}
      {error != null && <ScimErrorMessage error={error} />}
      {!isLoading && !error && rows.length === 0 && (
        <EmptyState
          icon={<People24Regular />}
          title="No users"
          body={
            search || activeOnly
              ? 'No users match the current filter. Clear the filter to see all users.'
              : 'No users on any endpoint yet. Provision one in Manual Provision or via SCIM.'
          }
          data-testid="operations-users-empty"
        />
      )}
      {!isLoading && !error && rows.length > 0 && (
        <Card style={{ padding: 0 }}>
          <table className={classes.rowTable}>
            <thead>
              <tr>
                <th className={classes.rowHeader}>userName</th>
                <th className={classes.rowHeader}>active</th>
                <th className={classes.rowHeader}>endpoint</th>
                <th className={classes.rowHeader}>created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} data-testid={`operations-user-row-${u.id}`}>
                  <td className={classes.rowCell}>
                    <Text weight="semibold">{u.userName ?? '-'}</Text>
                    <br />
                    <CopyableField
                      value={u.id}
                      monospace
                      truncate
                      maxWidth="260px"
                      data-testid={`operations-user-row-${u.id}-id`}
                      ariaLabel={`Copy user id ${u.id}`}
                    />
                  </td>
                  <td className={classes.rowCell}>
                    {u.active === true ? (
                      <Badge appearance="filled" color="success" size="small">active</Badge>
                    ) : (
                      <Badge appearance="filled" color="subtle" size="small">inactive</Badge>
                    )}
                  </td>
                  <td className={classes.rowCell}>
                    {u.endpointId ? (
                      <EndpointBadgeLink
                        endpointId={u.endpointId}
                        section="users"
                        testId={`operations-user-row-${u.id}-endpoint-${u.endpointId}`}
                      />
                    ) : (
                      <Caption1>-</Caption1>
                    )}
                  </td>
                  <td className={classes.rowCell}>
                    <Caption1>{u.createdAt ?? '-'}</Caption1>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pagination && pagination.pages > 1 && (
            <div className={classes.pagination}>
              <Caption1>
                Page {pagination.page} of {pagination.pages} ({pagination.total} total)
              </Caption1>
              <div style={{ display: 'flex', gap: '4px' }}>
                <Button
                  appearance="subtle"
                  disabled={page <= 1}
                  onClick={() => onPage(page - 1)}
                  data-testid="operations-users-prev"
                >
                  Prev
                </Button>
                <Button
                  appearance="subtle"
                  disabled={page >= pagination.pages}
                  onClick={() => onPage(page + 1)}
                  data-testid="operations-users-next"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

// ─── Groups sub-tab ──────────────────────────────────────────────────

const GROUP_CSV_COLUMNS = [
  'id',
  'displayName',
  'memberCount',
  'endpointId',
  'createdAt',
  'updatedAt',
];

const GroupsSection: React.FC<{
  data:
    | {
        groups: DatabaseGroupRow[];
        pagination: { page: number; limit: number; total: number; pages: number };
      }
    | undefined;
  isLoading: boolean;
  error: unknown;
  search: string;
  page: number;
  onSearch: (v: string) => void;
  onPage: (p: number) => void;
}> = ({ data, isLoading, error, search, page, onSearch, onPage }) => {
  const classes = useStyles();
  const rows = data?.groups ?? [];
  const pagination = data?.pagination;

  const handleDownload = (): void => {
    const csv = toCsv(
      rows as ReadonlyArray<Record<string, unknown>>,
      { columns: GROUP_CSV_COLUMNS },
    );
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    triggerCsvDownload(`operations-groups-${ts}.csv`, csv);
  };

  return (
    <div>
      <div className={classes.toolbar}>
        <div className={classes.toolbarGrow}>
          <SearchBox
            placeholder="Search by displayName"
            value={search}
            onChange={(_e, d) => onSearch(d.value ?? '')}
            data-testid="operations-groups-search"
          />
        </div>
        <Button
          appearance="secondary"
          icon={<ArrowDownload24Regular />}
          onClick={handleDownload}
          disabled={rows.length === 0}
          data-testid="operations-groups-download-csv"
        >
          Download CSV
        </Button>
      </div>

      {isLoading && <LoadingSkeleton count={8} height="36px" />}
      {error != null && <ScimErrorMessage error={error} />}
      {!isLoading && !error && rows.length === 0 && (
        <EmptyState
          icon={<Group24Regular />}
          title="No groups"
          body={
            search
              ? 'No groups match the current search. Clear it to see all groups.'
              : 'No groups on any endpoint yet.'
          }
          data-testid="operations-groups-empty"
        />
      )}
      {!isLoading && !error && rows.length > 0 && (
        <Card style={{ padding: 0 }}>
          <table className={classes.rowTable}>
            <thead>
              <tr>
                <th className={classes.rowHeader}>displayName</th>
                <th className={classes.rowHeader}>members</th>
                <th className={classes.rowHeader}>endpoint</th>
                <th className={classes.rowHeader}>created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id} data-testid={`operations-group-row-${g.id}`}>
                  <td className={classes.rowCell}>
                    <Text weight="semibold">{g.displayName ?? '-'}</Text>
                    <br />
                    <CopyableField
                      value={g.id}
                      monospace
                      truncate
                      maxWidth="260px"
                      data-testid={`operations-group-row-${g.id}-id`}
                      ariaLabel={`Copy group id ${g.id}`}
                    />
                  </td>
                  <td className={classes.rowCell}>
                    <Badge appearance="outline" size="small">
                      {g.memberCount ?? 0}
                    </Badge>
                  </td>
                  <td className={classes.rowCell}>
                    {g.endpointId ? (
                      <EndpointBadgeLink
                        endpointId={g.endpointId}
                        section="groups"
                        testId={`operations-group-row-${g.id}-endpoint-${g.endpointId}`}
                      />
                    ) : (
                      <Caption1>-</Caption1>
                    )}
                  </td>
                  <td className={classes.rowCell}>
                    <Caption1>{g.createdAt ?? '-'}</Caption1>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pagination && pagination.pages > 1 && (
            <div className={classes.pagination}>
              <Caption1>
                Page {pagination.page} of {pagination.pages} ({pagination.total} total)
              </Caption1>
              <div style={{ display: 'flex', gap: '4px' }}>
                <Button
                  appearance="subtle"
                  disabled={page <= 1}
                  onClick={() => onPage(page - 1)}
                  data-testid="operations-groups-prev"
                >
                  Prev
                </Button>
                <Button
                  appearance="subtle"
                  disabled={page >= pagination.pages}
                  onClick={() => onPage(page + 1)}
                  data-testid="operations-groups-next"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
};

// ─── EndpointBadgeLink ───────────────────────────────────────────────
//
// Plain-anchor implementation of "click this badge to jump to the
// per-endpoint Users/Groups tab pre-filtered". Uses useNavigate()
// to drive SPA navigation on click; preserves href for keyboard /
// right-click / middle-click semantics. Plain anchor instead of
// TanStack Router's <Link> so the page can be unit-tested without
// requiring the full nested route tree mounted in the test router.

const EndpointBadgeLink: React.FC<{
  endpointId: string;
  section: 'users' | 'groups';
  testId: string;
}> = ({ endpointId, section, testId }) => {
  const navigate = useNavigate();
  const href = `/endpoints/${endpointId}/${section}`;
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>): void => {
    // Honour modifier keys + middle/right click (let the browser
    // handle them).
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    navigate({ to: href });
  };
  return (
    <a
      href={href}
      onClick={handleClick}
      data-testid={testId}
      style={{ textDecoration: 'none' }}
    >
      <Badge appearance="outline" size="small">
        {endpointId.slice(0, 8)}
      </Badge>
    </a>
  );
};

// ─── Statistics sub-tab ──────────────────────────────────────────────

const StatsSection: React.FC<{
  data:
    | {
        users: { total: number; active: number; inactive: number };
        groups: { total: number };
        activity: { totalRequests: number; last24Hours: number };
        database: { type: string; persistenceBackend: 'prisma' | 'inmemory' };
      }
    | undefined;
  isLoading: boolean;
  error: unknown;
}> = ({ data, isLoading, error }) => {
  const classes = useStyles();

  const csvText = useMemo(() => {
    if (!data) return '';
    return toCsv(
      [
        {
          metric: 'users.total',
          value: data.users.total,
        },
        { metric: 'users.active', value: data.users.active },
        { metric: 'users.inactive', value: data.users.inactive },
        { metric: 'groups.total', value: data.groups.total },
        { metric: 'activity.totalRequests', value: data.activity.totalRequests },
        { metric: 'activity.last24Hours', value: data.activity.last24Hours },
        { metric: 'database.type', value: data.database.type },
        { metric: 'database.persistenceBackend', value: data.database.persistenceBackend },
      ],
      { columns: ['metric', 'value'] },
    );
  }, [data]);

  if (isLoading) return <LoadingSkeleton count={4} height="100px" />;
  if (error != null) return <ScimErrorMessage error={error} />;
  if (!data) return null;

  return (
    <div>
      <div className={classes.kpiGrid}>
        <Card className={classes.kpiCard}>
          <Caption1 className={classes.kpiLabel}>Users (total)</Caption1>
          <Text className={classes.kpiValue} data-testid="operations-stat-users-total">
            {data.users.total}
          </Text>
        </Card>
        <Card className={classes.kpiCard}>
          <Caption1 className={classes.kpiLabel}>Users (active)</Caption1>
          <Text className={classes.kpiValue} data-testid="operations-stat-users-active">
            {data.users.active}
          </Text>
        </Card>
        <Card className={classes.kpiCard}>
          <Caption1 className={classes.kpiLabel}>Groups (total)</Caption1>
          <Text className={classes.kpiValue} data-testid="operations-stat-groups-total">
            {data.groups.total}
          </Text>
        </Card>
        <Card className={classes.kpiCard}>
          <Caption1 className={classes.kpiLabel}>Requests (last 24h)</Caption1>
          <Text className={classes.kpiValue} data-testid="operations-stat-requests-24h">
            {data.activity.last24Hours}
          </Text>
        </Card>
      </div>

      <div style={{ marginTop: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Pulse24Regular />
        <Subtitle2>Database</Subtitle2>
        <Caption1 style={{ fontFamily: tokens.fontFamilyMonospace }}>
          {data.database.type} ({data.database.persistenceBackend})
        </Caption1>
        <Caption1>Total requests: {data.activity.totalRequests}</Caption1>
      </div>

      <div style={{ marginTop: '16px' }}>
        <Button
          appearance="secondary"
          icon={<ArrowDownload24Regular />}
          onClick={() => {
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            triggerCsvDownload(`operations-statistics-${ts}.csv`, csvText);
          }}
          data-testid="operations-stats-download-csv"
        >
          Download CSV
        </Button>
      </div>
    </div>
  );
};

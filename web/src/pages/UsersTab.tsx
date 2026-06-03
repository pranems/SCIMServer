/**
 * UsersTab - SCIM user list table for an endpoint.
 *
 * Phase A3 (per-page migration): pagination state lives in the URL via
 * TanStack Router's `useSearch` + `useNavigate`. The previous
 * `useState(startIndex)` has been removed; the URL
 * `?page=N&pageSize=N` is now the single source of truth, parsed by
 * usersSearchSchema (`web/src/routes/search-schemas.ts`).
 *
 * Phase G1: loading state migrated from Spinner to LoadingSkeleton
 * (table-row shaped; 8 rows above the fold).
 * Phase G2: empty state migrated from plain Text to EmptyState.
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md Phase 2 Step 2.4
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase A3 + S10 G1/G2
 */
import React from 'react';
import {
  makeStyles,
  mergeClasses,
  tokens,
  Text,
  Badge,
  Button,
  Caption1,
  Subtitle2,
} from '@fluentui/react-components';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEndpointUsers } from '../api/queries';
import type { UsersSearch } from '../routes/search-schemas';
import { ResourceDetailDrawer } from '../components/detail/ResourceDetailDrawer';
import { EmptyState, ExportSplitButton, LoadingSkeleton, CopyableField, TruncatedText } from '../components/primitives';
import { usePreferencesStore } from '../store/preferences-store';

const USERS_ROUTE_PATH = '/endpoints/$endpointId/users' as const;

const useStyles = makeStyles({
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    // R5 (copilot-instructions.md): tables with truncating cells MUST
    // use `table-layout:fixed` so column widths follow our explicit
    // <th> widths instead of auto-expanding to natural text width
    // (which defeats the inner TruncatedText max-width).
    tableLayout: 'fixed',
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    borderBottom: `2px solid ${tokens.colorNeutralStroke1}`,
    fontWeight: 600,
    fontSize: '13px',
    color: tokens.colorNeutralForeground3,
  },
  thUsername: { width: '320px' },
  thDisplayName: { width: '240px' },
  thStatus: { width: '110px' },
  thCreated: { width: '130px' },
  td: {
    padding: '10px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: '13px',
    // Belt + braces: tableLayout:fixed already bounds columns, but
    // overflow:hidden on the cell guarantees no inner descendant can
    // visually overflow its column.
    overflow: 'hidden',
  },
  tr: {
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  center: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '150px',
  },
  empty: {
    textAlign: 'center' as const,
    padding: '32px',
    color: tokens.colorNeutralForeground3,
  },
  pagination: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 0',
  },
});

interface UsersTabProps {
  endpointId: string;
}

export const UsersTab: React.FC<UsersTabProps> = ({ endpointId }) => {
  const classes = useStyles();
  // Strict-false fallback to defaults so the component still renders if
  // mounted outside the typed route (e.g. in unit tests that haven't yet
  // wired the route schema).
  const search = useSearch({ strict: false }) as Partial<UsersSearch>;
  const page = search.page ?? 1;
  // Phase N4: fall back to the persisted user preference when no URL override is set.
  const defaultPageSize = usePreferencesStore((s) => s.defaultPageSize);
  const pageSize = search.pageSize ?? defaultPageSize;
  const detailId = search.detail;
  const navigate = useNavigate();
  const startIndex = (page - 1) * pageSize + 1;

  const goToPage = (nextPage: number): void => {
    navigate({
      to: USERS_ROUTE_PATH,
      params: (prev) => ({ ...prev, endpointId }),
      search: (prev) => ({ ...(prev as UsersSearch), page: nextPage }),
    });
  };

  const openDetail = (userId: string): void => {
    navigate({
      to: USERS_ROUTE_PATH,
      params: (prev) => ({ ...prev, endpointId }),
      search: (prev) => ({ ...(prev as UsersSearch), detail: userId }),
    });
  };

  const closeDetail = (): void => {
    navigate({
      to: USERS_ROUTE_PATH,
      params: (prev) => ({ ...prev, endpointId }),
      search: (prev) => ({ ...(prev as UsersSearch), detail: undefined }),
    });
  };

  const { data, isLoading, error } = useEndpointUsers(endpointId, { startIndex, count: pageSize });

  if (isLoading) {
    // G1 - row-shaped skeleton mirrors the final table.
    return (
      <div className={classes.container} data-testid="users-loading">
        <LoadingSkeleton
          count={8}
          height="40px"
          data-testid="users-skeleton"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className={classes.center} data-testid="users-error">
        <Text>Failed to load users: {error.message}</Text>
      </div>
    );
  }

  const users = data?.Resources ?? [];
  const total = data?.totalResults ?? 0;

  if (total === 0) {
    // G2 - EmptyState replaces ad-hoc Text. No CTA: user creation
    // happens via SCIM POST from the IdP, but the manual provision
    // page exists for manual onboarding.
    return (
      <EmptyState
        data-testid="users-empty"
        title="No users in this endpoint"
        body="Users are provisioned to this endpoint via SCIM POST /Users from your identity provider, or manually from the Manual Provision page."
      />
    );
  }

  return (
    <div className={classes.container} data-testid="users-tab">
      <div className={classes.header}>
        <Subtitle2>{total} users</Subtitle2>
        <ExportSplitButton
          rows={users.map((u: any) => ({
            id: u.id,
            userName: u.userName,
            displayName: u.displayName ?? '',
            active: u.active !== false,
            created: u.meta?.created ?? '',
            lastModified: u.meta?.lastModified ?? '',
          }))}
          filenameBase={`users-${endpointId}`}
          columns={['id', 'userName', 'displayName', 'active', 'created', 'lastModified']}
        />
      </div>

      <table className={classes.table}>
        <thead>
          <tr>
            <th className={mergeClasses(classes.th, classes.thUsername)}>Username</th>
            <th className={mergeClasses(classes.th, classes.thDisplayName)}>Display Name</th>
            <th className={mergeClasses(classes.th, classes.thStatus)}>Status</th>
            <th className={mergeClasses(classes.th, classes.thCreated)}>Created</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user: any) => (
            <tr
              key={user.id}
              className={classes.tr}
              onClick={() => openDetail(user.id)}
              style={{ cursor: 'pointer' }}
              data-testid={`user-row-${user.id}`}
            >
              <td className={classes.td}>
                <CopyableField
                  value={user.userName}
                  truncate
                  maxWidth="280px"
                  data-testid={`user-username-${user.id}`}
                />
              </td>
              <td className={classes.td}>
                {user.displayName ? (
                  <TruncatedText
                    text={user.displayName}
                    maxWidth="220px"
                    data-testid={`user-displayname-${user.id}`}
                  />
                ) : (
                  <Caption1>-</Caption1>
                )}
              </td>
              <td className={classes.td}>
                <Badge
                  appearance="filled"
                  color={user.active !== false ? 'success' : 'warning'}
                >
                  {user.active !== false ? 'Active' : 'Inactive'}
                </Badge>
              </td>
              <td className={classes.td}>
                <Caption1>
                  {user.meta?.created
                    ? new Date(user.meta.created).toLocaleDateString()
                    : '-'}
                </Caption1>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {total > pageSize && (
        <div className={classes.pagination} data-testid="pagination">
          <Button
            appearance="subtle"
            disabled={page <= 1}
            onClick={() => goToPage(Math.max(1, page - 1))}
            data-testid="pagination-prev"
          >
            Previous
          </Button>
          <Text>Page {page}</Text>
          <Button
            appearance="subtle"
            disabled={startIndex + pageSize > total}
            onClick={() => goToPage(page + 1)}
            data-testid="pagination-next"
          >
            Next
          </Button>
        </div>
      )}

      {detailId && users.find((u: any) => u.id === detailId) && (
        <ResourceDetailDrawer
          kind="user"
          endpointId={endpointId}
          resource={users.find((u: any) => u.id === detailId)}
          open
          onClose={closeDetail}
        />
      )}
    </div>
  );
};

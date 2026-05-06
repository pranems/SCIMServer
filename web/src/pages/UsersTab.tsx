/**
 * UsersTab - SCIM user list table for an endpoint.
 *
 * Phase A3 (per-page migration): pagination state lives in the URL via
 * TanStack Router's `useSearch` + `useNavigate`. The previous
 * `useState(startIndex)` has been removed; the URL
 * `?page=N&pageSize=N` is now the single source of truth, parsed by
 * usersSearchSchema (`web/src/routes/search-schemas.ts`).
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md Phase 2 Step 2.4
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase A3
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Button,
  Spinner,
  Caption1,
  Subtitle2,
} from '@fluentui/react-components';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useEndpointUsers } from '../api/queries';
import type { UsersSearch } from '../routes/search-schemas';

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
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    borderBottom: `2px solid ${tokens.colorNeutralStroke1}`,
    fontWeight: 600,
    fontSize: '13px',
    color: tokens.colorNeutralForeground3,
  },
  td: {
    padding: '10px 12px',
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
    fontSize: '13px',
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
  const pageSize = search.pageSize ?? 20;
  const navigate = useNavigate();
  const startIndex = (page - 1) * pageSize + 1;

  const goToPage = (nextPage: number): void => {
    navigate({
      to: USERS_ROUTE_PATH,
      params: (prev) => ({ ...prev, endpointId }),
      search: (prev) => ({ ...(prev as UsersSearch), page: nextPage }),
    });
  };

  const { data, isLoading, error } = useEndpointUsers(endpointId, { startIndex, count: pageSize });

  if (isLoading) {
    return (
      <div className={classes.center} data-testid="users-loading">
        <Spinner label="Loading users..." />
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
    return (
      <div className={classes.empty} data-testid="users-empty">
        <Text>No users provisioned to this endpoint yet.</Text>
      </div>
    );
  }

  return (
    <div className={classes.container} data-testid="users-tab">
      <div className={classes.header}>
        <Subtitle2>{total} users</Subtitle2>
      </div>

      <table className={classes.table}>
        <thead>
          <tr>
            <th className={classes.th}>Username</th>
            <th className={classes.th}>Display Name</th>
            <th className={classes.th}>Status</th>
            <th className={classes.th}>Created</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user: any) => (
            <tr key={user.id} className={classes.tr}>
              <td className={classes.td}>
                <Text weight="semibold">{user.userName}</Text>
              </td>
              <td className={classes.td}>
                {user.displayName ?? <Caption1>-</Caption1>}
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
    </div>
  );
};

/**
 * GroupsTab - SCIM group list table for an endpoint.
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Spinner,
  Caption1,
  Subtitle2,
} from '@fluentui/react-components';
import { useEndpointGroups } from '../api/queries';

const useStyles = makeStyles({
  container: { display: 'flex', flexDirection: 'column', gap: '12px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: `2px solid ${tokens.colorNeutralStroke1}`, fontWeight: 600, fontSize: '13px', color: tokens.colorNeutralForeground3 },
  td: { padding: '10px 12px', borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, fontSize: '13px' },
  tr: { ':hover': { backgroundColor: tokens.colorNeutralBackground1Hover } },
  center: { display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '150px' },
  empty: { textAlign: 'center' as const, padding: '32px', color: tokens.colorNeutralForeground3 },
});

interface GroupsTabProps {
  endpointId: string;
}

export const GroupsTab: React.FC<GroupsTabProps> = ({ endpointId }) => {
  const classes = useStyles();
  const { data, isLoading, error } = useEndpointGroups(endpointId);

  if (isLoading) {
    return (
      <div className={classes.center} data-testid="groups-loading">
        <Spinner label="Loading groups..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={classes.center} data-testid="groups-error">
        <Text>Failed to load groups: {error.message}</Text>
      </div>
    );
  }

  const groups = data?.Resources ?? [];
  const total = data?.totalResults ?? 0;

  if (total === 0) {
    return (
      <div className={classes.empty} data-testid="groups-empty">
        <Text>No groups provisioned to this endpoint yet.</Text>
      </div>
    );
  }

  return (
    <div className={classes.container} data-testid="groups-tab">
      <div className={classes.header}>
        <Subtitle2>{total} groups</Subtitle2>
      </div>
      <table className={classes.table}>
        <thead>
          <tr>
            <th className={classes.th}>Display Name</th>
            <th className={classes.th}>Members</th>
            <th className={classes.th}>Created</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group: any) => (
            <tr key={group.id} className={classes.tr}>
              <td className={classes.td}>
                <Text weight="semibold">{group.displayName}</Text>
              </td>
              <td className={classes.td}>
                <Badge appearance="outline">{group.members?.length ?? 0}</Badge>
              </td>
              <td className={classes.td}>
                <Caption1>
                  {group.meta?.created
                    ? new Date(group.meta.created).toLocaleDateString()
                    : '-'}
                </Caption1>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

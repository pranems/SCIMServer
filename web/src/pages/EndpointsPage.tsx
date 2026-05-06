/**
 * EndpointsPage - card grid showing all endpoints with live stats.
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md Phase 2 Step 2.2
 */
import React, { useState } from 'react';
import {
  makeStyles,
  tokens,
  Card,
  CardHeader,
  Text,
  Badge,
  Spinner,
  SearchBox,
  Subtitle1,
  Body1,
  Caption1,
} from '@fluentui/react-components';
import {
  Server24Regular,
  People20Regular,
  PeopleTeam20Regular,
} from '@fluentui/react-icons';
import { useEndpoints } from '../api/queries';
import { useNavigate } from '@tanstack/react-router';

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    maxWidth: '1400px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '16px',
  },
  card: {
    padding: '16px',
    cursor: 'pointer',
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  cardBody: {
    display: 'flex',
    gap: '16px',
    marginTop: '8px',
  },
  stat: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  center: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '200px',
  },
});

export const EndpointsPage: React.FC = () => {
  const classes = useStyles();
  const { data, isLoading, error } = useEndpoints();
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className={classes.center} data-testid="endpoints-loading">
        <Spinner label="Loading endpoints..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={classes.center} data-testid="endpoints-error">
        <Text>Failed to load endpoints: {error.message}</Text>
      </div>
    );
  }

  const endpoints = data?.endpoints ?? [];
  const filtered = search
    ? endpoints.filter(
        (ep) =>
          ep.name.toLowerCase().includes(search.toLowerCase()) ||
          ep.displayName?.toLowerCase().includes(search.toLowerCase()),
      )
    : endpoints;

  return (
    <div className={classes.page} data-testid="endpoints-page">
      <div className={classes.header}>
        <Subtitle1>Endpoints ({endpoints.length})</Subtitle1>
        <SearchBox
          placeholder="Filter endpoints..."
          value={search}
          onChange={(_, d) => setSearch(d.value)}
          data-testid="endpoints-search"
        />
      </div>

      <div className={classes.grid} data-testid="endpoints-grid">
        {filtered.map((ep) => (
          <Card
            key={ep.id}
            className={classes.card}
            data-testid={`endpoint-${ep.id}`}
            onClick={() => navigate({ to: '/endpoints/$endpointId', params: { endpointId: ep.id } })}
          >
            <CardHeader
              image={<Server24Regular />}
              header={
                <Text weight="semibold">
                  {ep.displayName ?? ep.name}
                </Text>
              }
              description={<Caption1>{ep.name}</Caption1>}
              action={
                <Badge
                  appearance="filled"
                  color={ep.active ? 'success' : 'warning'}
                >
                  {ep.active ? 'Active' : 'Inactive'}
                </Badge>
              }
            />
            <div className={classes.cardBody}>
              <Caption1 style={{ fontFamily: 'monospace' }}>{ep.scimBasePath}</Caption1>
            </div>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className={classes.center}>
          <Text>{search ? 'No matching endpoints.' : 'No endpoints configured.'}</Text>
        </div>
      )}
    </div>
  );
};

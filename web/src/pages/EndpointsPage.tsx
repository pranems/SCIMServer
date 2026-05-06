/**
 * EndpointsPage - card grid showing all endpoints with live stats.
 *
 * Phase A3: free-text filter `q` lives in the URL via
 * endpointsSearchSchema. Empty input normalizes to undefined so URLs
 * stay clean.
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md Phase 2 Step 2.2
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase A3
 */
import React from 'react';
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
  Caption1,
} from '@fluentui/react-components';
import {
  Server24Regular,
} from '@fluentui/react-icons';
import { useEndpoints } from '../api/queries';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { EndpointsSearch } from '../routes/search-schemas';

const ENDPOINTS_ROUTE_PATH = '/endpoints' as const;

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
  const search = useSearch({ strict: false }) as Partial<EndpointsSearch>;
  const q = search.q ?? '';
  const navigate = useNavigate();

  const setQ = (value: string): void => {
    navigate({
      to: ENDPOINTS_ROUTE_PATH,
      search: () => ({
        q: value.trim() === '' ? undefined : value,
      }),
    });
  };

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
  const filtered = q
    ? endpoints.filter(
        (ep) =>
          ep.name.toLowerCase().includes(q.toLowerCase()) ||
          ep.displayName?.toLowerCase().includes(q.toLowerCase()),
      )
    : endpoints;

  return (
    <div className={classes.page} data-testid="endpoints-page">
      <div className={classes.header}>
        <Subtitle1>Endpoints ({endpoints.length})</Subtitle1>
        <SearchBox
          placeholder="Filter endpoints..."
          value={q}
          onChange={(_, d) => setQ(d.value)}
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
          <Text>{q ? 'No matching endpoints.' : 'No endpoints configured.'}</Text>
        </div>
      )}
    </div>
  );
};

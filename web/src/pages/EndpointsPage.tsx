/**
 * EndpointsPage - compact inventory with URL-owned filtering.
 *
 * Phase A3: free-text filter `q` lives in the URL via
 * endpointsSearchSchema. Empty input normalizes to undefined so URLs
 * stay clean.
 *
 * Phase G1: loading state migrated from Spinner to LoadingSkeleton
 * (3x2 grid of card-shaped tiles mirroring the final layout).
 * Phase G2: empty state migrated from plain Text to EmptyState
 * primitive with a contextual CTA ("Create your first endpoint" when
 * none exist, "Reset filter" when the search filter excludes all).
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md Phase 2 Step 2.2
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase A3 + S10 G1/G2
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Text,
  Badge,
  Button,
  SearchBox,
  Subtitle1,
} from '@fluentui/react-components';
import {
  Add24Regular,
} from '@fluentui/react-icons';
import { useEndpoints } from '../api/queries';
import { useNavigate, useSearch } from '@tanstack/react-router';
import type { EndpointsSearch } from '../routes/search-schemas';
import { EmptyState, LoadingSkeleton, CopyableField } from '../components/primitives';
import { TruncatedText } from '../components/primitives';
import { FilteredResultsPanel } from '../components/primitives/FilteredResultsPanel';
import { endpointProfileLabel, matchesEndpoint } from '../components/endpoints/endpoint-inventory';

const ENDPOINTS_ROUTE_PATH = '/endpoints' as const;

const useStyles = makeStyles({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    maxWidth: '1400px',
    height: '100%',
    minHeight: '320px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    flexWrap: 'wrap',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
    gap: '16px',
  },
  table: {
    tableLayout: 'fixed', width: '100%', minWidth: '640px', borderCollapse: 'collapse',
    '& th': { textAlign: 'left', padding: '10px', backgroundColor: tokens.colorNeutralBackground2 },
    '& td': { padding: '8px 10px', borderTop: `1px solid ${tokens.colorNeutralStroke2}` },
  },
  identity: {
    display: 'flex', flexDirection: 'column', minWidth: 0, gap: '4px',
  },
  endpointName: {
    justifyContent: 'flex-start', textAlign: 'left', minWidth: 0,
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
    // G1 - card-grid skeleton mirrors the final 3-column layout so the
    // page does not jump when data arrives. 6 tiles is the typical
    // above-the-fold count at 1440px wide.
    return (
      <div className={classes.page} data-testid="endpoints-loading">
        <div className={classes.grid} data-testid="endpoints-skeleton-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <LoadingSkeleton
              key={i}
              count={1}
              height="96px"
              data-testid="endpoints-skeleton"
            />
          ))}
        </div>
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
  const filtered = endpoints.filter(ep => matchesEndpoint(ep, q));

  return (
    <div className={classes.page} data-testid="endpoints-page">
      <div className={classes.header}>
        <Subtitle1>Endpoints ({endpoints.length})</Subtitle1>
          {/* Phase L1 - Create endpoint button. */}
          <Button
            appearance="primary"
            icon={<Add24Regular />}
            data-testid="endpoints-create-button"
            onClick={() => navigate({ to: '/endpoints/new' })}
          >
            Create endpoint
          </Button>
      </div>

      <FilteredResultsPanel label="Endpoint inventory" fillHeight={filtered.length > 0} data-testid="endpoints-results" toolbar={
        <>
          <SearchBox
            aria-label="Filter endpoints by name, ID, profile or status"
            placeholder="Filter endpoints..."
            value={q}
            onChange={(_, d) => setQ(d.value)}
            data-testid="endpoints-search"
          />
          <Text role="status">{filtered.length} of {endpoints.length} endpoints</Text>
        </>
      }>
      <table className={classes.table} data-testid="endpoints-table">
        <thead><tr>
          <th scope="col" style={{ width: '40%' }}>Endpoint</th>
          <th scope="col" style={{ width: '25%' }}>ID</th>
          <th scope="col" style={{ width: '20%' }}>Profile schemas</th>
          <th scope="col" style={{ width: '15%' }}>Status</th>
        </tr></thead>
        <tbody>
        {filtered.map((ep) => (
          <tr key={ep.id} data-testid={`endpoint-${ep.id}`}>
            <td>
              <div className={classes.identity}>
                <Button appearance="subtle" className={classes.endpointName} data-testid={`endpoint-${ep.id}-open`}
                  title={`${ep.displayName ?? ep.name} (${ep.name})`}
                  onClick={() => navigate({ to: '/endpoints/$endpointId', params: { endpointId: ep.id } })}>
                  <TruncatedText data-testid={`endpoint-${ep.id}-label`} maxWidth="100%" text={ep.displayName ?? ep.name} />
                </Button>
                <CopyableField value={ep.scimBasePath} monospace truncate maxWidth="100%"
                  data-testid={`endpoint-${ep.id}-scim-base-path`} />
              </div>
            </td>
            <td><CopyableField value={ep.id} truncate maxWidth="100%" /></td>
            <td><CopyableField value={endpointProfileLabel(ep)} truncate maxWidth="100%" /></td>
            <td><Badge appearance="tint" color={ep.active ? 'success' : 'warning'}>{ep.active ? 'Active' : 'Inactive'}</Badge></td>
          </tr>
        ))}
        </tbody>
      </table>
      </FilteredResultsPanel>

      {filtered.length === 0 && (
        // G2 - EmptyState replaces plain Text. CTA depends on whether
        // the user is filtering (offer reset) or there are zero
        // endpoints at all (offer the docs/runbook entry point).
        q ? (
          <EmptyState
            data-testid="endpoints-empty-filtered"
            title="No matching endpoints"
            body={`No endpoint matches "${q}". Try a different filter or clear it.`}
            actionLabel="Reset filter"
            onAction={() => setQ('')}
          />
        ) : (
          <EmptyState
            data-testid="endpoints-empty"
            title="No endpoints yet"
            body="Endpoints are SCIM target tenants that consume your provisioning data. Create one to get started."
          />
        )
      )}
    </div>
  );
};

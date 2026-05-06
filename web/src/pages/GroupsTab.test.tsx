/**
 * GroupsTab tests.
 *
 * Phase A3: pagination via groupsSearchSchema URL search params.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { GroupsTab } from './GroupsTab';
import { renderWithRouter } from '../test/router-test-utils';
import { groupsSearchSchema } from '../routes/search-schemas';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return { ...actual, useEndpointGroups: vi.fn() };
});

import { useEndpointGroups } from '../api/queries';

function wrap(
  ui: React.ReactElement,
  initialUrl = '/endpoints/ep-1/groups',
) {
  return renderWithRouter(ui, {
    initialUrl,
    routePath: '/endpoints/$endpointId/groups',
    validateSearch: (raw) => groupsSearchSchema.parse(raw),
  });
}

const mockGroups = {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
  totalResults: 2,
  startIndex: 1,
  itemsPerPage: 20,
  Resources: [
    { id: 'g1', displayName: 'Engineering', members: [{ value: 'u1' }, { value: 'u2' }], meta: { resourceType: 'Group', created: '2026-01-01T00:00:00Z' } },
    { id: 'g2', displayName: 'Marketing', members: [], meta: { resourceType: 'Group', created: '2026-02-01T00:00:00Z' } },
  ],
};

describe('GroupsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading state', async () => {
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: true, error: null,
    });
    wrap(<GroupsTab endpointId="ep-1" />);
    expect(await screen.findByTestId('groups-loading')).toBeInTheDocument();
  });

  it('shows error state', async () => {
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: false, error: new Error('Fail'),
    });
    wrap(<GroupsTab endpointId="ep-1" />);
    expect(await screen.findByTestId('groups-error')).toBeInTheDocument();
  });

  it('renders group table with display names and member counts', async () => {
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockGroups, isLoading: false, error: null,
    });
    wrap(<GroupsTab endpointId="ep-1" />);
    expect(await screen.findByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Marketing')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('2 groups')).toBeInTheDocument();
  });

  it('shows empty state when no groups', async () => {
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockGroups, totalResults: 0, Resources: [] },
      isLoading: false, error: null,
    });
    wrap(<GroupsTab endpointId="ep-1" />);
    expect(await screen.findByText(/no groups/i)).toBeInTheDocument();
  });

  it('reads page from URL search params (?page=2 -> startIndex=21)', async () => {
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockGroups, totalResults: 50, itemsPerPage: 20 },
      isLoading: false, error: null,
    });
    wrap(<GroupsTab endpointId="ep-1" />, '/endpoints/ep-1/groups?page=2');
    await screen.findByTestId('groups-pagination');
    expect(useEndpointGroups).toHaveBeenCalledWith(
      'ep-1',
      expect.objectContaining({ startIndex: 21, count: 20 }),
    );
  });
});

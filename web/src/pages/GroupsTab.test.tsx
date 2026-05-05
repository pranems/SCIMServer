/**
 * GroupsTab - TDD spec.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { GroupsTab } from './GroupsTab';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return { ...actual, useEndpointGroups: vi.fn() };
});

import { useEndpointGroups } from '../api/queries';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>
    </QueryClientProvider>,
  );
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

  it('shows loading state', () => {
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: true, error: null,
    });
    wrap(<GroupsTab endpointId="ep-1" />);
    expect(screen.getByTestId('groups-loading')).toBeInTheDocument();
  });

  it('shows error state', () => {
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: false, error: new Error('Fail'),
    });
    wrap(<GroupsTab endpointId="ep-1" />);
    expect(screen.getByTestId('groups-error')).toBeInTheDocument();
  });

  it('renders group table with display names and member counts', () => {
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockGroups, isLoading: false, error: null,
    });
    wrap(<GroupsTab endpointId="ep-1" />);
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Marketing')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // members count for Engineering
    expect(screen.getByText('0')).toBeInTheDocument(); // members count for Marketing
    expect(screen.getByText('2 groups')).toBeInTheDocument();
  });

  it('shows empty state when no groups', () => {
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockGroups, totalResults: 0, Resources: [] },
      isLoading: false, error: null,
    });
    wrap(<GroupsTab endpointId="ep-1" />);
    expect(screen.getByText(/no groups/i)).toBeInTheDocument();
  });
});

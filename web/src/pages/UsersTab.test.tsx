/**
 * UsersTab - TDD spec (RED first).
 * Renders a paginated table of SCIM users for an endpoint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { UsersTab } from './UsersTab';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return { ...actual, useEndpointUsers: vi.fn() };
});

import { useEndpointUsers } from '../api/queries';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>
    </QueryClientProvider>,
  );
}

const mockUsers = {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
  totalResults: 3,
  startIndex: 1,
  itemsPerPage: 20,
  Resources: [
    { id: 'u1', userName: 'alice@corp.com', displayName: 'Alice Smith', active: true, meta: { resourceType: 'User', created: '2026-01-01T00:00:00Z', lastModified: '2026-05-01T00:00:00Z' } },
    { id: 'u2', userName: 'bob@corp.com', displayName: 'Bob Jones', active: true, meta: { resourceType: 'User', created: '2026-02-01T00:00:00Z', lastModified: '2026-05-01T00:00:00Z' } },
    { id: 'u3', userName: 'charlie@corp.com', displayName: 'Charlie Brown', active: false, meta: { resourceType: 'User', created: '2026-03-01T00:00:00Z', lastModified: '2026-04-01T00:00:00Z' } },
  ],
};

describe('UsersTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading state', () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: true, error: null,
    });
    wrap(<UsersTab endpointId="ep-1" />);
    expect(screen.getByTestId('users-loading')).toBeInTheDocument();
  });

  it('shows error state', () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: false, error: new Error('Fail'),
    });
    wrap(<UsersTab endpointId="ep-1" />);
    expect(screen.getByTestId('users-error')).toBeInTheDocument();
  });

  it('renders user table with correct columns', () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockUsers, isLoading: false, error: null,
    });
    wrap(<UsersTab endpointId="ep-1" />);
    expect(screen.getByText('alice@corp.com')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('3 users')).toBeInTheDocument();
  });

  it('shows active/inactive badges', () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockUsers, isLoading: false, error: null,
    });
    wrap(<UsersTab endpointId="ep-1" />);
    const activeBadges = screen.getAllByText('Active');
    const inactiveBadges = screen.getAllByText('Inactive');
    expect(activeBadges.length).toBe(2);
    expect(inactiveBadges.length).toBe(1);
  });

  it('shows empty state when no users', () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockUsers, totalResults: 0, Resources: [] },
      isLoading: false, error: null,
    });
    wrap(<UsersTab endpointId="ep-1" />);
    expect(screen.getByText(/no users/i)).toBeInTheDocument();
  });

  it('shows pagination controls when totalResults > pageSize', () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockUsers, totalResults: 50, itemsPerPage: 20 },
      isLoading: false, error: null,
    });
    wrap(<UsersTab endpointId="ep-1" />);
    expect(screen.getByTestId('pagination')).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
  });

  it('does not show pagination when all results fit on one page', () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockUsers, isLoading: false, error: null, // totalResults: 3, fits in one page
    });
    wrap(<UsersTab endpointId="ep-1" />);
    expect(screen.queryByTestId('pagination')).not.toBeInTheDocument();
  });

  it('next button calls with incremented startIndex', () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockUsers, totalResults: 50, itemsPerPage: 20 },
      isLoading: false, error: null,
    });
    wrap(<UsersTab endpointId="ep-1" />);
    const nextBtn = screen.getByTestId('pagination-next');
    fireEvent.click(nextBtn);
    // After click, useEndpointUsers should be called with startIndex=21
    expect(useEndpointUsers).toHaveBeenCalledWith('ep-1', expect.objectContaining({ startIndex: 21 }));
  });
});

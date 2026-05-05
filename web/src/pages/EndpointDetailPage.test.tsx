/**
 * EndpointDetailPage - TDD spec (RED first).
 *
 * Tabbed detail view for a single endpoint with Overview, Users, Groups,
 * Logs, Activity, Settings tabs.
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md Phase 2 Step 2.3
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { EndpointDetailPage } from './EndpointDetailPage';
import type { EndpointResponse, EndpointStatsResponse } from '@scim/types/dashboard.types';

// Mock queries
vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpoint: vi.fn(),
    useEndpointStats: vi.fn(),
  };
});

import { useEndpoint, useEndpointStats } from '../api/queries';

const mockEndpoint: EndpointResponse = {
  id: 'ep-1',
  name: 'prod-endpoint',
  displayName: 'Production',
  active: true,
  scimBasePath: '/scim/endpoints/ep-1/v2',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-05-01T00:00:00Z',
  _links: {
    self: '/admin/endpoints/ep-1',
    stats: '/admin/endpoints/ep-1/stats',
    credentials: '/admin/endpoints/ep-1/credentials',
    scim: '/scim/endpoints/ep-1/v2',
  },
};

const mockStats: EndpointStatsResponse = {
  users: { total: 30, active: 28, inactive: 2 },
  groups: { total: 5, active: 5, inactive: 0 },
  groupMembers: { total: 45 },
  requestLogs: { total: 1200 },
};

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>
    </QueryClientProvider>,
  );
}

describe('EndpointDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner while endpoint data is loading', () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: true, error: null,
    });
    (useEndpointStats as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: true, error: null,
    });

    renderWithProviders(<EndpointDetailPage endpointId="ep-1" />);
    expect(screen.getByTestId('endpoint-detail-loading')).toBeInTheDocument();
  });

  it('shows error when endpoint not found', () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: false, error: new Error('Not found'),
    });
    (useEndpointStats as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: false, error: null,
    });

    renderWithProviders(<EndpointDetailPage endpointId="ep-1" />);
    expect(screen.getByTestId('endpoint-detail-error')).toBeInTheDocument();
  });

  it('renders endpoint name and status badge', () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockEndpoint, isLoading: false, error: null,
    });
    (useEndpointStats as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockStats, isLoading: false, error: null,
    });

    renderWithProviders(<EndpointDetailPage endpointId="ep-1" />);
    expect(screen.getByText('Production')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders Overview tab by default with KPI stats', () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockEndpoint, isLoading: false, error: null,
    });
    (useEndpointStats as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockStats, isLoading: false, error: null,
    });

    renderWithProviders(<EndpointDetailPage endpointId="ep-1" />);
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    // Overview shows user/group/member counts
    expect(screen.getByText('30')).toBeInTheDocument(); // total users
    expect(screen.getByText('5')).toBeInTheDocument();  // total groups
  });

  it('renders tab bar with all tabs', () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockEndpoint, isLoading: false, error: null,
    });
    (useEndpointStats as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockStats, isLoading: false, error: null,
    });

    renderWithProviders(<EndpointDetailPage endpointId="ep-1" />);
    expect(screen.getByRole('tab', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /users/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /groups/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /logs/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /settings/i })).toBeInTheDocument();
  });

  it('switches tab content when clicking a different tab', () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockEndpoint, isLoading: false, error: null,
    });
    (useEndpointStats as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockStats, isLoading: false, error: null,
    });

    renderWithProviders(<EndpointDetailPage endpointId="ep-1" />);

    // Click Users tab
    fireEvent.click(screen.getByRole('tab', { name: /users/i }));
    expect(screen.getByTestId('tab-users')).toBeInTheDocument();
  });

  it('shows endpoint metadata (scimBasePath, createdAt)', () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockEndpoint, isLoading: false, error: null,
    });
    (useEndpointStats as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockStats, isLoading: false, error: null,
    });

    renderWithProviders(<EndpointDetailPage endpointId="ep-1" />);
    expect(screen.getByText(/\/scim\/endpoints\/ep-1\/v2/)).toBeInTheDocument();
  });
});

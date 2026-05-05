/**
 * DashboardPage tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { DashboardPage } from './DashboardPage';
import type { DashboardResponse } from '@scim/types/dashboard.types';

// Mock the queries module
const mockDashboardData: DashboardResponse = {
  health: { status: 'ok', uptime: 3600, dbType: 'postgresql' },
  stats: { totalEndpoints: 2, totalUsers: 50, totalGroups: 5 },
  endpoints: [
    {
      id: 'ep-1',
      name: 'prod',
      displayName: 'Production',
      active: true,
      users: { total: 30, active: 28, inactive: 2 },
      groups: { total: 3, active: 3, inactive: 0 },
      createdAt: '2026-01-01T00:00:00Z',
      _links: { self: '/admin/endpoints/ep-1', stats: '', credentials: '', scim: '' },
    },
    {
      id: 'ep-2',
      name: 'dev',
      active: true,
      users: { total: 20, active: 20, inactive: 0 },
      groups: { total: 2, active: 2, inactive: 0 },
      createdAt: '2026-02-01T00:00:00Z',
      _links: { self: '/admin/endpoints/ep-2', stats: '', credentials: '', scim: '' },
    },
  ],
  recentActivity: [
    {
      id: 'act-1',
      timestamp: '2026-05-01T10:00:00Z',
      method: 'POST',
      path: '/scim/endpoints/ep-1/v2/Users',
      statusCode: 201,
      durationMs: 42,
      endpointId: 'ep-1',
    },
    {
      id: 'act-2',
      timestamp: '2026-05-01T09:30:00Z',
      method: 'GET',
      path: '/scim/endpoints/ep-1/v2/Users',
      statusCode: 200,
      durationMs: 15,
      endpointId: 'ep-1',
    },
  ],
  version: { version: '0.41.0', node: 'v24.0.0', uptime: 3600 },
};

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useDashboard: vi.fn(),
  };
});

import { useDashboard } from '../api/queries';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FluentProvider theme={webLightTheme}>
        {ui}
      </FluentProvider>
    </QueryClientProvider>,
  );
}

describe('DashboardPage', () => {
  it('shows loading spinner while fetching', () => {
    (useDashboard as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    renderWithProviders(<DashboardPage />);
    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument();
  });

  it('shows error state on fetch failure', () => {
    (useDashboard as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network error'),
    });

    renderWithProviders(<DashboardPage />);
    expect(screen.getByTestId('dashboard-error')).toBeInTheDocument();
    expect(screen.getByText(/Network error/)).toBeInTheDocument();
  });

  it('renders all 4 KPI cards', () => {
    (useDashboard as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockDashboardData,
      isLoading: false,
      error: null,
    });

    renderWithProviders(<DashboardPage />);

    expect(screen.getByTestId('kpi-row')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-endpoints')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-total-users')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-total-groups')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-status')).toBeInTheDocument();
  });

  it('renders KPI values from dashboard data', () => {
    (useDashboard as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockDashboardData,
      isLoading: false,
      error: null,
    });

    renderWithProviders(<DashboardPage />);

    expect(screen.getByText('2')).toBeInTheDocument();  // endpoints
    expect(screen.getByText('50')).toBeInTheDocument(); // total users
    expect(screen.getByText('5')).toBeInTheDocument();  // total groups
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('renders endpoint cards', () => {
    (useDashboard as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockDashboardData,
      isLoading: false,
      error: null,
    });

    renderWithProviders(<DashboardPage />);

    expect(screen.getByTestId('endpoint-card-ep-1')).toBeInTheDocument();
    expect(screen.getByTestId('endpoint-card-ep-2')).toBeInTheDocument();
    expect(screen.getByText('Production')).toBeInTheDocument();
  });

  it('renders recent activity entries', () => {
    (useDashboard as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockDashboardData,
      isLoading: false,
      error: null,
    });

    renderWithProviders(<DashboardPage />);

    expect(screen.getByTestId('activity-list')).toBeInTheDocument();
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('201')).toBeInTheDocument();
  });

  it('handles empty endpoints list', () => {
    (useDashboard as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockDashboardData, endpoints: [], recentActivity: [] },
      isLoading: false,
      error: null,
    });

    renderWithProviders(<DashboardPage />);

    expect(screen.getByText('No endpoints configured.')).toBeInTheDocument();
    expect(screen.getByText('No recent activity.')).toBeInTheDocument();
  });
});

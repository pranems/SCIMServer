/**
 * DashboardPage tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  // Phase D4 - 24-element hourly series. Index 23 is the current hour;
  // sample shape: low overnight, peaks during business hours.
  requestsLast24hSeries: [
    0, 0, 0, 0, 1, 1, 2, 4,
    8, 12, 18, 22, 25, 28, 30, 26,
    20, 14, 9, 5, 3, 2, 1, 1,
  ],
  version: { version: '0.41.0', node: 'v24.0.0', uptime: 3600 },
};

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useDashboard: vi.fn(),
    // Phase L3 - new analytics hook. Default mock returns no data so the
    // pre-L3 tests below see an empty/loading analytics section without
    // having to set the return value themselves.
    useActivitySummary: vi.fn(() => ({ data: undefined, isLoading: false, isError: false, error: null })),
  };
});

import { useDashboard, useActivitySummary } from '../api/queries';

// Phase A2 note: DashboardPage's EndpointCard sub-component now calls
// useNavigate() from TanStack Router. Without a RouterProvider in this
// minimal test tree the hook prints a console warning and returns a
// no-op. The tests below only assert read-side rendering behavior, never
// click-driven navigation, so the warning is harmless.
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
  it('shows skeleton loading state while fetching', () => {
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

    // Phase D4 R3 - empty states are now EmptyState primitives, not
    // plain Text. Asserting via the dedicated test ids keeps the test
    // robust against copy changes (the title/body text can be reworded
    // without breaking the contract).
    expect(screen.getByTestId('dashboard-empty-endpoints')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-empty-activity')).toBeInTheDocument();
  });

  // ─── Phase D4: Dashboard charts ────────────────────────────────────

  describe('Phase D4 - 24h request chart', () => {
    it('renders the chart card with the KpiChart sparkline', () => {
      (useDashboard as ReturnType<typeof vi.fn>).mockReturnValue({
        data: mockDashboardData,
        isLoading: false,
        error: null,
      });

      renderWithProviders(<DashboardPage />);

      const chartCard = screen.getByTestId('dashboard-chart-card');
      expect(chartCard).toBeInTheDocument();
      expect(screen.getByTestId('dashboard-chart')).toBeInTheDocument();
      // Header copy: sum of mock series (computed once for the test).
      // Caption1 fragments the text across child nodes; check the
      // composed textContent of the card root for the full string.
      const expectedSum = mockDashboardData.requestsLast24hSeries.reduce(
        (a, b) => a + b,
        0,
      );
      expect(chartCard.textContent).toContain(`${expectedSum} total`);
      expect(chartCard.textContent).toContain('1 this hour');
    });

    it('renders the empty fallback when the series is missing', () => {
      (useDashboard as ReturnType<typeof vi.fn>).mockReturnValue({
        data: { ...mockDashboardData, requestsLast24hSeries: [] },
        isLoading: false,
        error: null,
      });

      renderWithProviders(<DashboardPage />);

      // Card still renders; KpiChart shows its own empty fallback because
      // length < 2. Header reads 0 total / 0 this hour.
      const chartCard = screen.getByTestId('dashboard-chart-card');
      expect(chartCard).toBeInTheDocument();
      expect(chartCard.textContent).toContain('0 total');
      expect(chartCard.textContent).toContain('0 this hour');
    });

    it('passes the full 24-element series to KpiChart in oldest-first order', () => {
      (useDashboard as ReturnType<typeof vi.fn>).mockReturnValue({
        data: mockDashboardData,
        isLoading: false,
        error: null,
      });

      renderWithProviders(<DashboardPage />);

      // recharts is rendered inside ResponsiveContainer; we assert the
      // chart container exists and the headline value matches the LAST
      // element of the series (current hour). This locks the
      // "oldest-first / current-last" contract end-to-end without
      // poking into recharts internals.
      const chart = screen.getByTestId('dashboard-chart');
      expect(chart).toBeInTheDocument();
      const lastValue =
        mockDashboardData.requestsLast24hSeries[
          mockDashboardData.requestsLast24hSeries.length - 1
        ];
      const chartCard = screen.getByTestId('dashboard-chart-card');
      expect(chartCard.textContent).toContain(`${lastValue} this hour`);
    });
  });

  // ─── R2: LoadingSkeleton instead of Spinner ───────────────────────

  it('uses LoadingSkeleton (not Spinner) on isLoading', () => {
    (useDashboard as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    renderWithProviders(<DashboardPage />);

    // The container itself stays for back-compat
    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument();
    // Phase G1 pattern: chart-skeleton row is part of the loading layout
    // mirroring the final layout (zero CLS).
    expect(screen.getByTestId('dashboard-chart-skeleton')).toBeInTheDocument();
    // Fluent UI's Skeleton wrapper exposes role="progressbar" itself, so
    // the legacy Spinner removal is verified by the absence of the
    // text "Loading dashboard..." (the Spinner's label).
    expect(screen.queryByText('Loading dashboard...')).not.toBeInTheDocument();
  });
});

// ─── Phase L3: ActivityAnalyticsSection ──────────────────────────────

describe('DashboardPage activity analytics (Phase L3)', () => {
  const sampleSummary = {
    summary: {
      last24Hours: 42,
      lastWeek: 318,
      operations: { users: 142, groups: 18 },
    },
  };

  beforeEach(() => {
    (useDashboard as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockDashboardData,
      isLoading: false,
      error: null,
    });
  });

  it('renders the analytics section when summary loads', () => {
    (useActivitySummary as ReturnType<typeof vi.fn>).mockReturnValue({
      data: sampleSummary,
      isLoading: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByTestId('dashboard-analytics-section')).toBeInTheDocument();
  });

  it('renders 4 KPI tiles with the summary values', () => {
    (useActivitySummary as ReturnType<typeof vi.fn>).mockReturnValue({
      data: sampleSummary,
      isLoading: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<DashboardPage />);
    const tile24h = screen.getByTestId('analytics-kpi-last24h');
    const tile7d = screen.getByTestId('analytics-kpi-last7d');
    const tileUsers = screen.getByTestId('analytics-kpi-users-30d');
    const tileGroups = screen.getByTestId('analytics-kpi-groups-30d');
    expect(tile24h.textContent).toContain('42');
    expect(tile7d.textContent).toContain('318');
    expect(tileUsers.textContent).toContain('142');
    expect(tileGroups.textContent).toContain('18');
  });

  it('renders the users-vs-groups operations split bar', () => {
    (useActivitySummary as ReturnType<typeof vi.fn>).mockReturnValue({
      data: sampleSummary,
      isLoading: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<DashboardPage />);
    const split = screen.getByTestId('analytics-ops-split');
    expect(split).toBeInTheDocument();
    // Caption mentions both surface names so the operator can read
    // the bar without external context.
    expect(split.textContent).toMatch(/users/i);
    expect(split.textContent).toMatch(/groups/i);
  });

  it('handles a zeroed summary (in-memory backend) without crashing', () => {
    (useActivitySummary as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { summary: { last24Hours: 0, lastWeek: 0, operations: { users: 0, groups: 0 } } },
      isLoading: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<DashboardPage />);
    const tile24h = screen.getByTestId('analytics-kpi-last24h');
    expect(tile24h.textContent).toContain('0');
    // Split bar still renders even when both ops counts are 0 (shows
    // a neutral empty bar with the explanatory caption).
    expect(screen.getByTestId('analytics-ops-split')).toBeInTheDocument();
  });
});

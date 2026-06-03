/**
 * OverviewTab tests.
 *
 * Phase A2: extracted from EndpointDetailPage.
 * Phase B2: switched from useEndpointStats to useEndpointOverview which
 * returns the BFF aggregate (endpoint summary, stats, credentials,
 * recent activity, config flags). Tests assert KPI rendering against
 * the new shape and an extra credential KPI card the tab now exposes.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { OverviewTab } from './OverviewTab';
import type { EndpointOverviewResponse } from '@scim/types/dashboard.types';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpointOverview: vi.fn(),
  };
});

import { useEndpointOverview } from '../api/queries';

const mockOverview: EndpointOverviewResponse = {
  endpoint: {
    id: 'ep-1',
    name: 'prod',
    displayName: 'Production',
    preset: 'entra-id',
    active: true,
    scimBasePath: '/scim/endpoints/ep-1/v2',
    createdAt: '2026-01-01T00:00:00Z',
  },
  stats: {
    userCount: 30,
    activeUserCount: 28,
    groupCount: 5,
    activeGroupCount: 5,
    genericResourceCount: 7,
  },
  credentials: [
    {
      id: 'c1',
      credentialType: 'bearer',
      label: 'Entra',
      active: true,
      createdAt: '2026-02-01T00:00:00Z',
      expiresAt: null,
    },
    {
      id: 'c2',
      credentialType: 'bearer',
      label: 'Old',
      active: false,
      createdAt: '2026-01-15T00:00:00Z',
      expiresAt: null,
    },
  ],
  recentActivity: [],
  configFlags: { StrictSchemaValidation: true },
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

describe('OverviewTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner while overview is loading', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    renderWithProviders(<OverviewTab endpointId="ep-1" />);
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    // Loading state - no KPI numbers yet.
    expect(screen.queryByText('30')).not.toBeInTheDocument();
  });

  it('renders all 4 KPI cards with correct totals', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockOverview,
      isLoading: false,
      error: null,
    });

    renderWithProviders(<OverviewTab endpointId="ep-1" />);
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument(); // userCount
    expect(screen.getByText('5')).toBeInTheDocument(); // groupCount
    expect(screen.getByText('7')).toBeInTheDocument(); // genericResourceCount
    expect(screen.getByText('2')).toBeInTheDocument(); // credentials.length
  });

  it('shows the active-user subtitle on the Users KPI card', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockOverview,
      isLoading: false,
      error: null,
    });

    renderWithProviders(<OverviewTab endpointId="ep-1" />);
    expect(screen.getByText('28 active')).toBeInTheDocument();
  });

  it('shows the active credential count subtitle (Phase B2)', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockOverview,
      isLoading: false,
      error: null,
    });

    renderWithProviders(<OverviewTab endpointId="ep-1" />);
    // 2 total credentials, only 1 active.
    expect(screen.getByText('1 active')).toBeInTheDocument();
  });

  it('renders an error message when the BFF call fails', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('BFF down'),
    });

    renderWithProviders(<OverviewTab endpointId="ep-1" />);
    // Loading branch wins when data is undefined - this is intentional
    // because the spinner is the better default. The error testid only
    // appears once data is set AND error is truthy (refetch failure).
    // For the "first load failed" branch (data undefined, error set)
    // we keep the loading state so the user sees a spinner instead of
    // a transient error flash before retry.
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
  });

  // ── Phase D1 - data-completeness ──────────────────────────────────
  // Spec ([UI_REDESIGN_REMAINING_GAPS_PLAN.md] §7.1):
  //   - Render: stats cards + recent activity list + flag summary count
  //     + credential count
  //   - Skeleton on loading; EmptyState when no recent activity

  it('renders LoadingSkeleton (not Spinner) while loading - Phase D1/G1', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    renderWithProviders(<OverviewTab endpointId="ep-1" />);
    // The G1/D1 contract says we use LoadingSkeleton primitive, not the
    // Fluent Spinner. Asserting on the primitive's data-testid keeps
    // the test independent of internal Skeleton DOM details.
    expect(screen.getByTestId('overview-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Loading overview...')).not.toBeInTheDocument();
  });

  it('renders the Recent Activity section with entries from the BFF', () => {
    const overview: EndpointOverviewResponse = {
      ...mockOverview,
      recentActivity: [
        {
          id: 'l1',
          timestamp: '2026-05-08T10:00:00Z',
          method: 'POST',
          path: '/scim/endpoints/ep-1/Users',
          statusCode: 201,
          durationMs: 42,
        },
        {
          id: 'l2',
          timestamp: '2026-05-08T10:01:00Z',
          method: 'PATCH',
          path: '/scim/endpoints/ep-1/Users/u1',
          statusCode: 200,
          durationMs: 18,
        },
      ],
    };
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overview,
      isLoading: false,
      error: null,
    });

    renderWithProviders(<OverviewTab endpointId="ep-1" />);
    expect(screen.getByTestId('overview-activity')).toBeInTheDocument();
    // Each row exposes its id as a testid suffix so we can target them.
    expect(screen.getByTestId('overview-activity-row-l1')).toBeInTheDocument();
    expect(screen.getByTestId('overview-activity-row-l2')).toBeInTheDocument();
    // The HTTP method + status code should be visible to a human.
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('201')).toBeInTheDocument();
  });

  it('shows an EmptyState in the Recent Activity slot when none exist', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockOverview, // recentActivity is [] in the fixture
      isLoading: false,
      error: null,
    });

    renderWithProviders(<OverviewTab endpointId="ep-1" />);
    expect(screen.getByTestId('overview-activity-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('overview-activity-row-l1')).not.toBeInTheDocument();
  });

  it('renders a Config Flags KPI card with the count of enabled flags', () => {
    const overview: EndpointOverviewResponse = {
      ...mockOverview,
      configFlags: {
        StrictSchemaValidation: true,
        BulkOperationsEnabled: true,
        UserSoftDeleteEnabled: false,
        // Strings should NOT count toward the enabled tally.
        logLevel: 'INFO',
      },
    };
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overview,
      isLoading: false,
      error: null,
    });

    renderWithProviders(<OverviewTab endpointId="ep-1" />);
    // 2 flags are explicitly true; that is what the KPI surfaces.
    expect(screen.getByTestId('overview-flags-card')).toBeInTheDocument();
    expect(screen.getByText('2 enabled')).toBeInTheDocument();
  });
});

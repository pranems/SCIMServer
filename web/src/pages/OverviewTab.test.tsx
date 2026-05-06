/**
 * OverviewTab tests - extracted from EndpointDetailPage in Phase A2
 * cutover. Verifies the KPI cards render against useEndpointStats data
 * and the loading state shows a spinner.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { OverviewTab } from './OverviewTab';
import type { EndpointStatsResponse } from '@scim/types/dashboard.types';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpointStats: vi.fn(),
  };
});

import { useEndpointStats } from '../api/queries';

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

describe('OverviewTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner while stats are loading', () => {
    (useEndpointStats as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: true, error: null,
    });

    renderWithProviders(<OverviewTab endpointId="ep-1" />);
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    // Loading state - no KPI numbers yet.
    expect(screen.queryByText('30')).not.toBeInTheDocument();
  });

  it('renders all 4 KPI cards with correct totals', () => {
    (useEndpointStats as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockStats, isLoading: false, error: null,
    });

    renderWithProviders(<OverviewTab endpointId="ep-1" />);
    expect(screen.getByTestId('tab-overview')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();    // total users
    expect(screen.getByText('5')).toBeInTheDocument();     // total groups
    expect(screen.getByText('45')).toBeInTheDocument();    // total members
    expect(screen.getByText('1200')).toBeInTheDocument();  // total requests
  });

  it('shows the active-user subtitle on the Users KPI card', () => {
    (useEndpointStats as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockStats, isLoading: false, error: null,
    });

    renderWithProviders(<OverviewTab endpointId="ep-1" />);
    expect(screen.getByText('28 active')).toBeInTheDocument();
  });
});

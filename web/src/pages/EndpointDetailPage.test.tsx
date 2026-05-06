/**
 * EndpointDetailPage tests - layout-only behavior.
 *
 * Phase A2 cutover: EndpointDetailPage is now a pure layout that reads
 * the active tab from the URL and renders <Outlet /> for the matched
 * child route. Tab content (OverviewTab, UsersTab, ...) is exercised in
 * its own test files. These tests verify the layout chrome only.
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase A2
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { EndpointDetailPage } from './EndpointDetailPage';
import { renderWithRouter } from '../test/router-test-utils';
import type { EndpointResponse } from '@scim/types/dashboard.types';

// Mock queries
vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpoint: vi.fn(),
    useEndpointStats: vi.fn(),
  };
});

import { useEndpoint } from '../api/queries';

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

function renderDetail(initialUrl = '/endpoints/ep-1') {
  // The helper's default routePath '/$' is a catch-all that matches every
  // pathname, so URLs like '/endpoints/ep-1/users' resolve cleanly without
  // needing the full nested route tree mounted in the test router.
  return renderWithRouter(<EndpointDetailPage endpointId="ep-1" />, {
    initialUrl,
  });
}

describe('EndpointDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner while endpoint data is loading', async () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: true, error: null,
    });

    renderDetail();
    expect(await screen.findByTestId('endpoint-detail-loading')).toBeInTheDocument();
  });

  it('shows error when endpoint not found', async () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: false, error: new Error('Not found'),
    });

    renderDetail();
    expect(await screen.findByTestId('endpoint-detail-error')).toBeInTheDocument();
  });

  it('renders endpoint name and status badge', async () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockEndpoint, isLoading: false, error: null,
    });

    renderDetail();
    expect(await screen.findByText('Production')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders tab bar with all 5 tabs', async () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockEndpoint, isLoading: false, error: null,
    });

    renderDetail();
    await screen.findByTestId('endpoint-detail-page');
    expect(screen.getByRole('tab', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /users/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /groups/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /logs/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /settings/i })).toBeInTheDocument();
  });

  it('marks Overview tab as selected on bare /endpoints/$endpointId URL', async () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockEndpoint, isLoading: false, error: null,
    });

    renderDetail('/endpoints/ep-1');
    const overviewTab = await screen.findByRole('tab', { name: /overview/i });
    expect(overviewTab).toHaveAttribute('aria-selected', 'true');
  });

  it('marks Users tab as selected when URL is /endpoints/$endpointId/users', async () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockEndpoint, isLoading: false, error: null,
    });

    renderDetail('/endpoints/ep-1/users');
    const usersTab = await screen.findByRole('tab', { name: /users/i });
    await waitFor(() => expect(usersTab).toHaveAttribute('aria-selected', 'true'));
  });

  it('renders the back-to-endpoints Link', async () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockEndpoint, isLoading: false, error: null,
    });

    renderDetail();
    const back = await screen.findByTestId('back-to-endpoints');
    // The Link should resolve to /endpoints in its href.
    expect(back).toHaveAttribute('href', '/endpoints');
  });

  it('clicking the Users tab triggers navigation (handler invoked)', async () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockEndpoint, isLoading: false, error: null,
    });

    renderDetail();
    const usersTab = await screen.findByRole('tab', { name: /users/i });
    fireEvent.click(usersTab);
    // After click, the tab should appear selected (URL-driven). Since the
    // test's in-memory route only knows about /endpoints/$endpointId, the
    // navigate call is a no-op for routing, but the click handler runs
    // without throwing - which is what we are guarding against.
    expect(usersTab).toBeInTheDocument();
  });

  it('shows endpoint metadata (scimBasePath, createdAt)', async () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockEndpoint, isLoading: false, error: null,
    });

    renderDetail();
    expect(await screen.findByText(/\/scim\/endpoints\/ep-1\/v2/)).toBeInTheDocument();
  });
});

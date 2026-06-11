/**
 * Phase G visual polish gate tests.
 *
 * Asserts that every primary surface routes its loading state through
 * the LoadingSkeleton primitive (G1) and its empty state through the
 * EmptyState primitive (G2). Catches regressions where someone adds a
 * new page that re-introduces an indeterminate Spinner or a plain
 * "No X yet" Text node, both of which break the design contract.
 *
 * The G3 ErrorBoundary contract is verified separately in
 * `web/src/layout/RouteBoundary.test.tsx`.
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md S10 G1 + G2
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import { renderWithRouter } from '../test/router-test-utils';

// All page modules under test.
import { EndpointsPage } from './EndpointsPage';
import { EndpointDetailPage } from './EndpointDetailPage';
import { UsersTab } from './UsersTab';
import { GroupsTab } from './GroupsTab';
import { LogsTab } from './LogsTab';
import { SettingsTab } from './SettingsTab';
import { SettingsPage } from './SettingsPage';
import { ManualProvisionPage } from './ManualProvisionPage';

import {
  endpointsSearchSchema,
  groupsSearchSchema,
  usersSearchSchema,
  logsSearchSchema,
} from '../routes/search-schemas';

// Single mock module that all the page tests share. We mock the surface
// of api/queries used by these pages and toggle each hook's return per
// test.
vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpoints: vi.fn(),
    useEndpoint: vi.fn(),
    useEndpointUsers: vi.fn(),
    useEndpointGroups: vi.fn(),
    useEndpointOverview: vi.fn(),
    useUpdateEndpointConfig: vi.fn(),
    useVersion: vi.fn(),
    useHealth: vi.fn(),
  };
});

import {
  useEndpoints,
  useEndpoint,
  useEndpointUsers,
  useEndpointGroups,
  useEndpointOverview,
  useUpdateEndpointConfig,
  useVersion,
  useHealth,
} from '../api/queries';

// LogsTab uses useQuery via endpointLogsQueryOptions; mock the whole
// react-query useQuery to control its return for that page.
vi.mock('@tanstack/react-query', async () => {
  const actual = (await vi.importActual('@tanstack/react-query')) as Record<string, unknown>;
  return { ...actual, useQuery: vi.fn() };
});
import { useQuery } from '@tanstack/react-query';

const loadingResult = { data: undefined, isLoading: true, error: null };
const emptyEndpoints = { data: { totalResults: 0, endpoints: [] }, isLoading: false, error: null };
const noopMutation = {
  isPending: false,
  variables: undefined,
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  reset: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe('Phase G1 - LoadingSkeleton replaces Spinner on every surface', () => {
  it('EndpointsPage renders skeleton tiles (not Spinner) while loading', async () => {
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue(loadingResult);
    renderWithRouter(<EndpointsPage />, {
      initialUrl: '/endpoints',
      routePath: '/endpoints',
      validateSearch: (raw) => endpointsSearchSchema.parse(raw),
    });
    expect(await screen.findByTestId('endpoints-loading')).toBeInTheDocument();
    expect(screen.getByTestId('endpoints-skeleton-grid')).toBeInTheDocument();
    expect(screen.getAllByTestId('endpoints-skeleton').length).toBeGreaterThan(0);
    // Spinner removed -> the legacy "Loading endpoints..." label must
    // not be in the document.
    expect(screen.queryByText('Loading endpoints...')).not.toBeInTheDocument();
  });

  it('EndpointDetailPage renders header+tabs+content skeleton bands while loading', async () => {
    (useEndpoint as ReturnType<typeof vi.fn>).mockReturnValue(loadingResult);
    renderWithRouter(<EndpointDetailPage endpointId="ep-1" />, {
      initialUrl: '/endpoints/ep-1',
      routePath: '/endpoints/$endpointId',
    });
    expect(await screen.findByTestId('endpoint-detail-loading')).toBeInTheDocument();
    expect(screen.getByTestId('endpoint-detail-skeleton-header')).toBeInTheDocument();
    expect(screen.getByTestId('endpoint-detail-skeleton-tabs')).toBeInTheDocument();
    expect(screen.getByTestId('endpoint-detail-skeleton-content')).toBeInTheDocument();
    expect(screen.queryByText('Loading endpoint...')).not.toBeInTheDocument();
  });

  it('UsersTab renders row-shaped skeleton (not Spinner) while loading', async () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue(loadingResult);
    renderWithRouter(<UsersTab endpointId="ep-1" />, {
      initialUrl: '/endpoints/ep-1/users',
      routePath: '/endpoints/$endpointId/users',
      validateSearch: (raw) => usersSearchSchema.parse(raw),
    });
    expect(await screen.findByTestId('users-loading')).toBeInTheDocument();
    expect(screen.getByTestId('users-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Loading users...')).not.toBeInTheDocument();
  });

  it('GroupsTab renders row-shaped skeleton (not Spinner) while loading', async () => {
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue(loadingResult);
    renderWithRouter(<GroupsTab endpointId="ep-1" />, {
      initialUrl: '/endpoints/ep-1/groups',
      routePath: '/endpoints/$endpointId/groups',
      validateSearch: (raw) => groupsSearchSchema.parse(raw),
    });
    expect(await screen.findByTestId('groups-loading')).toBeInTheDocument();
    expect(screen.getByTestId('groups-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Loading groups...')).not.toBeInTheDocument();
  });

  it('LogsTab renders row-shaped skeleton (not Spinner) while loading', async () => {
    (useQuery as ReturnType<typeof vi.fn>).mockReturnValue(loadingResult);
    renderWithRouter(<LogsTab endpointId="ep-1" />, {
      initialUrl: '/endpoints/ep-1/logs',
      routePath: '/endpoints/$endpointId/logs',
      validateSearch: (raw) => logsSearchSchema.parse(raw),
    });
    expect(await screen.findByTestId('logs-loading')).toBeInTheDocument();
    expect(screen.getByTestId('logs-tab-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Loading logs...')).not.toBeInTheDocument();
  });

  it('SettingsTab renders form-row skeleton (not Spinner) while loading', async () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue(loadingResult);
    (useUpdateEndpointConfig as ReturnType<typeof vi.fn>).mockReturnValue(noopMutation);
    renderWithRouter(<SettingsTab endpointId="ep-1" />, {
      initialUrl: '/endpoints/ep-1/settings',
      routePath: '/endpoints/$endpointId/settings',
    });
    expect(await screen.findByTestId('settings-loading')).toBeInTheDocument();
    expect(screen.getByTestId('settings-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('Loading settings...')).not.toBeInTheDocument();
  });

  it('SettingsPage renders card-grid skeleton (not Spinner) while loading', async () => {
    (useVersion as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isLoading: true });
    (useHealth as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isLoading: false });
    renderWithRouter(<SettingsPage />, {
      initialUrl: '/settings',
      routePath: '/settings',
    });
    expect(await screen.findByTestId('settings-page-loading')).toBeInTheDocument();
    expect(screen.getByTestId('settings-page-skeleton-grid')).toBeInTheDocument();
    expect(screen.getAllByTestId('settings-page-skeleton').length).toBeGreaterThan(0);
    // Generic "Loading..." Spinner label removed.
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('ManualProvisionPage renders header+picker+form skeleton bands while loading', async () => {
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue(loadingResult);
    renderWithRouter(<ManualProvisionPage />, {
      initialUrl: '/manual-provision',
      routePath: '/manual-provision',
    });
    expect(await screen.findByTestId('manual-provision-loading')).toBeInTheDocument();
    expect(screen.getByTestId('manual-provision-skeleton-header')).toBeInTheDocument();
    expect(screen.getByTestId('manual-provision-skeleton-picker')).toBeInTheDocument();
    expect(screen.getByTestId('manual-provision-skeleton-form')).toBeInTheDocument();
    expect(screen.queryByText('Loading endpoints...')).not.toBeInTheDocument();
  });
});

describe('Phase G2 - EmptyState primitive replaces ad-hoc Text on every surface', () => {
  it('EndpointsPage shows EmptyState with no-CTA copy when zero endpoints', async () => {
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue(emptyEndpoints);
    renderWithRouter(<EndpointsPage />, {
      initialUrl: '/endpoints',
      routePath: '/endpoints',
      validateSearch: (raw) => endpointsSearchSchema.parse(raw),
    });
    expect(await screen.findByTestId('endpoints-empty')).toBeInTheDocument();
    expect(screen.getByText('No endpoints yet')).toBeInTheDocument();
  });

  it('EndpointsPage shows filtered EmptyState with Reset filter CTA when filter excludes all', async () => {
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        totalResults: 1,
        endpoints: [
          { id: 'ep-1', name: 'prod', displayName: 'Production', active: true, scimBasePath: '', createdAt: '', updatedAt: '', _links: {} },
        ],
      },
      isLoading: false,
      error: null,
    });
    renderWithRouter(<EndpointsPage />, {
      initialUrl: '/endpoints?q=zzz',
      routePath: '/endpoints',
      validateSearch: (raw) => endpointsSearchSchema.parse(raw),
    });
    expect(await screen.findByTestId('endpoints-empty-filtered')).toBeInTheDocument();
    expect(screen.getByTestId('endpoints-empty-filtered-action')).toHaveTextContent(/Reset filter/i);
  });

  it('UsersTab shows EmptyState when zero users', async () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { Resources: [], totalResults: 0 },
      isLoading: false,
      error: null,
    });
    renderWithRouter(<UsersTab endpointId="ep-1" />, {
      initialUrl: '/endpoints/ep-1/users',
      routePath: '/endpoints/$endpointId/users',
      validateSearch: (raw) => usersSearchSchema.parse(raw),
    });
    expect(await screen.findByTestId('users-empty')).toBeInTheDocument();
    expect(screen.getByText(/No users in this endpoint/i)).toBeInTheDocument();
  });

  it('GroupsTab shows EmptyState when zero groups', async () => {
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { Resources: [], totalResults: 0 },
      isLoading: false,
      error: null,
    });
    renderWithRouter(<GroupsTab endpointId="ep-1" />, {
      initialUrl: '/endpoints/ep-1/groups',
      routePath: '/endpoints/$endpointId/groups',
      validateSearch: (raw) => groupsSearchSchema.parse(raw),
    });
    expect(await screen.findByTestId('groups-empty')).toBeInTheDocument();
    expect(screen.getByText(/No groups in this endpoint/i)).toBeInTheDocument();
  });

  it('LogsTab shows unfiltered EmptyState when zero logs and no filter', async () => {
    (useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
      error: null,
    });
    renderWithRouter(<LogsTab endpointId="ep-1" />, {
      initialUrl: '/endpoints/ep-1/logs',
      routePath: '/endpoints/$endpointId/logs',
      validateSearch: (raw) => logsSearchSchema.parse(raw),
    });
    expect(await screen.findByTestId('logs-tab-empty')).toBeInTheDocument();
    expect(screen.getByText(/No request logs yet/i)).toBeInTheDocument();
  });

  it('LogsTab shows filtered EmptyState with Reset filter CTA when zero logs and filter active', async () => {
    (useQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { items: [], total: 0 },
      isLoading: false,
      error: null,
    });
    renderWithRouter(<LogsTab endpointId="ep-1" />, {
      initialUrl: '/endpoints/ep-1/logs?urlContains=zzz',
      routePath: '/endpoints/$endpointId/logs',
      validateSearch: (raw) => logsSearchSchema.parse(raw),
    });
    expect(await screen.findByTestId('logs-tab-empty-filtered')).toBeInTheDocument();
    expect(screen.getByTestId('logs-tab-empty-filtered-action')).toHaveTextContent(/Reset filter/i);
  });
});

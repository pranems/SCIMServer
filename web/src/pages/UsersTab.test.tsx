/**
 * UsersTab tests.
 *
 * Phase A3: pagination state lives in the URL via usersSearchSchema.
 * Tests now mount the component inside a router context (via
 * renderWithRouter) seeded with the matching routePath + validateSearch
 * so useSearch / useNavigate hooks resolve.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { UsersTab } from './UsersTab';
import { renderWithRouter } from '../test/router-test-utils';
import { usersSearchSchema } from '../routes/search-schemas';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return { ...actual, useEndpointUsers: vi.fn() };
});

import { useEndpointUsers } from '../api/queries';
import { usePreferencesStore, PREFERENCES_DEFAULTS } from '../store/preferences-store';

function wrap(
  ui: React.ReactElement,
  initialUrl = '/endpoints/ep-1/users',
) {
  return renderWithRouter(ui, {
    initialUrl,
    routePath: '/endpoints/$endpointId/users',
    validateSearch: (raw) => usersSearchSchema.parse(raw),
  });
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
  beforeEach(() => {
    vi.clearAllMocks();
    // Phase N4: each test starts from default preferences (pageSize=20).
    usePreferencesStore.setState({ ...PREFERENCES_DEFAULTS });
    localStorage.clear();
  });

  it('shows loading state', async () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: true, error: null,
    });
    wrap(<UsersTab endpointId="ep-1" />);
    expect(await screen.findByTestId('users-loading')).toBeInTheDocument();
  });

  it('shows error state', async () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: false, error: new Error('Fail'),
    });
    wrap(<UsersTab endpointId="ep-1" />);
    expect(await screen.findByTestId('users-error')).toBeInTheDocument();
  });

  it('renders user table with correct columns', async () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockUsers, isLoading: false, error: null,
    });
    wrap(<UsersTab endpointId="ep-1" />);
    expect(await screen.findByText('alice@corp.com')).toBeInTheDocument();
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('3 users')).toBeInTheDocument();
  });

  it('shows active/inactive badges', async () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockUsers, isLoading: false, error: null,
    });
    wrap(<UsersTab endpointId="ep-1" />);
    await screen.findByText('alice@corp.com');
    const activeBadges = screen.getAllByText('Active');
    const inactiveBadges = screen.getAllByText('Inactive');
    expect(activeBadges.length).toBe(2);
    expect(inactiveBadges.length).toBe(1);
  });

  it('shows empty state when no users', async () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockUsers, totalResults: 0, Resources: [] },
      isLoading: false, error: null,
    });
    wrap(<UsersTab endpointId="ep-1" />);
    expect(await screen.findByText(/no users/i)).toBeInTheDocument();
  });

  it('shows pagination controls when totalResults > pageSize', async () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockUsers, totalResults: 50, itemsPerPage: 20 },
      isLoading: false, error: null,
    });
    wrap(<UsersTab endpointId="ep-1" />);
    expect(await screen.findByTestId('pagination')).toBeInTheDocument();
    expect(screen.getByText('Page 1')).toBeInTheDocument();
  });

  it('does not show pagination when all results fit on one page', async () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockUsers, isLoading: false, error: null,
    });
    wrap(<UsersTab endpointId="ep-1" />);
    await screen.findByText('alice@corp.com');
    expect(screen.queryByTestId('pagination')).not.toBeInTheDocument();
  });

  it('reads page from URL search params (?page=2 -> startIndex=21)', async () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockUsers, totalResults: 50, itemsPerPage: 20 },
      isLoading: false, error: null,
    });
    wrap(<UsersTab endpointId="ep-1" />, '/endpoints/ep-1/users?page=2');
    await screen.findByTestId('pagination');
    expect(useEndpointUsers).toHaveBeenCalledWith(
      'ep-1',
      expect.objectContaining({ startIndex: 21, count: 20 }),
    );
  });

  it('next button navigates to next page (URL changes -> startIndex increments)', async () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockUsers, totalResults: 50, itemsPerPage: 20 },
      isLoading: false, error: null,
    });
    wrap(<UsersTab endpointId="ep-1" />);
    const nextBtn = await screen.findByTestId('pagination-next');
    fireEvent.click(nextBtn);
    // After URL change the hook is invoked again with startIndex=21.
    await waitFor(() => {
      expect(useEndpointUsers).toHaveBeenCalledWith(
        'ep-1',
        expect.objectContaining({ startIndex: 21 }),
      );
    });
  });

  // ==========================================================================
  // Phase N3 - Export button (CSV / JSON / NDJSON) wired into the toolbar
  // ==========================================================================
  it('renders ExportSplitButton in the toolbar when users exist', async () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockUsers, isLoading: false, error: null,
    });
    wrap(<UsersTab endpointId="ep-1" />);
    expect(await screen.findByTestId('export-button')).toBeInTheDocument();
    expect(screen.getByTestId('export-button')).not.toBeDisabled();
  });

  it('does NOT render ExportSplitButton when empty (empty state takes over)', async () => {
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockUsers, totalResults: 0, Resources: [] },
      isLoading: false, error: null,
    });
    wrap(<UsersTab endpointId="ep-1" />);
    await screen.findByText(/no users/i);
    expect(screen.queryByTestId('export-button')).not.toBeInTheDocument();
  });

  it('clicking CSV in the export menu invokes triggerCsvDownload with flattened user rows', async () => {
    const csvExportModule = await import('../utils/csv-export');
    const csvSpy = vi.spyOn(csvExportModule, 'triggerCsvDownload').mockImplementation(() => {});

    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockUsers, isLoading: false, error: null,
    });
    wrap(<UsersTab endpointId="ep-1" />);
    fireEvent.click(await screen.findByTestId('export-button'));
    fireEvent.click(await screen.findByTestId('export-menu-csv'));

    expect(csvSpy).toHaveBeenCalledTimes(1);
    const [filename, body] = csvSpy.mock.calls[0];
    expect(filename).toMatch(/^users-ep-1-\d{8}T\d{6}Z\.csv$/);
    // Header row + the 3 mock users rendered with the documented column set.
    expect(body).toContain('id,userName,displayName,active,created,lastModified');
    expect(body).toContain('u1,alice@corp.com,Alice Smith,true');
    expect(body).toContain('u3,charlie@corp.com,Charlie Brown,false');

    csvSpy.mockRestore();
  });

  // ==========================================================================
  // Phase N4 - honor defaultPageSize preference when URL has no ?pageSize
  // ==========================================================================
  it('honors preferences-store defaultPageSize when URL has no ?pageSize override', async () => {
    usePreferencesStore.setState({ ...PREFERENCES_DEFAULTS, defaultPageSize: 50 });
    (useEndpointUsers as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockUsers, totalResults: 100, itemsPerPage: 50 },
      isLoading: false, error: null,
    });
    wrap(<UsersTab endpointId="ep-1" />);
    await screen.findByText('alice@corp.com');
    expect(useEndpointUsers).toHaveBeenCalledWith(
      'ep-1',
      expect.objectContaining({ startIndex: 1, count: 50 }),
    );
  });
});

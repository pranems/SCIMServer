/**
 * GroupsTab tests.
 *
 * Phase A3: pagination via groupsSearchSchema URL search params.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { GroupsTab } from './GroupsTab';
import { renderWithRouter } from '../test/router-test-utils';
import { groupsSearchSchema } from '../routes/search-schemas';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return { ...actual, useEndpointGroups: vi.fn() };
});

import { useEndpointGroups } from '../api/queries';
import { ScimApiError } from '../api/scim-error';
import { usePreferencesStore, PREFERENCES_DEFAULTS } from '../store/preferences-store';

function wrap(
  ui: React.ReactElement,
  initialUrl = '/endpoints/ep-1/groups',
) {
  return renderWithRouter(ui, {
    initialUrl,
    routePath: '/endpoints/$endpointId/groups',
    validateSearch: (raw) => groupsSearchSchema.parse(raw),
  });
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
  beforeEach(() => {
    vi.clearAllMocks();
    // Phase N4: each test starts from default preferences (pageSize=20).
    usePreferencesStore.setState({ ...PREFERENCES_DEFAULTS });
    localStorage.clear();
  });

  it('shows loading state', async () => {
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: true, error: null,
    });
    wrap(<GroupsTab endpointId="ep-1" />);
    expect(await screen.findByTestId('groups-loading')).toBeInTheDocument();
  });

  it('shows error state', async () => {
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: false, error: new Error('Fail'),
    });
    wrap(<GroupsTab endpointId="ep-1" />);
    expect(await screen.findByTestId('groups-error')).toBeInTheDocument();
  });

  // v0.53.4 regression guard: a user-only endpoint 404s /Groups. The tab
  // must render a contained, explanatory empty state (not the generic
  // failure, and never the fatal route boundary) when a stale deep-link
  // or refresh lands here.
  it('shows a friendly "Groups not supported" state for a resource-type-unsupported 404', async () => {
    const err = new ScimApiError({
      status: 404,
      scimType: 'noTarget',
      detail: 'Resource type "Group" is not supported by endpoint "x".',
      rawBody: {
        'urn:ietf:params:scim:api:messages:2.0:Diagnostics': {
          errorCode: 'RESOURCE_TYPE_NOT_SUPPORTED',
        },
      },
    });
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: false, error: err,
    });
    wrap(<GroupsTab endpointId="ep-1" />);
    expect(await screen.findByTestId('groups-unsupported')).toBeInTheDocument();
    expect(screen.queryByTestId('groups-error')).not.toBeInTheDocument();
  });

  it('renders group table with display names and member counts', async () => {
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockGroups, isLoading: false, error: null,
    });
    wrap(<GroupsTab endpointId="ep-1" />);
    expect(await screen.findByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Marketing')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('2 groups')).toBeInTheDocument();
  });

  it('shows empty state when no groups', async () => {
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockGroups, totalResults: 0, Resources: [] },
      isLoading: false, error: null,
    });
    wrap(<GroupsTab endpointId="ep-1" />);
    expect(await screen.findByText(/no groups/i)).toBeInTheDocument();
  });

  it('reads page from URL search params (?page=2 -> startIndex=21)', async () => {
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockGroups, totalResults: 50, itemsPerPage: 20 },
      isLoading: false, error: null,
    });
    wrap(<GroupsTab endpointId="ep-1" />, '/endpoints/ep-1/groups?page=2');
    await screen.findByTestId('groups-pagination');
    expect(useEndpointGroups).toHaveBeenCalledWith(
      'ep-1',
      expect.objectContaining({ startIndex: 21, count: 20 }),
    );
  });

  // ==========================================================================
  // Phase N3 - Export button (CSV / JSON / NDJSON) wired into the toolbar
  // ==========================================================================
  it('renders ExportSplitButton in the toolbar when groups exist', async () => {
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockGroups, isLoading: false, error: null,
    });
    wrap(<GroupsTab endpointId="ep-1" />);
    expect(await screen.findByTestId('export-button')).toBeInTheDocument();
    expect(screen.getByTestId('export-button')).not.toBeDisabled();
  });

  it('clicking CSV in the export menu invokes triggerCsvDownload with flattened group rows', async () => {
    const csvExportModule = await import('../utils/csv-export');
    const csvSpy = vi.spyOn(csvExportModule, 'triggerCsvDownload').mockImplementation(() => {});

    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockGroups, isLoading: false, error: null,
    });
    wrap(<GroupsTab endpointId="ep-1" />);
    fireEvent.click(await screen.findByTestId('export-button'));
    fireEvent.click(await screen.findByTestId('export-menu-csv'));

    expect(csvSpy).toHaveBeenCalledTimes(1);
    const [filename, body] = csvSpy.mock.calls[0];
    expect(filename).toMatch(/^groups-ep-1-\d{8}T\d{6}Z\.csv$/);
    expect(body).toContain('id,displayName,memberCount,created');
    expect(body).toContain('g1,Engineering,2,');
    expect(body).toContain('g2,Marketing,0,');

    csvSpy.mockRestore();
  });

  // ==========================================================================
  // Phase N4 - honor defaultPageSize preference when URL has no ?pageSize
  // ==========================================================================
  it('honors preferences-store defaultPageSize when URL has no ?pageSize override', async () => {
    usePreferencesStore.setState({ ...PREFERENCES_DEFAULTS, defaultPageSize: 50 });
    (useEndpointGroups as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockGroups, totalResults: 100, itemsPerPage: 50 },
      isLoading: false, error: null,
    });
    wrap(<GroupsTab endpointId="ep-1" />);
    await screen.findByText('Engineering');
    expect(useEndpointGroups).toHaveBeenCalledWith(
      'ep-1',
      expect.objectContaining({ startIndex: 1, count: 50 }),
    );
  });
});

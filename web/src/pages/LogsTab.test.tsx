/**
 * LogsTab tests.
 *
 * Phase A3: pagination + urlContains filter via logsSearchSchema URL
 * search params.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithRouter } from '../test/router-test-utils';
import { logsSearchSchema } from '../routes/search-schemas';

// Mock useQuery before importing LogsTab so the hook is replaced everywhere.
const mockUseQuery = vi.fn();
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return { ...actual, useQuery: (...args: any[]) => mockUseQuery(...args) };
});

import { LogsTab } from './LogsTab';
import { usePreferencesStore, PREFERENCES_DEFAULTS } from '../store/preferences-store';

function wrap(
  ui: React.ReactElement,
  initialUrl = '/endpoints/ep-1/logs',
) {
  return renderWithRouter(ui, {
    initialUrl,
    routePath: '/endpoints/$endpointId/logs',
    validateSearch: (raw) => logsSearchSchema.parse(raw),
  });
}

describe('LogsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Phase N4: each test starts from default preferences (pageSize=20).
    usePreferencesStore.setState({ ...PREFERENCES_DEFAULTS });
    localStorage.clear();
  });

  it('shows loading state', async () => {
    mockUseQuery.mockReturnValue({
      data: undefined, isLoading: true, error: null,
    });
    wrap(<LogsTab endpointId="ep-1" />);
    expect(await screen.findByTestId('logs-loading')).toBeInTheDocument();
  });

  it('shows error state', async () => {
    mockUseQuery.mockReturnValue({
      data: undefined, isLoading: false, error: new Error('Network'),
    });
    wrap(<LogsTab endpointId="ep-1" />);
    expect(await screen.findByTestId('logs-error')).toBeInTheDocument();
  });

  it('renders log entries with method/status/url', async () => {
    mockUseQuery.mockReturnValue({
      data: {
        total: 2,
        items: [
          { id: 'l1', method: 'POST', url: '/Users', status: 201, durationMs: 42, createdAt: '2026-05-01T10:00:00Z' },
          { id: 'l2', method: 'GET', url: '/Users', status: 200, durationMs: 8, createdAt: '2026-05-01T09:00:00Z' },
        ],
      },
      isLoading: false, error: null,
    });
    wrap(<LogsTab endpointId="ep-1" />);
    expect(await screen.findByText('POST')).toBeInTheDocument();
    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.getByText('201')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('2 logs')).toBeInTheDocument();
  });

  it('shows empty state', async () => {
    mockUseQuery.mockReturnValue({
      data: { total: 0, items: [] },
      isLoading: false, error: null,
    });
    wrap(<LogsTab endpointId="ep-1" />);
    expect(await screen.findByText(/no request logs/i)).toBeInTheDocument();
  });

  it('reads urlContains and page from URL search params', async () => {
    mockUseQuery.mockReturnValue({
      data: { total: 0, items: [] },
      isLoading: false, error: null,
    });
    wrap(
      <LogsTab endpointId="ep-1" />,
      '/endpoints/ep-1/logs?page=3&urlContains=Users',
    );
    await screen.findByText(/no request logs/i);
    // The hook is called with (endpointId, page, urlContains, pageSize) -
    // assert via the queryKey that mockUseQuery received.
    const lastCall = mockUseQuery.mock.calls.at(-1) ?? [];
    const queryArg = lastCall[0] as { queryKey: unknown[] };
    expect(queryArg.queryKey).toEqual(['endpoint-logs', 'ep-1', 3, 20, 'Users']);
  });

  // ==========================================================================
  // Phase N3 - Export button (CSV / JSON / NDJSON) wired into the toolbar
  // ==========================================================================
  it('renders ExportSplitButton in the toolbar when logs exist', async () => {
    mockUseQuery.mockReturnValue({
      data: {
        total: 1,
        items: [
          { id: 'l1', method: 'POST', url: '/Users', status: 201, durationMs: 42, createdAt: '2026-05-01T10:00:00Z' },
        ],
      },
      isLoading: false, error: null,
    });
    wrap(<LogsTab endpointId="ep-1" />);
    expect(await screen.findByTestId('export-button')).toBeInTheDocument();
    expect(screen.getByTestId('export-button')).not.toBeDisabled();
  });

  it('CSV export invokes triggerCsvDownload with flattened log rows', async () => {
    const csvExportModule = await import('../utils/csv-export');
    const csvSpy = vi.spyOn(csvExportModule, 'triggerCsvDownload').mockImplementation(() => {});

    mockUseQuery.mockReturnValue({
      data: {
        total: 2,
        items: [
          { id: 'l1', method: 'POST', url: '/Users', status: 201, durationMs: 42, createdAt: '2026-05-01T10:00:00Z' },
          { id: 'l2', method: 'GET', url: '/Users', status: 200, durationMs: 8, createdAt: '2026-05-01T09:00:00Z' },
        ],
      },
      isLoading: false, error: null,
    });
    wrap(<LogsTab endpointId="ep-1" />);
    fireEvent.click(await screen.findByTestId('export-button'));
    fireEvent.click(await screen.findByTestId('export-menu-csv'));

    expect(csvSpy).toHaveBeenCalledTimes(1);
    const [filename, body] = csvSpy.mock.calls[0];
    expect(filename).toMatch(/^logs-ep-1-\d{8}T\d{6}Z\.csv$/);
    expect(body).toContain('id,method,url,status,durationMs,createdAt');
    expect(body).toContain('l1,POST,/Users,201,42,2026-05-01T10:00:00Z');
    expect(body).toContain('l2,GET,/Users,200,8,2026-05-01T09:00:00Z');

    csvSpy.mockRestore();
  });

  // ==========================================================================
  // Phase N4 - honor defaultPageSize preference when URL has no ?pageSize
  // ==========================================================================
  it('honors preferences-store defaultPageSize when URL has no ?pageSize override', async () => {
    usePreferencesStore.setState({ ...PREFERENCES_DEFAULTS, defaultPageSize: 50 });
    mockUseQuery.mockReturnValue({
      data: { total: 0, items: [] },
      isLoading: false, error: null,
    });
    wrap(<LogsTab endpointId="ep-1" />);
    await screen.findByText(/no request logs/i);
    // Hook is called via useQuery({queryKey: ['endpoint-logs', endpointId, page, pageSize, urlContains]}).
    const lastCall = mockUseQuery.mock.calls.at(-1) ?? [];
    const queryArg = lastCall[0] as { queryKey: unknown[] };
    expect(queryArg.queryKey).toEqual(['endpoint-logs', 'ep-1', 1, 50, '']);
  });
});

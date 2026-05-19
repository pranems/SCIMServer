/**
 * LogsPage tests.
 *
 * Phase A3: filter state via globalLogsSearchSchema URL search params.
 * Phase D5: endpoint / status / time-range filters + DetailDrawer + R4 polish.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithRouter } from '../test/router-test-utils';
import { globalLogsSearchSchema } from '../routes/search-schemas';

const mockUseGlobalLogs = vi.fn();
const mockUseGlobalLog = vi.fn();
const mockUseEndpoints = vi.fn();

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useGlobalLogs: (...args: unknown[]) => mockUseGlobalLogs(...args),
    useGlobalLog: (...args: unknown[]) => mockUseGlobalLog(...args),
    useEndpoints: (...args: unknown[]) => mockUseEndpoints(...args),
  };
});

import { LogsPage } from './LogsPage';

function wrap(ui: React.ReactElement, initialUrl = '/logs') {
  return renderWithRouter(ui, {
    initialUrl,
    routePath: '/logs',
    validateSearch: (raw) => globalLogsSearchSchema.parse(raw),
  });
}

const sampleEndpoints = {
  totalResults: 2,
  endpoints: [
    { id: 'ep-prod', name: 'production', displayName: 'Production', active: true },
    { id: 'ep-dev', name: 'dev', displayName: 'Dev', active: true },
  ],
};

const sampleLogs = {
  total: 1,
  items: [
    {
      id: 'l1',
      method: 'GET',
      url: '/scim/endpoints/ep-prod/Users',
      status: 200,
      durationMs: 5,
      createdAt: '2026-05-01T10:00:00Z',
    },
  ],
};

describe('LogsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Sensible defaults for every test - individual tests override.
    mockUseEndpoints.mockReturnValue({ data: sampleEndpoints, isLoading: false, error: null });
    mockUseGlobalLog.mockReturnValue({ data: undefined, isLoading: false, error: null });
  });

  // ─── Existing baseline behaviors ─────────────────────────────────

  it('shows skeleton loading state (R4 - replaces Spinner)', async () => {
    mockUseGlobalLogs.mockReturnValue({ data: undefined, isLoading: true, error: null });
    wrap(<LogsPage />);
    // R4 - LoadingSkeleton replaces the legacy Spinner.
    expect(await screen.findByTestId('logs-loading-skeleton')).toBeInTheDocument();
  });

  it('renders log entries', async () => {
    mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
    wrap(<LogsPage />);
    expect(await screen.findByTestId('global-logs-page')).toBeInTheDocument();
    expect(screen.getByText('GET')).toBeInTheDocument();
    // The row id testid is unique; "200" alone collides with the
    // status filter chip. Assert the row exists instead.
    expect(screen.getByTestId('logs-row-l1')).toBeInTheDocument();
  });

  it('shows EmptyState (R4 - replaces "No logs found" text) when total=0', async () => {
    mockUseGlobalLogs.mockReturnValue({ data: { total: 0, items: [] }, isLoading: false, error: null });
    wrap(<LogsPage />);
    // R4 - EmptyState primitive.
    expect(await screen.findByTestId('logs-empty')).toBeInTheDocument();
    expect(screen.getByTestId('logs-empty-title')).toHaveTextContent(
      /No logs match these filters/i,
    );
  });

  // ─── Phase D5: new filter dimensions ─────────────────────────────

  describe('Phase D5 - filters', () => {
    it('renders the toolbar with all four filter slots', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      wrap(<LogsPage />);
      expect(await screen.findByTestId('logs-toolbar')).toBeInTheDocument();
      expect(screen.getByTestId('logs-search')).toBeInTheDocument();
      expect(screen.getByTestId('logs-endpoint-select')).toBeInTheDocument();
      expect(screen.getByTestId('logs-status-chips')).toBeInTheDocument();
      expect(screen.getByTestId('logs-time-chips')).toBeInTheDocument();
    });

    it('passes endpointId from URL into useGlobalLogs', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      wrap(<LogsPage />, '/logs?endpointId=ep-prod');
      await screen.findByTestId('global-logs-page');
      const args = mockUseGlobalLogs.mock.calls.at(-1)?.[0];
      expect(args).toMatchObject({ endpointId: 'ep-prod' });
    });

    it('passes status from URL into useGlobalLogs', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      wrap(<LogsPage />, '/logs?status=400');
      await screen.findByTestId('global-logs-page');
      const args = mockUseGlobalLogs.mock.calls.at(-1)?.[0];
      expect(args).toMatchObject({ status: 400 });
    });

    it('derives ISO since from timeRange=24h', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      wrap(<LogsPage />, '/logs?timeRange=24h');
      await screen.findByTestId('global-logs-page');
      const args = mockUseGlobalLogs.mock.calls.at(-1)?.[0];
      expect(typeof args?.since).toBe('string');
      // Within (now - 24h - 5s, now - 24h + 5s).
      const sinceMs = Date.parse(args.since as string);
      const expected = Date.now() - 24 * 60 * 60 * 1000;
      expect(Math.abs(sinceMs - expected)).toBeLessThan(5000);
    });

    it('shows reset-filters button only when filters are active', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      const { unmount } = wrap(<LogsPage />, '/logs?status=400');
      expect(await screen.findByTestId('logs-reset-filters')).toBeInTheDocument();
      unmount();

      vi.clearAllMocks();
      mockUseEndpoints.mockReturnValue({ data: sampleEndpoints, isLoading: false, error: null });
      mockUseGlobalLog.mockReturnValue({ data: undefined, isLoading: false, error: null });
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      wrap(<LogsPage />);
      await screen.findByTestId('global-logs-page');
      expect(screen.queryByTestId('logs-reset-filters')).not.toBeInTheDocument();
    });
  });

  // ─── Phase D5: DetailDrawer ──────────────────────────────────────

  describe('Phase D5 - DetailDrawer', () => {
    it('opens DetailDrawer when ?detail=<id> is in URL', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      mockUseGlobalLog.mockReturnValue({
        data: {
          id: 'l1',
          method: 'GET',
          url: '/scim/endpoints/ep-prod/Users',
          status: 200,
          durationMs: 5,
          createdAt: '2026-05-01T10:00:00Z',
          requestHeaders: { 'x-trace-id': 'abc' },
          requestBody: { foo: 'bar' },
          responseHeaders: { etag: 'W/"v1"' },
          responseBody: { Resources: [] },
        },
        isLoading: false,
        error: null,
      });
      wrap(<LogsPage />, '/logs?detail=l1');
      // Drawer renders the parsed detail object - assert at least one
      // section title is present.
      expect(await screen.findByText(/Request headers/i)).toBeInTheDocument();
      expect(screen.getByText(/Response body/i)).toBeInTheDocument();
    });

    it('shows skeleton inside drawer while detail is loading', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      mockUseGlobalLog.mockReturnValue({ data: undefined, isLoading: true, error: null });
      wrap(<LogsPage />, '/logs?detail=l1');
      expect(await screen.findByTestId('logs-detail-skeleton')).toBeInTheDocument();
    });

    it('passes the detail id from URL into useGlobalLog', async () => {
      mockUseGlobalLogs.mockReturnValue({ data: sampleLogs, isLoading: false, error: null });
      mockUseGlobalLog.mockReturnValue({ data: undefined, isLoading: false, error: null });
      wrap(<LogsPage />, '/logs?detail=log-42');
      await screen.findByTestId('global-logs-page');
      const args = mockUseGlobalLog.mock.calls.at(-1) ?? [];
      expect(args[0]).toBe('log-42');
    });
  });
});

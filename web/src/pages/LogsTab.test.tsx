/**
 * LogsTab tests.
 *
 * Phase A3: pagination + urlContains filter via logsSearchSchema URL
 * search params.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test/router-test-utils';
import { logsSearchSchema } from '../routes/search-schemas';

// Mock useQuery before importing LogsTab so the hook is replaced everywhere.
const mockUseQuery = vi.fn();
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return { ...actual, useQuery: (...args: any[]) => mockUseQuery(...args) };
});

import { LogsTab } from './LogsTab';

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
  beforeEach(() => vi.clearAllMocks());

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
});

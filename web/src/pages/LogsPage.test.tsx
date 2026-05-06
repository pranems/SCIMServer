/**
 * LogsPage tests.
 *
 * Phase A3: filter state via globalLogsSearchSchema URL search params.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test/router-test-utils';
import { globalLogsSearchSchema } from '../routes/search-schemas';

const mockUseQuery = vi.fn();
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return { ...actual, useQuery: (...args: any[]) => mockUseQuery(...args) };
});

import { LogsPage } from './LogsPage';

function wrap(ui: React.ReactElement, initialUrl = '/logs') {
  return renderWithRouter(ui, {
    initialUrl,
    routePath: '/logs',
    validateSearch: (raw) => globalLogsSearchSchema.parse(raw),
  });
}

describe('LogsPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading state', async () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    wrap(<LogsPage />);
    expect(await screen.findByTestId('global-logs-loading')).toBeInTheDocument();
  });

  it('renders log entries', async () => {
    mockUseQuery.mockReturnValue({
      data: {
        total: 1,
        items: [
          { id: 'l1', method: 'GET', url: '/Users', status: 200, durationMs: 5, createdAt: '2026-05-01T10:00:00Z' },
        ],
      },
      isLoading: false, error: null,
    });
    wrap(<LogsPage />);
    expect(await screen.findByTestId('global-logs-page')).toBeInTheDocument();
    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
  });

  it('shows empty state', async () => {
    mockUseQuery.mockReturnValue({ data: { total: 0, items: [] }, isLoading: false, error: null });
    wrap(<LogsPage />);
    expect(await screen.findByText('No logs found.')).toBeInTheDocument();
  });

  it('reads urlContains from URL search params (queryKey changes)', async () => {
    mockUseQuery.mockReturnValue({ data: { total: 0, items: [] }, isLoading: false, error: null });
    wrap(<LogsPage />, '/logs?urlContains=Users');
    await screen.findByText('No logs found.');
    const lastCall = mockUseQuery.mock.calls.at(-1) ?? [];
    const queryArg = lastCall[0] as { queryKey: unknown[] };
    expect(queryArg.queryKey).toEqual(['global-logs', 'Users']);
  });
});

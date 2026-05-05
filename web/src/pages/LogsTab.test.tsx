/**
 * LogsTab tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';

// We need to mock the useQuery call inside LogsTab. The cleanest way is to
// mock the react-query useQuery hook at module level.
const mockUseQuery = vi.fn();
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return { ...actual, useQuery: (...args: any[]) => mockUseQuery(...args) };
});

import { LogsTab } from './LogsTab';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>
    </QueryClientProvider>,
  );
}

describe('LogsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading state', () => {
    mockUseQuery.mockReturnValue({
      data: undefined, isLoading: true, error: null,
    });
    wrap(<LogsTab endpointId="ep-1" />);
    expect(screen.getByTestId('logs-loading')).toBeInTheDocument();
  });

  it('shows error state', () => {
    mockUseQuery.mockReturnValue({
      data: undefined, isLoading: false, error: new Error('Network'),
    });
    wrap(<LogsTab endpointId="ep-1" />);
    expect(screen.getByTestId('logs-error')).toBeInTheDocument();
  });

  it('renders log entries with method/status/url', () => {
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
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.getByText('201')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('2 logs')).toBeInTheDocument();
  });

  it('shows empty state', () => {
    mockUseQuery.mockReturnValue({
      data: { total: 0, items: [] },
      isLoading: false, error: null,
    });
    wrap(<LogsTab endpointId="ep-1" />);
    expect(screen.getByText(/no request logs/i)).toBeInTheDocument();
  });
});

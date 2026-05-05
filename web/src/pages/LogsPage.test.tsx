/**
 * LogsPage tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';

const mockUseQuery = vi.fn();
vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return { ...actual, useQuery: (...args: any[]) => mockUseQuery(...args) };
});

import { LogsPage } from './LogsPage';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>
    </QueryClientProvider>,
  );
}

describe('LogsPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading state', () => {
    mockUseQuery.mockReturnValue({ data: undefined, isLoading: true, error: null });
    wrap(<LogsPage />);
    expect(screen.getByTestId('global-logs-loading')).toBeInTheDocument();
  });

  it('renders log entries', () => {
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
    expect(screen.getByTestId('global-logs-page')).toBeInTheDocument();
    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.getByText('200')).toBeInTheDocument();
  });

  it('shows empty state', () => {
    mockUseQuery.mockReturnValue({ data: { total: 0, items: [] }, isLoading: false, error: null });
    wrap(<LogsPage />);
    expect(screen.getByText('No logs found.')).toBeInTheDocument();
  });
});

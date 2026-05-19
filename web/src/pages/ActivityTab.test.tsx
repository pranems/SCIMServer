/**
 * ActivityTab tests (Phase D2).
 *
 * Asserts the data-completeness contract per
 * UI_REDESIGN_REMAINING_GAPS_PLAN.md S7.2:
 *   - LoadingSkeleton on isLoading (not Spinner)
 *   - rendered rows from useEndpointActivity
 *   - EmptyState when zero activities (with reset CTA when filters active)
 *   - filter inputs drive onSearchChange (URL search params)
 *   - error path renders an error block
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { ActivityTab } from './ActivityTab';
import type { ActivityResponse } from '../api/queries';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpointActivity: vi.fn(),
  };
});

import { useEndpointActivity } from '../api/queries';

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>
    </QueryClientProvider>,
  );
}

const mockResponse: ActivityResponse = {
  activities: [
    {
      id: 'a1',
      type: 'user',
      severity: 'success',
      timestamp: '2026-05-08T10:00:00Z',
      icon: '👤',
      message: 'User created',
      details: 'POST /Users alice@x.com',
    },
    {
      id: 'a2',
      type: 'group',
      severity: 'info',
      timestamp: '2026-05-08T10:01:00Z',
      icon: '👥',
      message: 'Group updated',
      details: 'PATCH /Groups/g1',
    },
  ],
  pagination: { page: 1, limit: 20, total: 2, pages: 1 },
  filters: {
    types: ['user', 'group', 'system'],
    severities: ['info', 'success', 'warning', 'error'],
  },
};

const baseSearch = { page: 1, pageSize: 20 };

describe('ActivityTab', () => {
  let onSearchChange: ReturnType<typeof vi.fn>;

  // The component prop is typed as `(partial: ...) => void`. vi.fn()
  // alone returns `Mock<Procedure | Constructable>` which TypeScript
  // refuses to assign to that narrower signature. Cast the mock to
  // the prop type when passing it through; tests still inspect
  // onSearchChange.mock.calls so we lose nothing.
  const onChangeProp = (): ((partial: Partial<{ page: number; pageSize: number; type?: 'user' | 'group' | 'system'; severity?: 'success' | 'info' | 'warning' | 'error'; search?: string }>) => void) =>
    onSearchChange as unknown as (partial: Partial<{ page: number; pageSize: number; type?: 'user' | 'group' | 'system'; severity?: 'success' | 'info' | 'warning' | 'error'; search?: string }>) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    onSearchChange = vi.fn();
  });

  it('renders LoadingSkeleton (not Spinner) while loading - G1 pattern', () => {
    (useEndpointActivity as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });

    renderWithProviders(
      <ActivityTab endpointId="ep-1" search={baseSearch} onSearchChange={onChangeProp()} />,
    );

    expect(screen.getByTestId('tab-activity')).toBeInTheDocument();
    expect(screen.getByTestId('activity-skeleton')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-list')).not.toBeInTheDocument();
  });

  it('renders activity rows from the BFF response', () => {
    (useEndpointActivity as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockResponse,
      isLoading: false,
      error: null,
    });

    renderWithProviders(
      <ActivityTab endpointId="ep-1" search={baseSearch} onSearchChange={onChangeProp()} />,
    );

    expect(screen.getByTestId('activity-list')).toBeInTheDocument();
    expect(screen.getByTestId('activity-row-a1')).toBeInTheDocument();
    expect(screen.getByTestId('activity-row-a2')).toBeInTheDocument();
    // Pagination summary visible.
    expect(screen.getByTestId('activity-pagination')).toHaveTextContent(/2 total/);
  });

  it('shows EmptyState when no activities and no filters active', () => {
    (useEndpointActivity as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockResponse, activities: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } },
      isLoading: false,
      error: null,
    });

    renderWithProviders(
      <ActivityTab endpointId="ep-1" search={baseSearch} onSearchChange={onChangeProp()} />,
    );

    expect(screen.getByTestId('activity-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-list')).not.toBeInTheDocument();
    // Reset CTA only appears when filters are active; this case has none.
    expect(screen.queryByTestId('activity-empty-action')).not.toBeInTheDocument();
  });

  it('shows EmptyState with Reset filters CTA when filters are active and zero results', () => {
    (useEndpointActivity as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { ...mockResponse, activities: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } },
      isLoading: false,
      error: null,
    });

    renderWithProviders(
      <ActivityTab
        endpointId="ep-1"
        search={{ ...baseSearch, type: 'user' }}
        onSearchChange={onChangeProp()}
      />,
    );

    expect(screen.getByTestId('activity-empty')).toBeInTheDocument();
    const cta = screen.getByTestId('activity-empty-action');
    expect(cta).toBeInTheDocument();
    fireEvent.click(cta);
    // Reset wipes type/severity/search and resets page to 1.
    expect(onSearchChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: undefined,
        severity: undefined,
        search: undefined,
        page: 1,
      }),
    );
  });

  it('search input commits to onSearchChange on Enter and resets page', () => {
    (useEndpointActivity as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockResponse,
      isLoading: false,
      error: null,
    });

    renderWithProviders(
      <ActivityTab endpointId="ep-1" search={{ ...baseSearch, page: 3 }} onSearchChange={onChangeProp()} />,
    );

    const input = screen.getByTestId('activity-filter-search').querySelector('input') ?? screen.getByTestId('activity-filter-search');
    fireEvent.change(input, { target: { value: 'alice' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onSearchChange).toHaveBeenCalledWith({ search: 'alice', page: 1 });
  });

  it('renders the error block when the BFF call fails', () => {
    (useEndpointActivity as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('activity API down'),
    });

    renderWithProviders(
      <ActivityTab endpointId="ep-1" search={baseSearch} onSearchChange={onChangeProp()} />,
    );

    expect(screen.getByTestId('activity-error')).toHaveTextContent(/activity API down/);
  });

  // ==========================================================================
  // Phase N3 - Export button (CSV / JSON / NDJSON) wired into the toolbar
  // ==========================================================================
  it('renders ExportSplitButton when activities exist', () => {
    (useEndpointActivity as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockResponse, isLoading: false, error: null,
    });

    renderWithProviders(
      <ActivityTab endpointId="ep-1" search={baseSearch} onSearchChange={onChangeProp()} />,
    );

    expect(screen.getByTestId('export-button')).toBeInTheDocument();
    expect(screen.getByTestId('export-button')).not.toBeDisabled();
  });

  it('CSV export invokes triggerCsvDownload with flattened activity rows', async () => {
    const csvExportModule = await import('../utils/csv-export');
    const csvSpy = vi.spyOn(csvExportModule, 'triggerCsvDownload').mockImplementation(() => {});

    (useEndpointActivity as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockResponse, isLoading: false, error: null,
    });

    renderWithProviders(
      <ActivityTab endpointId="ep-1" search={baseSearch} onSearchChange={onChangeProp()} />,
    );
    fireEvent.click(screen.getByTestId('export-button'));
    fireEvent.click(screen.getByTestId('export-menu-csv'));

    expect(csvSpy).toHaveBeenCalledTimes(1);
    const [filename, body] = csvSpy.mock.calls[0];
    expect(filename).toMatch(/^activity-ep-1-\d{8}T\d{6}Z\.csv$/);
    expect(body).toContain('id,timestamp,type,severity,message,details');
    expect(body).toContain('a1,2026-05-08T10:00:00Z,user,success,User created,POST /Users alice@x.com');
    expect(body).toContain('a2,2026-05-08T10:01:00Z,group,info,Group updated,PATCH /Groups/g1');

    csvSpy.mockRestore();
  });
});

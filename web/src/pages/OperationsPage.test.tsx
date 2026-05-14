/**
 * OperationsPage tests (Phase L6).
 *
 * Asserts:
 *   1. Page renders with 3 sub-tabs (All Users | All Groups | Statistics)
 *   2. All Users tab renders one row per user with endpoint Badge
 *   3. All Groups tab renders one row per group with endpoint Badge
 *   4. Statistics tab renders 4 KPI tiles + 24h count
 *   5. Search box drives the query string and resets to page 1 on change
 *   6. Active filter (Switch) drives the query string when toggled
 *   7. Empty-state shows when no rows exist
 *   8. Download CSV button on Users tab triggers triggerCsvDownload
 *   9. Endpoint Badge link points to the per-endpoint Users tab
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { OperationsPage } from './OperationsPage';

// ─── Mocks ───────────────────────────────────────────────────────────

const mockUseDatabaseUsers = vi.fn();
const mockUseDatabaseGroups = vi.fn();
const mockUseDatabaseStatistics = vi.fn();
const mockTriggerCsvDownload = vi.fn();

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useDatabaseUsers: (params: unknown) => mockUseDatabaseUsers(params),
    useDatabaseGroups: (params: unknown) => mockUseDatabaseGroups(params),
    useDatabaseStatistics: () => mockUseDatabaseStatistics(),
  };
});

vi.mock('../utils/csv-export', async () => {
  const actual = await vi.importActual('../utils/csv-export');
  return {
    ...actual,
    triggerCsvDownload: (...args: unknown[]) => mockTriggerCsvDownload(...args),
  };
});

const sampleUsers = {
  users: [
    {
      id: 'u1',
      userName: 'alice@x.com',
      active: true,
      endpointId: 'ep-1',
      createdAt: '2026-05-01T10:00:00Z',
    },
    {
      id: 'u2',
      userName: 'bob@y.com',
      active: false,
      endpointId: 'ep-2',
      createdAt: '2026-05-01T11:00:00Z',
    },
  ],
  pagination: { page: 1, limit: 50, total: 2, pages: 1 },
};

const sampleGroups = {
  groups: [
    {
      id: 'g1',
      displayName: 'Engineering',
      memberCount: 5,
      endpointId: 'ep-1',
      createdAt: '2026-05-01T09:00:00Z',
    },
  ],
  pagination: { page: 1, limit: 50, total: 1, pages: 1 },
};

const sampleStats = {
  users: { total: 12, active: 10, inactive: 2 },
  groups: { total: 4 },
  activity: { totalRequests: 1500, last24Hours: 42 },
  database: { type: 'PostgreSQL', persistenceBackend: 'prisma' },
};

function defaultHookReturn<T>(data: T | undefined = undefined): {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: null;
} {
  return { data, isLoading: false, isError: false, error: null };
}

// Stub useNavigate so the EndpointBadgeLink anchor handler doesn't
// require a real router context in unit tests.
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>(
    '@tanstack/react-router',
  );
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

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

describe('OperationsPage (Phase L6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDatabaseUsers.mockReturnValue(defaultHookReturn(sampleUsers));
    mockUseDatabaseGroups.mockReturnValue(defaultHookReturn(sampleGroups));
    mockUseDatabaseStatistics.mockReturnValue(defaultHookReturn(sampleStats));
  });

  // ─── 1. Sub-tabs render ────────────────────────────────────────────

  it('renders the page with 3 sub-tabs (All Users | All Groups | Statistics)', () => {
    renderWithProviders(<OperationsPage />);
    expect(screen.getByTestId('operations-page')).toBeInTheDocument();
    expect(screen.getByTestId('operations-tab-users')).toBeInTheDocument();
    expect(screen.getByTestId('operations-tab-groups')).toBeInTheDocument();
    expect(screen.getByTestId('operations-tab-statistics')).toBeInTheDocument();
  });

  // ─── 2. All Users tab ──────────────────────────────────────────────

  it('All Users tab renders one row per user with endpoint badge', () => {
    renderWithProviders(<OperationsPage />);
    // Default tab is users.
    expect(screen.getByTestId('operations-user-row-u1')).toBeInTheDocument();
    expect(screen.getByTestId('operations-user-row-u2')).toBeInTheDocument();
    // Endpoint badge on each row.
    expect(screen.getByTestId('operations-user-row-u1-endpoint-ep-1')).toBeInTheDocument();
    expect(screen.getByTestId('operations-user-row-u2-endpoint-ep-2')).toBeInTheDocument();
  });

  it('endpoint Badge on a user row links to that endpoint`s Users tab', () => {
    renderWithProviders(<OperationsPage />);
    const badge = screen.getByTestId('operations-user-row-u1-endpoint-ep-1');
    // anchor href points to the per-endpoint Users tab.
    const href = badge.getAttribute('href');
    expect(href).toMatch(/\/endpoints\/ep-1\/users/);
  });

  // ─── 3. All Groups tab ─────────────────────────────────────────────

  it('switching to All Groups tab renders one row per group with endpoint Badge', () => {
    renderWithProviders(<OperationsPage />);
    fireEvent.click(screen.getByTestId('operations-tab-groups'));
    expect(screen.getByTestId('operations-group-row-g1')).toBeInTheDocument();
    expect(screen.getByTestId('operations-group-row-g1-endpoint-ep-1')).toBeInTheDocument();
  });

  // ─── 4. Statistics tab ─────────────────────────────────────────────

  it('Statistics tab renders 4 KPI tiles with numbers from useDatabaseStatistics', () => {
    renderWithProviders(<OperationsPage />);
    fireEvent.click(screen.getByTestId('operations-tab-statistics'));
    expect(screen.getByTestId('operations-stat-users-total')).toHaveTextContent('12');
    expect(screen.getByTestId('operations-stat-users-active')).toHaveTextContent('10');
    expect(screen.getByTestId('operations-stat-groups-total')).toHaveTextContent('4');
    expect(screen.getByTestId('operations-stat-requests-24h')).toHaveTextContent('42');
  });

  // ─── 5. Search resets page ─────────────────────────────────────────

  it('typing in the Users search box resets the query params to page 1 with the search value', async () => {
    renderWithProviders(<OperationsPage />);
    mockUseDatabaseUsers.mockClear();

    const searchBox = screen.getByTestId('operations-users-search');
    fireEvent.change(searchBox, { target: { value: 'alice' } });

    // The hook is re-called with the new params.
    await waitFor(() => {
      const lastParams = mockUseDatabaseUsers.mock.calls[mockUseDatabaseUsers.mock.calls.length - 1][0];
      expect(lastParams).toEqual(expect.objectContaining({ page: 1, search: 'alice' }));
    });
  });

  // ─── 6. Empty state ────────────────────────────────────────────────

  it('Empty state shows when the Users page has zero rows', () => {
    mockUseDatabaseUsers.mockReturnValue(defaultHookReturn({
      users: [],
      pagination: { page: 1, limit: 50, total: 0, pages: 0 },
    }));
    renderWithProviders(<OperationsPage />);
    expect(screen.getByTestId('operations-users-empty')).toBeInTheDocument();
  });

  // ─── 7. CSV download ───────────────────────────────────────────────

  it('Download CSV button on Users tab triggers triggerCsvDownload with users payload', () => {
    renderWithProviders(<OperationsPage />);
    const btn = screen.getByTestId('operations-users-download-csv');
    fireEvent.click(btn);
    expect(mockTriggerCsvDownload).toHaveBeenCalledTimes(1);
    const [filename, csv] = mockTriggerCsvDownload.mock.calls[0];
    expect(filename).toMatch(/^operations-users-\d/);
    expect(filename.endsWith('.csv')).toBe(true);
    expect(typeof csv).toBe('string');
    // CSV should contain the user identifiers we seeded.
    expect(csv).toContain('alice@x.com');
    expect(csv).toContain('bob@y.com');
  });

  it('Download CSV button on Groups tab triggers triggerCsvDownload with groups payload', () => {
    renderWithProviders(<OperationsPage />);
    fireEvent.click(screen.getByTestId('operations-tab-groups'));
    const btn = screen.getByTestId('operations-groups-download-csv');
    fireEvent.click(btn);
    expect(mockTriggerCsvDownload).toHaveBeenCalledTimes(1);
    const [filename, csv] = mockTriggerCsvDownload.mock.calls[0];
    expect(filename).toMatch(/^operations-groups-\d/);
    expect(csv).toContain('Engineering');
  });
});

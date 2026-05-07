import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setStoredToken, clearStoredToken } from './auth/token';

// Mock all child components to isolate App-level behavior
vi.mock('./components/activity/ActivityFeed', () => ({
  ActivityFeed: () => <div data-testid="activity-feed">ActivityFeed</div>,
}));
vi.mock('./components/database/DatabaseBrowser', () => ({
  DatabaseBrowser: () => <div data-testid="database-browser">DatabaseBrowser</div>,
}));
vi.mock('./components/manual/ManualProvision', () => ({
  ManualProvision: () => <div data-testid="manual-provision">ManualProvision</div>,
}));
vi.mock('./components/LogList', () => ({
  LogList: () => <div data-testid="log-list">LogList</div>,
}));
vi.mock('./components/LogDetail', () => ({
  LogDetail: () => null,
}));
vi.mock('./components/LogFilters', () => ({
  LogFilters: () => <div data-testid="log-filters">LogFilters</div>,
}));
vi.mock('./components/Header', () => ({
  Header: () => <div data-testid="header">Header</div>,
}));

// Mock the new AppShell for isolation
vi.mock('./layout/AppShell', () => ({
  AppShell: () => <div data-testid="app-shell">AppShell</div>,
}));

// Mock API client
vi.mock('./api/client', () => ({
  fetchLogs: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50, count: 0, hasNext: false, hasPrev: false }),
  clearLogs: vi.fn().mockResolvedValue(undefined),
  fetchLog: vi.fn().mockResolvedValue(null),
  fetchLocalVersion: vi.fn().mockResolvedValue({ version: '0.37.1', migratePhase: 'Phase 3' }),
}));

import { App } from './App';

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStoredToken();
    // Set legacy mode for these tests (they test legacy UI behavior)
    Object.defineProperty(window, 'location', {
      value: { ...window.location, search: '?ui=legacy' },
      writable: true,
    });
    // Phase A4: route loaders (web/src/router.ts) call fetch via
    // queryClient.ensureQueryData on initial mount. Without a global
    // fetch stub the loaders hang and TanStack Router doesn't show the
    // route's children, so the app-shell testid never appears. Stub
    // fetch with a permissive empty-success response - individual
    // tests can still override per-call.
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
    }) as unknown as typeof fetch;
  });

  // ── Token Modal ────────────────────────────────────────────────────

  describe('Token Modal', () => {
    it('shows token modal when no token is stored', () => {
      render(<App />);
      expect(screen.getByPlaceholderText(/S3cret-Value/i)).toBeInTheDocument();
      expect(screen.getByText(/Enter the bearer token configured/i)).toBeInTheDocument();
    });

    it('hides token modal after saving a token', async () => {
      const user = userEvent.setup();
      render(<App />);

      const input = screen.getByPlaceholderText(/S3cret-Value/i);
      await user.type(input, 'my-test-token');
      await user.click(screen.getByText('Save Token'));

      // Modal should close — no more password input visible
      expect(screen.queryByPlaceholderText(/S3cret-Value/i)).not.toBeInTheDocument();
    });

    it('does not show token modal when token already exists', () => {
      setStoredToken('existing-token');
      render(<App />);
      expect(screen.queryByPlaceholderText(/S3cret-Value/i)).not.toBeInTheDocument();
    });
  });

  // ── Tab Navigation ─────────────────────────────────────────────────

  describe('Tab Navigation', () => {
    beforeEach(() => {
      setStoredToken('test-token');
    });

    it('renders all 4 tab buttons', () => {
      render(<App />);
      expect(screen.getByText(/Activity Feed/)).toBeInTheDocument();
      expect(screen.getByText(/Raw Logs/)).toBeInTheDocument();
      expect(screen.getByText(/Database Browser/)).toBeInTheDocument();
      expect(screen.getByText(/Manual Provision/)).toBeInTheDocument();
    });

    it('shows Activity Feed by default', () => {
      render(<App />);
      expect(screen.getByTestId('activity-feed')).toBeInTheDocument();
    });

    it('switches to Database Browser tab', async () => {
      const user = userEvent.setup();
      render(<App />);

      await user.click(screen.getByText(/Database Browser/));
      expect(screen.getByTestId('database-browser')).toBeInTheDocument();
      expect(screen.queryByTestId('activity-feed')).not.toBeInTheDocument();
    });

    it('switches to Manual Provision tab', async () => {
      const user = userEvent.setup();
      render(<App />);

      await user.click(screen.getByText(/Manual Provision/));
      expect(screen.getByTestId('manual-provision')).toBeInTheDocument();
    });

    it('switches to Raw Logs tab', async () => {
      const user = userEvent.setup();
      render(<App />);

      await user.click(screen.getByText(/Raw Logs/));
      expect(screen.getByTestId('log-list')).toBeInTheDocument();
    });
  });

  // ── Footer ─────────────────────────────────────────────────────────

  describe('Footer', () => {
    beforeEach(() => {
      setStoredToken('test-token');
    });

    it('renders SCIMServer text in footer', () => {
      render(<App />);
      const footer = screen.getByRole('contentinfo');
      expect(within(footer).getByText('SCIMServer')).toBeInTheDocument();
    });

    it('renders GitHub link in footer', () => {
      render(<App />);
      const footer = screen.getByRole('contentinfo');
      const link = within(footer).getByText('GitHub Repository');
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', 'https://github.com/pranems/SCIMServer');
      expect(link).toHaveAttribute('target', '_blank');
    });

    it('does not contain "Made by" text in footer', () => {
      render(<App />);
      const footer = screen.getByRole('contentinfo');
      expect(footer.textContent).not.toContain('Made by');
    });
  });

  // ── Version Display ────────────────────────────────────────────────

  describe('Version Display', () => {
    beforeEach(() => {
      setStoredToken('test-token');
    });

    it('displays version from API once loaded', async () => {
      render(<App />);
      // Wait for the version to appear (async fetchLocalVersion)
      const versionText = await screen.findByText(/v0\.37\.1/);
      expect(versionText).toBeInTheDocument();
    });
  });

  // ── UI Cutover ─────────────────────────────────────────────────────

  describe('UI cutover (Phase 5)', () => {
    it('renders new Fluent UI by default', async () => {
      // Override to no query param (default)
      Object.defineProperty(window, 'location', {
        value: { ...window.location, search: '' },
        writable: true,
      });
      render(<App />);
      // Default is now the TanStack Router-driven AppShell. RouterProvider
      // resolves the initial route asynchronously, so the AppShell chrome
      // shows up via findByTestId rather than the synchronous getByTestId.
      expect(await screen.findByTestId('app-shell')).toBeInTheDocument();
    });

    it('renders legacy UI with ?ui=legacy', () => {
      Object.defineProperty(window, 'location', {
        value: { ...window.location, search: '?ui=legacy' },
        writable: true,
      });
      render(<App />);
      // Legacy UI should NOT have app-shell
      expect(screen.queryByTestId('app-shell')).not.toBeInTheDocument();
    });
  });
});

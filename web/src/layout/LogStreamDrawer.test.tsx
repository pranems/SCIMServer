/**
 * LogStreamDrawer.test.tsx - Phase K4 component contract.
 *
 * Asserts the drawer's presentational behavior. The hook is mocked so
 * each test can drive any buffer + connection state.
 *
 * @see docs/PHASE_K4_LIVE_LOG_STREAM_VIEWER.md
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { LogStreamDrawer } from './LogStreamDrawer';
import type { LogStreamEntry, LogStreamLevel } from '../hooks/useLogStream';

// ─── Hook mock ──────────────────────────────────────────────────────

interface UseLogStreamReturn {
  entries: LogStreamEntry[];
  connectionState: 'connecting' | 'open' | 'reconnecting' | 'closed';
  paused: boolean;
  setPaused: (p: boolean) => void;
  clear: () => void;
}

const useLogStreamMock = vi.fn<[unknown?], UseLogStreamReturn>();
const setPausedSpy = vi.fn();
const clearSpy = vi.fn();

vi.mock('../hooks/useLogStream', async (importActual) => {
  const actual: typeof import('../hooks/useLogStream') = await importActual();
  return { ...actual, useLogStream: () => useLogStreamMock() };
});

// ui-store - we drive `logStreamDrawerOpen` + filters here.
import { useUIStore } from '../store/ui-store';

const SAMPLE_ENTRIES: LogStreamEntry[] = [
  { timestamp: '2026-05-12T20:00:00Z', level: 'INFO', category: 'http', message: 'GET /Users 200', path: '/scim/v2/Users', durationMs: 12 },
  { timestamp: '2026-05-12T20:00:01Z', level: 'WARN', category: 'auth', message: 'invalid token', requestId: 'req-1' },
  { timestamp: '2026-05-12T20:00:02Z', level: 'ERROR', category: 'database', message: 'pool exhausted' },
  { timestamp: '2026-05-12T20:00:03Z', level: 'DEBUG', category: 'scim.users', message: 'PATCH applied' },
];

function renderWithFluent(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useUIStore.setState({
    logStreamDrawerOpen: false,
    logStreamLevel: 'DEBUG',
    logStreamSearch: '',
  });
  useLogStreamMock.mockReturnValue({
    entries: SAMPLE_ENTRIES,
    connectionState: 'open',
    paused: false,
    setPaused: setPausedSpy,
    clear: clearSpy,
  });
});

describe('LogStreamDrawer', () => {
  it('renders nothing when ui-store.logStreamDrawerOpen is false', () => {
    renderWithFluent(<LogStreamDrawer />);
    expect(screen.queryByTestId('log-stream-drawer')).toBeNull();
  });

  it('renders the drawer when ui-store.logStreamDrawerOpen is true', () => {
    useUIStore.setState({ logStreamDrawerOpen: true });
    renderWithFluent(<LogStreamDrawer />);
    expect(screen.getByTestId('log-stream-drawer')).toBeInTheDocument();
  });

  it('lists every entry in the buffer (one row per entry)', () => {
    useUIStore.setState({ logStreamDrawerOpen: true });
    renderWithFluent(<LogStreamDrawer />);
    expect(screen.getAllByTestId(/^log-stream-row-/)).toHaveLength(SAMPLE_ENTRIES.length);
  });

  it('shows the connection-state badge (text reflects state)', () => {
    useUIStore.setState({ logStreamDrawerOpen: true });
    useLogStreamMock.mockReturnValue({
      entries: [], connectionState: 'reconnecting', paused: false, setPaused: setPausedSpy, clear: clearSpy,
    });
    renderWithFluent(<LogStreamDrawer />);
    expect(screen.getByTestId('log-stream-connection')).toHaveTextContent(/reconnecting/i);
  });

  it('Pause button toggles ui via setPaused', async () => {
    useUIStore.setState({ logStreamDrawerOpen: true });
    renderWithFluent(<LogStreamDrawer />);
    await userEvent.click(screen.getByTestId('log-stream-pause'));
    expect(setPausedSpy).toHaveBeenCalledWith(true);
  });

  it('Clear button triggers the clear() callback', async () => {
    useUIStore.setState({ logStreamDrawerOpen: true });
    renderWithFluent(<LogStreamDrawer />);
    await userEvent.click(screen.getByTestId('log-stream-clear'));
    expect(clearSpy).toHaveBeenCalled();
  });

  it('Close button writes logStreamDrawerOpen=false to ui-store', async () => {
    useUIStore.setState({ logStreamDrawerOpen: true });
    renderWithFluent(<LogStreamDrawer />);
    await userEvent.click(screen.getByTestId('log-stream-close'));
    expect(useUIStore.getState().logStreamDrawerOpen).toBe(false);
  });

  it('shows an empty-state message when buffer is empty', () => {
    useUIStore.setState({ logStreamDrawerOpen: true });
    useLogStreamMock.mockReturnValue({
      entries: [], connectionState: 'open', paused: false, setPaused: setPausedSpy, clear: clearSpy,
    });
    renderWithFluent(<LogStreamDrawer />);
    expect(screen.getByTestId('log-stream-empty')).toBeInTheDocument();
  });

  it('applies the ui-store level filter (only WARN+ rows visible)', () => {
    useUIStore.setState({ logStreamDrawerOpen: true, logStreamLevel: 'WARN' });
    renderWithFluent(<LogStreamDrawer />);
    // 4 sample entries -> WARN + ERROR remain
    expect(screen.getAllByTestId(/^log-stream-row-/)).toHaveLength(2);
  });

  it('applies the ui-store search filter (substring match across message/category)', () => {
    useUIStore.setState({ logStreamDrawerOpen: true, logStreamSearch: 'pool' });
    renderWithFluent(<LogStreamDrawer />);
    expect(screen.getAllByTestId(/^log-stream-row-/)).toHaveLength(1);
    expect(screen.getByTestId(/^log-stream-row-/)).toHaveTextContent(/pool exhausted/);
  });

  it(
    'shows a banner when the buffer is at its max-entries cap (operator hint that older entries dropped)',
    () => {
      useUIStore.setState({ logStreamDrawerOpen: true });
      const big = Array.from({ length: 5000 }, (_, i): LogStreamEntry => ({
        timestamp: `t${i}`, level: 'INFO', category: 'x', message: `m${i}`,
      }));
      useLogStreamMock.mockReturnValue({
        entries: big, connectionState: 'open', paused: false, setPaused: setPausedSpy, clear: clearSpy,
      });
      renderWithFluent(<LogStreamDrawer />);
      expect(screen.getByTestId('log-stream-cap-banner')).toBeInTheDocument();
    },
    // Render of 5000 rows is intentionally heavy - bump the per-test
    // timeout above the global vitest default so this test does not
    // flake under shared-suite contention.
    20_000,
  );
});

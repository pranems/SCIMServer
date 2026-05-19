/**
 * ui-store.test.ts - Phase K2 Zustand slice contract.
 *
 * Locks in the `sseConnectionState` slice so a future PR cannot
 * silently rename it / drop the setter / change the legal value set.
 * useHealthRollup + useSSE both depend on this exact shape.
 *
 * @see docs/PHASE_K2_SERVICE_HEALTH_ROLLUP.md
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore, type SseConnectionState } from './ui-store';

const LEGAL_STATES: SseConnectionState[] = ['connecting', 'open', 'reconnecting', 'closed'];

describe('ui-store - K2 sseConnectionState slice', () => {
  beforeEach(() => {
    // Reset to default between tests (the store does not auto-reset).
    useUIStore.setState({ sseConnectionState: 'closed' });
  });

  it('exposes a sseConnectionState field with default "closed"', () => {
    const state = useUIStore.getState();
    expect(state.sseConnectionState).toBe<SseConnectionState>('closed');
  });

  it('exposes a setSseConnectionState setter that flips the value', () => {
    const { setSseConnectionState } = useUIStore.getState();
    expect(typeof setSseConnectionState).toBe('function');
    setSseConnectionState('open');
    expect(useUIStore.getState().sseConnectionState).toBe('open');
  });

  it.each(LEGAL_STATES)('accepts every legal state value: %s', (state) => {
    useUIStore.getState().setSseConnectionState(state);
    expect(useUIStore.getState().sseConnectionState).toBe(state);
  });
});

// ─── Phase K4 - log stream drawer slice ─────────────────────────────

import type { LogStreamLevel } from '../hooks/useLogStream';

describe('ui-store - K4 log stream drawer slice', () => {
  beforeEach(() => {
    useUIStore.setState({
      logStreamDrawerOpen: false,
      logStreamLevel: 'DEBUG',
      logStreamSearch: '',
    });
  });

  it('exposes logStreamDrawerOpen with default false', () => {
    expect(useUIStore.getState().logStreamDrawerOpen).toBe(false);
  });

  it('exposes setLogStreamDrawerOpen setter', () => {
    const { setLogStreamDrawerOpen } = useUIStore.getState();
    expect(typeof setLogStreamDrawerOpen).toBe('function');
    setLogStreamDrawerOpen(true);
    expect(useUIStore.getState().logStreamDrawerOpen).toBe(true);
  });

  it('exposes toggleLogStreamDrawer', () => {
    const { toggleLogStreamDrawer } = useUIStore.getState();
    expect(typeof toggleLogStreamDrawer).toBe('function');
    toggleLogStreamDrawer();
    expect(useUIStore.getState().logStreamDrawerOpen).toBe(true);
    toggleLogStreamDrawer();
    expect(useUIStore.getState().logStreamDrawerOpen).toBe(false);
  });

  it('exposes logStreamLevel default DEBUG with setter', () => {
    expect(useUIStore.getState().logStreamLevel).toBe<LogStreamLevel>('DEBUG');
    useUIStore.getState().setLogStreamLevel('ERROR');
    expect(useUIStore.getState().logStreamLevel).toBe<LogStreamLevel>('ERROR');
  });

  it.each<LogStreamLevel>(['DEBUG', 'INFO', 'WARN', 'ERROR'])(
    'accepts every legal log stream level: %s',
    (lvl) => {
      useUIStore.getState().setLogStreamLevel(lvl);
      expect(useUIStore.getState().logStreamLevel).toBe(lvl);
    },
  );

  it('exposes logStreamSearch default empty string with setter', () => {
    expect(useUIStore.getState().logStreamSearch).toBe('');
    useUIStore.getState().setLogStreamSearch('foo');
    expect(useUIStore.getState().logStreamSearch).toBe('foo');
  });

  // ─── Phase N1 - notifications drawer slice ───────────────────

  it('exposes notificationsDrawerOpen with default false (Phase N1)', () => {
    expect(useUIStore.getState().notificationsDrawerOpen).toBe(false);
  });

  it('exposes setNotificationsDrawerOpen + toggleNotificationsDrawer (Phase N1)', () => {
    const { setNotificationsDrawerOpen, toggleNotificationsDrawer } = useUIStore.getState();
    setNotificationsDrawerOpen(true);
    expect(useUIStore.getState().notificationsDrawerOpen).toBe(true);
    toggleNotificationsDrawer();
    expect(useUIStore.getState().notificationsDrawerOpen).toBe(false);
    toggleNotificationsDrawer();
    expect(useUIStore.getState().notificationsDrawerOpen).toBe(true);
  });
});

// ─── Phase N7 - applyPreferenceDefaults (sidebarCollapsedDefault wire) ──

import { usePreferencesStore } from './preferences-store';

describe('ui-store - N7 applyPreferenceDefaults', () => {
  beforeEach(() => {
    usePreferencesStore.getState().resetPreferences();
    useUIStore.setState({ sidebarCollapsed: false });
  });

  it('exposes applyPreferenceDefaults() function', () => {
    const { applyPreferenceDefaults } = useUIStore.getState();
    expect(typeof applyPreferenceDefaults).toBe('function');
  });

  it('sets sidebarCollapsed=true when preferences.sidebarCollapsedDefault is true', () => {
    usePreferencesStore.getState().setSidebarCollapsedDefault(true);
    useUIStore.setState({ sidebarCollapsed: false });
    useUIStore.getState().applyPreferenceDefaults();
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  });

  it('sets sidebarCollapsed=false when preferences.sidebarCollapsedDefault is false', () => {
    usePreferencesStore.getState().setSidebarCollapsedDefault(false);
    useUIStore.setState({ sidebarCollapsed: true });
    useUIStore.getState().applyPreferenceDefaults();
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });

  it('is idempotent (safe to call twice)', () => {
    usePreferencesStore.getState().setSidebarCollapsedDefault(true);
    useUIStore.getState().applyPreferenceDefaults();
    useUIStore.getState().applyPreferenceDefaults();
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  });
});


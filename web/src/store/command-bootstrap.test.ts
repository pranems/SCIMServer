/**
 * command-bootstrap.test.ts - Phase N6.
 *
 * Verifies the 4 bootstrap-registered commands appear in the
 * registry AND that each one has a working handler (we exercise
 * the side effects against the source stores).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { commandRegistry } from './command-registry';
import { bootstrapCommandRegistry, _resetCommandBootstrapForTests } from './command-bootstrap';
import { useTelemetryStore } from './telemetry-store';
import { usePreferencesStore, PREFERENCES_DEFAULTS } from './preferences-store';
import { useNotificationsStore } from './notifications-store';

describe('command-bootstrap', () => {
  beforeEach(() => {
    _resetCommandBootstrapForTests();
    useTelemetryStore.setState({ events: [] });
    usePreferencesStore.setState({ ...PREFERENCES_DEFAULTS });
    useNotificationsStore.setState({ entries: [], unreadCount: 0 });
  });

  it('registers exactly 4 commands on first call', () => {
    bootstrapCommandRegistry();
    expect(commandRegistry.all().map((c) => c.id)).toEqual([
      'telemetry.clear',
      'preferences.reset',
      'notifications.clear',
      'theme.toggle',
    ]);
  });

  it('is idempotent - second bootstrap is a no-op', () => {
    bootstrapCommandRegistry();
    bootstrapCommandRegistry();
    expect(commandRegistry.all()).toHaveLength(4);
  });

  it('telemetry.clear empties the telemetry buffer', () => {
    useTelemetryStore.getState().record({ type: 'navigation', path: '/x' });
    bootstrapCommandRegistry();
    void commandRegistry.run('telemetry.clear');
    expect(useTelemetryStore.getState().events).toHaveLength(0);
  });

  it('preferences.reset restores defaults', () => {
    usePreferencesStore.getState().setDefaultPageSize(100);
    expect(usePreferencesStore.getState().defaultPageSize).toBe(100);
    bootstrapCommandRegistry();
    void commandRegistry.run('preferences.reset');
    expect(usePreferencesStore.getState().defaultPageSize).toBe(PREFERENCES_DEFAULTS.defaultPageSize);
  });

  it('notifications.clear empties the notifications store', () => {
    useNotificationsStore.setState({
      entries: [
        { id: 'n1', type: 'scim.user.created', severity: 'info', summary: 's', timestamp: new Date().toISOString(), read: false } as never,
      ],
      unreadCount: 1,
    });
    bootstrapCommandRegistry();
    void commandRegistry.run('notifications.clear');
    expect(useNotificationsStore.getState().entries).toHaveLength(0);
  });

  it('theme.toggle changes the ui-store color scheme to the next value', async () => {
    const { useUIStore } = await import('./ui-store');
    useUIStore.setState({ colorScheme: 'light' });
    bootstrapCommandRegistry();
    void commandRegistry.run('theme.toggle');
    // theme.toggle uses a dynamic import; allow microtask + next tick.
    await new Promise((r) => setTimeout(r, 10));
    expect(['dark', 'system']).toContain(useUIStore.getState().colorScheme);
  });

  it('each registered command exposes operator-useful keywords for the palette', () => {
    bootstrapCommandRegistry();
    for (const cmd of commandRegistry.all()) {
      expect(cmd.keywords).toBeDefined();
      expect((cmd.keywords ?? []).length).toBeGreaterThan(0);
    }
  });
});

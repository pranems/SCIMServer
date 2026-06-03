/**
 * Phase N6 - bootstrap-registered commands.
 *
 * Called once from main.tsx at app boot. Registers operator-useful
 * actions into `commandRegistry` so they appear in the Cmd/Ctrl+K
 * palette's "Custom commands" group.
 *
 * Conventions:
 *  - `id` is `<scope>.<verb>` so future modules can scope-prefix
 *    without colliding (e.g. `workbench.reset`, `telemetry.clear`).
 *  - `label` is operator-facing imperative ("Clear telemetry buffer",
 *    not "telemetry.clear").
 *  - `keywords` boost the cmdk fuzzy match for synonyms / verbs the
 *    operator might type ("clean", "wipe").
 *  - Handlers MUST be side-effect-only; they cannot return UI.
 *
 * @see web/src/store/command-registry.ts
 * @see web/src/components/CommandPalette.tsx (consumer)
 */
import { commandRegistry } from './command-registry';
import { useTelemetryStore } from './telemetry-store';
import { usePreferencesStore } from './preferences-store';
import { clearNotifications } from './notifications-store';

let bootstrapped = false;

export function bootstrapCommandRegistry(): void {
  if (bootstrapped) return;
  bootstrapped = true;

  commandRegistry.register({
    id: 'telemetry.clear',
    label: 'Clear telemetry buffer',
    keywords: ['clean', 'wipe', 'reset', 'events'],
    run: () => {
      useTelemetryStore.getState().clear();
    },
  });

  commandRegistry.register({
    id: 'preferences.reset',
    label: 'Reset preferences to defaults',
    keywords: ['restore', 'settings', 'defaults'],
    run: () => {
      usePreferencesStore.getState().resetPreferences();
    },
  });

  commandRegistry.register({
    id: 'notifications.clear',
    label: 'Clear all notifications',
    keywords: ['clean', 'wipe', 'inbox', 'bell'],
    run: () => {
      clearNotifications();
    },
  });

  commandRegistry.register({
    id: 'theme.toggle',
    label: 'Toggle color scheme (light / dark / system)',
    keywords: ['dark', 'light', 'theme', 'mode'],
    run: () => {
      // Lazy import to avoid a hard dep on ui-store at module load.
      void import('./ui-store').then(({ useUIStore }) => {
        const s = useUIStore.getState() as {
          colorScheme: 'light' | 'dark' | 'system';
          setColorScheme: (m: 'light' | 'dark' | 'system') => void;
        };
        const next = s.colorScheme === 'light'
          ? 'dark'
          : s.colorScheme === 'dark'
            ? 'system'
            : 'light';
        s.setColorScheme(next);
      });
    },
  });
}

/** Test-only - lets specs reset between runs. */
export function _resetCommandBootstrapForTests(): void {
  bootstrapped = false;
  commandRegistry.clear();
}

/**
 * Phase N4 - preferences-store (TDD spec, RED-first).
 *
 * Locks:
 *   - default shape (`PREFERENCES_DEFAULTS`)
 *   - localStorage hydration (versioned envelope `{ v: 1, prefs: {...} }`)
 *   - versioned migration (unknown / older `v` falls back to defaults safely)
 *   - corrupt-storage tolerance (malformed JSON -> defaults)
 *   - per-key setters mutate state AND persist
 *   - `resetPreferences()` returns to defaults AND writes defaults back
 *   - `unsubscribePersist` not required - persistence is synchronous
 *
 * @see web/src/store/preferences-store.ts
 * @see docs/PHASE_N4_SETTINGS_PERSISTENCE.md (to be authored in commit 3)
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  usePreferencesStore,
  loadPreferences,
  PREFERENCES_STORAGE_KEY,
  PREFERENCES_SCHEMA_VERSION,
  PREFERENCES_DEFAULTS,
  type Preferences,
} from './preferences-store';

function readStorage(): unknown {
  const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function resetStore() {
  // Resets via the public API; the store reads `localStorage` at module
  // init so we also need to nuke the key before recreating state.
  window.localStorage.removeItem(PREFERENCES_STORAGE_KEY);
  usePreferencesStore.setState({ ...PREFERENCES_DEFAULTS });
}

describe('Phase N4 - preferences-store (Zustand + versioned localStorage)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetStore();
  });

  describe('defaults + constants', () => {
    it('exposes PREFERENCES_SCHEMA_VERSION = 1', () => {
      expect(PREFERENCES_SCHEMA_VERSION).toBe(1);
    });

    it('exposes PREFERENCES_DEFAULTS with the expected keys', () => {
      expect(PREFERENCES_DEFAULTS).toEqual({
        defaultPageSize: 20,
        denseMode: false,
        sidebarCollapsedDefault: false,
      } satisfies Preferences);
    });

    it('hydrates to defaults when localStorage is empty', () => {
      const state = usePreferencesStore.getState();
      expect(state.defaultPageSize).toBe(20);
      expect(state.denseMode).toBe(false);
      expect(state.sidebarCollapsedDefault).toBe(false);
    });
  });

  describe('setters persist + mutate', () => {
    it('setDefaultPageSize(50) updates state AND writes versioned envelope', () => {
      usePreferencesStore.getState().setDefaultPageSize(50);
      expect(usePreferencesStore.getState().defaultPageSize).toBe(50);
      expect(readStorage()).toEqual({
        v: 1,
        prefs: { defaultPageSize: 50, denseMode: false, sidebarCollapsedDefault: false },
      });
    });

    it('setDenseMode(true) updates state AND persists', () => {
      usePreferencesStore.getState().setDenseMode(true);
      expect(usePreferencesStore.getState().denseMode).toBe(true);
      expect((readStorage() as any).prefs.denseMode).toBe(true);
    });

    it('setSidebarCollapsedDefault(true) updates state AND persists', () => {
      usePreferencesStore.getState().setSidebarCollapsedDefault(true);
      expect(usePreferencesStore.getState().sidebarCollapsedDefault).toBe(true);
      expect((readStorage() as any).prefs.sidebarCollapsedDefault).toBe(true);
    });
  });

  describe('resetPreferences()', () => {
    it('reverts state to defaults AND writes defaults back to storage', () => {
      usePreferencesStore.getState().setDefaultPageSize(100);
      usePreferencesStore.getState().setDenseMode(true);

      usePreferencesStore.getState().resetPreferences();

      expect(usePreferencesStore.getState().defaultPageSize).toBe(20);
      expect(usePreferencesStore.getState().denseMode).toBe(false);
      expect(readStorage()).toEqual({
        v: 1,
        prefs: { ...PREFERENCES_DEFAULTS },
      });
    });
  });

  describe('hydration from storage (loadPreferences)', () => {
    it('reads a well-formed envelope and overrides defaults', () => {
      window.localStorage.setItem(
        PREFERENCES_STORAGE_KEY,
        JSON.stringify({ v: 1, prefs: { defaultPageSize: 50, denseMode: true, sidebarCollapsedDefault: true } }),
      );
      // Force re-hydration via the exported helper for deterministic tests.
            const loaded = loadPreferences();
      expect(loaded).toEqual({ defaultPageSize: 50, denseMode: true, sidebarCollapsedDefault: true });
    });

    it('falls back to defaults when storage is corrupt JSON', () => {
      window.localStorage.setItem(PREFERENCES_STORAGE_KEY, '{not json');
            expect(loadPreferences()).toEqual(PREFERENCES_DEFAULTS);
    });

    it('falls back to defaults when envelope version is unknown (forward-compat)', () => {
      window.localStorage.setItem(
        PREFERENCES_STORAGE_KEY,
        JSON.stringify({ v: 999, prefs: { defaultPageSize: 50 } }),
      );
            expect(loadPreferences()).toEqual(PREFERENCES_DEFAULTS);
    });

    it('falls back to defaults when envelope has no `prefs` key', () => {
      window.localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({ v: 1 }));
            expect(loadPreferences()).toEqual(PREFERENCES_DEFAULTS);
    });

    it('merges partial prefs with defaults (additive future keys)', () => {
      window.localStorage.setItem(
        PREFERENCES_STORAGE_KEY,
        JSON.stringify({ v: 1, prefs: { defaultPageSize: 100 } }),
      );
            expect(loadPreferences()).toEqual({
        defaultPageSize: 100,
        denseMode: false,
        sidebarCollapsedDefault: false,
      });
    });

    it('clamps defaultPageSize to allowed values [10,20,50,100]; invalid -> default', () => {
      window.localStorage.setItem(
        PREFERENCES_STORAGE_KEY,
        JSON.stringify({ v: 1, prefs: { defaultPageSize: 7 } }),
      );
            expect(loadPreferences().defaultPageSize).toBe(20);
    });
  });
});

/**
 * Phase N4 - preferences-store (Zustand global + versioned localStorage).
 *
 * Persists per-user UI preferences that should survive page reloads
 * but are NOT part of routing state (which lives in URL search params)
 * and NOT chrome state (sidebarCollapsed, theme - live in ui-store).
 *
 * Per analysis-doc S5.4 the only pref persisted today is the color
 * scheme. Phase N4 widens that surface to: defaultPageSize, denseMode,
 * sidebarCollapsedDefault.
 *
 * Architecture choices:
 *   - Separate store from `ui-store` (chrome) and `notifications-store`
 *     (events) so prefs evolve independently and the storage key /
 *     schema-version is cleanly isolated.
 *   - Versioned envelope `{ v: 1, prefs: {...} }` so future migrations
 *     are a single switch statement, not a multi-key heuristic.
 *   - Corrupt-storage tolerance: any parse failure, unknown `v`, or
 *     missing `prefs` falls back to `PREFERENCES_DEFAULTS` (operator
 *     never sees a blank UI from a bad storage row).
 *   - Per-key clamping: `defaultPageSize` is whitelisted to
 *     [10, 20, 50, 100]; anything else falls back to the default.
 *   - Hand-rolled persistence (not Zustand's `persist` middleware)
 *     because we need the clamping + migration policy described above
 *     and the storage payload is tiny.
 *
 * @see web/src/store/preferences-store.test.ts (TDD spec)
 * @see docs/PHASE_N4_SETTINGS_PERSISTENCE.md (to be authored in commit 3)
 */
import { create } from 'zustand';

export const PREFERENCES_STORAGE_KEY = 'scimserver.preferences.v1';
export const PREFERENCES_SCHEMA_VERSION = 1 as const;

export const ALLOWED_PAGE_SIZES = [10, 20, 50, 100] as const;
export type AllowedPageSize = (typeof ALLOWED_PAGE_SIZES)[number];

export interface Preferences {
  defaultPageSize: AllowedPageSize;
  denseMode: boolean;
  sidebarCollapsedDefault: boolean;
}

export const PREFERENCES_DEFAULTS: Preferences = {
  defaultPageSize: 20,
  denseMode: false,
  sidebarCollapsedDefault: false,
};

interface StoredEnvelope {
  v: number;
  prefs?: Partial<Preferences>;
}

function clampPageSize(value: unknown): AllowedPageSize {
  if (typeof value === 'number' && (ALLOWED_PAGE_SIZES as readonly number[]).includes(value)) {
    return value as AllowedPageSize;
  }
  return PREFERENCES_DEFAULTS.defaultPageSize;
}

/**
 * Read preferences from localStorage with corrupt-storage tolerance
 * and forward-compat version handling. Always returns a fully-populated
 * `Preferences` object.
 */
export function loadPreferences(): Preferences {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...PREFERENCES_DEFAULTS };
  }
  const raw = window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
  if (!raw) return { ...PREFERENCES_DEFAULTS };
  let parsed: StoredEnvelope;
  try {
    parsed = JSON.parse(raw) as StoredEnvelope;
  } catch {
    return { ...PREFERENCES_DEFAULTS };
  }
  if (!parsed || typeof parsed !== 'object') return { ...PREFERENCES_DEFAULTS };
  if (parsed.v !== PREFERENCES_SCHEMA_VERSION) return { ...PREFERENCES_DEFAULTS };
  if (!parsed.prefs || typeof parsed.prefs !== 'object') return { ...PREFERENCES_DEFAULTS };

  const p = parsed.prefs;
  return {
    defaultPageSize: clampPageSize(p.defaultPageSize),
    denseMode: typeof p.denseMode === 'boolean' ? p.denseMode : PREFERENCES_DEFAULTS.denseMode,
    sidebarCollapsedDefault:
      typeof p.sidebarCollapsedDefault === 'boolean'
        ? p.sidebarCollapsedDefault
        : PREFERENCES_DEFAULTS.sidebarCollapsedDefault,
  };
}

function persist(prefs: Preferences): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      PREFERENCES_STORAGE_KEY,
      JSON.stringify({ v: PREFERENCES_SCHEMA_VERSION, prefs }),
    );
  } catch {
    // Quota / disabled storage - silently ignore; state still updates.
  }
}

interface PreferencesState extends Preferences {
  setDefaultPageSize: (size: AllowedPageSize) => void;
  setDenseMode: (enabled: boolean) => void;
  setSidebarCollapsedDefault: (collapsed: boolean) => void;
  resetPreferences: () => void;
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  ...loadPreferences(),

  setDefaultPageSize: (size) => {
    set({ defaultPageSize: clampPageSize(size) });
    const { defaultPageSize, denseMode, sidebarCollapsedDefault } = get();
    persist({ defaultPageSize, denseMode, sidebarCollapsedDefault });
  },
  setDenseMode: (enabled) => {
    set({ denseMode: enabled });
    const { defaultPageSize, denseMode, sidebarCollapsedDefault } = get();
    persist({ defaultPageSize, denseMode, sidebarCollapsedDefault });
  },
  setSidebarCollapsedDefault: (collapsed) => {
    set({ sidebarCollapsedDefault: collapsed });
    const { defaultPageSize, denseMode, sidebarCollapsedDefault } = get();
    persist({ defaultPageSize, denseMode, sidebarCollapsedDefault });
  },
  resetPreferences: () => {
    set({ ...PREFERENCES_DEFAULTS });
    persist({ ...PREFERENCES_DEFAULTS });
  },
}));

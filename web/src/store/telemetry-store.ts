/**
 * Phase N5 - telemetry-store (Zustand in-memory ring buffer).
 *
 * Captures lightweight, privacy-preserving client-side telemetry:
 *   - Route navigations (page views) - wired in commit 2/3 via
 *     TanStack Router subscription.
 *   - Uncaught errors - wired in commit 2/3 via window.onerror +
 *     unhandledrejection handlers.
 *
 * Design choices (documented for the gate-strategy audit trail):
 *
 *   - In-memory only (NOT persisted to localStorage). The ring buffer
 *     is for live operator debugging, not historical retention. Server-
 *     side ingestion (`POST /scim/admin/telemetry`) + 7-day retention
 *     is deferred to Phase O alongside the Managed-Identity work.
 *
 *   - Hard cap at TELEMETRY_MAX_EVENTS (50) so a runaway navigation
 *     loop or error storm cannot exhaust browser memory.
 *
 *   - Hard TTL at TELEMETRY_TTL_MS (24h) so a long-lived SPA tab
 *     does not accumulate stale events forever; pruning happens
 *     at record-time (cheap; no background timer needed).
 *
 *   - Opt-in gating: `record()` reads `usePreferencesStore.getState()
 *     .telemetryOptIn` and short-circuits when false. The setting lives
 *     in preferences-store (not here) so it persists across reloads
 *     via the existing versioned-envelope localStorage layer.
 *
 *   - Zero new runtime deps. The Phase N5 MVP intentionally avoids
 *     `web-vitals` and any analytics SDK; those are Phase N5b/O.
 *
 * @see web/src/store/telemetry-store.test.ts (TDD spec)
 * @see web/src/store/preferences-store.ts (`telemetryOptIn` lives there)
 */
import { create } from 'zustand';
import { usePreferencesStore } from './preferences-store';

export const TELEMETRY_MAX_EVENTS = 50;
export const TELEMETRY_TTL_MS = 24 * 60 * 60 * 1000;

export type TelemetryEvent =
  | {
      type: 'navigation';
      path: string;
      timestamp: number;
    }
  | {
      type: 'error';
      message: string;
      stack?: string;
      timestamp: number;
    };

/** Input variant of TelemetryEvent - `timestamp` is filled by the store. */
export type TelemetryEventInput =
  | { type: 'navigation'; path: string }
  | { type: 'error'; message: string; stack?: string };

interface TelemetryState {
  events: TelemetryEvent[];
  record: (event: TelemetryEventInput) => void;
  clear: () => void;
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  events: [],

  record: (event) => {
    // Opt-out gating: read prefs at call time (not subscribe) so
    // toggling the switch takes effect on the next event without
    // any teardown / resubscribe dance.
    if (!usePreferencesStore.getState().telemetryOptIn) return;

    const now = Date.now();
    set((state) => {
      // Prune by TTL first (cheap O(n) filter; n <= 50).
      const fresh = state.events.filter((e) => now - e.timestamp <= TELEMETRY_TTL_MS);
      // Append the new event.
      const stamped: TelemetryEvent = { ...event, timestamp: now };
      const next = [...fresh, stamped];
      // Cap at MAX_EVENTS - drop oldest survivors.
      if (next.length > TELEMETRY_MAX_EVENTS) {
        return { events: next.slice(next.length - TELEMETRY_MAX_EVENTS) };
      }
      return { events: next };
    });
  },

  clear: () => set({ events: [] }),
}));

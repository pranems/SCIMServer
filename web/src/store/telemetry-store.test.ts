/**
 * telemetry-store.test.ts - Phase N5 (Frontend Telemetry)
 *
 * Verifies the in-memory ring buffer that captures route-navigation
 * and uncaught-error events. Opt-out gating (via preferences-store
 * `telemetryOptIn`) is the contract: when the operator opts out,
 * `record()` MUST be a no-op even if invoked.
 *
 * No server-side ingestion is in scope for Phase N5 MVP (deferred to
 * Phase O alongside the persistence + retention policy).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// We hoist the import so each test starts from a known state by calling
// `useTelemetryStore.setState({events: []})` in beforeEach.
import {
  useTelemetryStore,
  TELEMETRY_MAX_EVENTS,
  TELEMETRY_TTL_MS,
  type TelemetryEvent,
} from './telemetry-store';
import { usePreferencesStore, PREFERENCES_DEFAULTS } from './preferences-store';

describe('telemetry-store', () => {
  beforeEach(() => {
    useTelemetryStore.setState({ events: [] });
    // Default state: telemetry opted in (Phase N5 default).
    usePreferencesStore.setState({ ...PREFERENCES_DEFAULTS, telemetryOptIn: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constants', () => {
    it('exposes a non-trivial ring-buffer cap', () => {
      expect(TELEMETRY_MAX_EVENTS).toBeGreaterThanOrEqual(20);
      expect(TELEMETRY_MAX_EVENTS).toBeLessThanOrEqual(500);
    });

    it('exposes a finite TTL in ms', () => {
      expect(TELEMETRY_TTL_MS).toBeGreaterThan(0);
      expect(TELEMETRY_TTL_MS).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
    });
  });

  describe('record()', () => {
    it('appends a navigation event when opted in', () => {
      useTelemetryStore.getState().record({ type: 'navigation', path: '/endpoints' });
      const events = useTelemetryStore.getState().events;
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('navigation');
      expect((events[0] as Extract<TelemetryEvent, { type: 'navigation' }>).path).toBe('/endpoints');
      expect(typeof events[0].timestamp).toBe('number');
    });

    it('appends an error event when opted in', () => {
      useTelemetryStore.getState().record({
        type: 'error',
        message: 'boom',
        stack: 'stack-trace-here',
      });
      const events = useTelemetryStore.getState().events;
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      expect((events[0] as Extract<TelemetryEvent, { type: 'error' }>).message).toBe('boom');
    });

    it('is a no-op when the operator opted out via preferences-store', () => {
      usePreferencesStore.setState({ ...PREFERENCES_DEFAULTS, telemetryOptIn: false });
      useTelemetryStore.getState().record({ type: 'navigation', path: '/settings' });
      expect(useTelemetryStore.getState().events).toHaveLength(0);
    });

    it('drops the oldest event when the ring fills past TELEMETRY_MAX_EVENTS', () => {
      // Push exactly cap + 5 events; only the most recent `cap` should survive.
      const overshoot = TELEMETRY_MAX_EVENTS + 5;
      for (let i = 0; i < overshoot; i++) {
        useTelemetryStore.getState().record({ type: 'navigation', path: `/p${i}` });
      }
      const events = useTelemetryStore.getState().events;
      expect(events).toHaveLength(TELEMETRY_MAX_EVENTS);
      // Oldest survivor should be event index = overshoot - cap.
      const oldestSurvivor = events[0] as Extract<TelemetryEvent, { type: 'navigation' }>;
      expect(oldestSurvivor.path).toBe(`/p${overshoot - TELEMETRY_MAX_EVENTS}`);
      // Newest is /p{overshoot-1}.
      const newest = events[events.length - 1] as Extract<TelemetryEvent, { type: 'navigation' }>;
      expect(newest.path).toBe(`/p${overshoot - 1}`);
    });

    it('prunes events older than TELEMETRY_TTL_MS at record-time', () => {
      vi.useFakeTimers();
      const start = new Date('2026-05-20T10:00:00Z').getTime();
      vi.setSystemTime(start);
      useTelemetryStore.getState().record({ type: 'navigation', path: '/old' });

      // Advance past TTL + 1s so the old event must be pruned.
      vi.setSystemTime(start + TELEMETRY_TTL_MS + 1000);
      useTelemetryStore.getState().record({ type: 'navigation', path: '/fresh' });

      const events = useTelemetryStore.getState().events;
      expect(events).toHaveLength(1);
      expect((events[0] as Extract<TelemetryEvent, { type: 'navigation' }>).path).toBe('/fresh');
    });
  });

  describe('clear()', () => {
    it('removes every buffered event', () => {
      useTelemetryStore.getState().record({ type: 'navigation', path: '/a' });
      useTelemetryStore.getState().record({ type: 'navigation', path: '/b' });
      expect(useTelemetryStore.getState().events).toHaveLength(2);
      useTelemetryStore.getState().clear();
      expect(useTelemetryStore.getState().events).toHaveLength(0);
    });
  });

  describe('preferences-store integration', () => {
    it('preferences-store exposes telemetryOptIn with the documented default', () => {
      // The Phase N5 contract: opt-in is true by default (so we get
      // useful signal in fresh installs) but the operator can disable.
      const defaults = PREFERENCES_DEFAULTS as { telemetryOptIn?: boolean };
      expect(defaults.telemetryOptIn).toBe(true);
    });

    it('preferences-store setter for telemetryOptIn toggles the value', () => {
      expect(usePreferencesStore.getState().telemetryOptIn).toBe(true);
      usePreferencesStore.getState().setTelemetryOptIn(false);
      expect(usePreferencesStore.getState().telemetryOptIn).toBe(false);
      usePreferencesStore.getState().setTelemetryOptIn(true);
      expect(usePreferencesStore.getState().telemetryOptIn).toBe(true);
    });
  });
});

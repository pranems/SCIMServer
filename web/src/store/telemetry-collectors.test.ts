/**
 * telemetry-collectors.test.ts - Phase N5 (Frontend Telemetry).
 *
 * Verifies the two boot-time wires:
 *
 *   1. Router navigation -> useTelemetryStore.record({type:'navigation'})
 *      We don't depend on a real TanStack Router here - we simulate a
 *      router shape (`subscribe('onResolved', cb)` returning an
 *      unsubscribe function) and confirm the callback path lands an
 *      event with the resolved pathname.
 *
 *   2. window error events -> useTelemetryStore.record({type:'error'})
 *      Fired via `dispatchEvent(new ErrorEvent('error', ...))` and
 *      `dispatchEvent(new PromiseRejectionEvent(...))`.
 *
 * The bootstrap function MUST be idempotent (multiple calls = single
 * subscription) AND return a teardown so tests + HMR remain clean.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTelemetryStore } from './telemetry-store';
import { usePreferencesStore, PREFERENCES_DEFAULTS } from './preferences-store';
import { bootstrapTelemetryCollectors } from './telemetry-collectors';

interface FakeRouter {
  subscribe: ReturnType<typeof vi.fn>;
  state: { location: { pathname: string } };
}

function makeFakeRouter(): { router: FakeRouter; fireNavigation: (path: string) => void } {
  let cb: ((evt: { toLocation: { pathname: string } }) => void) | null = null;
  const router: FakeRouter = {
    subscribe: vi.fn((event: string, handler: typeof cb) => {
      if (event === 'onResolved') cb = handler;
      return () => {
        cb = null;
      };
    }),
    state: { location: { pathname: '/' } },
  };
  const fireNavigation = (path: string): void => {
    if (cb) cb({ toLocation: { pathname: path } });
  };
  return { router, fireNavigation };
}

describe('telemetry-collectors', () => {
  beforeEach(() => {
    useTelemetryStore.setState({ events: [] });
    usePreferencesStore.setState({ ...PREFERENCES_DEFAULTS, telemetryOptIn: true });
  });

  describe('navigation wire', () => {
    it('records a navigation event when the router resolves a new location', () => {
      const { router, fireNavigation } = makeFakeRouter();
      const teardown = bootstrapTelemetryCollectors(router as never);
      fireNavigation('/endpoints/abc/users');
      const events = useTelemetryStore.getState().events;
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('navigation');
      expect((events[0] as { path: string }).path).toBe('/endpoints/abc/users');
      teardown();
    });

    it('is idempotent - multiple bootstraps still record exactly once per nav', () => {
      const { router, fireNavigation } = makeFakeRouter();
      const t1 = bootstrapTelemetryCollectors(router as never);
      const t2 = bootstrapTelemetryCollectors(router as never);
      fireNavigation('/a');
      expect(useTelemetryStore.getState().events).toHaveLength(1);
      t1();
      t2();
    });
  });

  describe('error wire', () => {
    it('records an error event from window error', () => {
      const { router } = makeFakeRouter();
      const teardown = bootstrapTelemetryCollectors(router as never);
      window.dispatchEvent(
        new ErrorEvent('error', { message: 'something broke', error: new Error('something broke') }),
      );
      const events = useTelemetryStore.getState().events;
      expect(events.some((e) => e.type === 'error' && (e as { message: string }).message.includes('something broke'))).toBe(true);
      teardown();
    });

    it('records an error event from unhandledrejection', () => {
      const { router } = makeFakeRouter();
      const teardown = bootstrapTelemetryCollectors(router as never);
      // jsdom does not have a PromiseRejectionEvent ctor; synthesize.
      const ev = new Event('unhandledrejection') as Event & { reason: unknown };
      (ev as { reason: unknown }).reason = new Error('rejected-promise');
      window.dispatchEvent(ev);
      const events = useTelemetryStore.getState().events;
      expect(events.some((e) => e.type === 'error' && (e as { message: string }).message.includes('rejected-promise'))).toBe(true);
      teardown();
    });
  });

  describe('teardown', () => {
    it('teardown unsubscribes from router AND removes window listeners', () => {
      const { router, fireNavigation } = makeFakeRouter();
      const teardown = bootstrapTelemetryCollectors(router as never);
      teardown();
      fireNavigation('/post-teardown');
      window.dispatchEvent(new ErrorEvent('error', { message: 'post-teardown' }));
      expect(useTelemetryStore.getState().events).toHaveLength(0);
    });
  });
});

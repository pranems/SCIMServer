/**
 * Phase N5 - telemetry-collectors bootstrap.
 *
 * Wires the two browser-side signal sources into the in-memory
 * telemetry ring buffer:
 *
 *   - TanStack Router `subscribe('onResolved')` for page-view events.
 *   - `window.addEventListener('error' | 'unhandledrejection')`
 *     for uncaught error events.
 *
 * The bootstrap function is idempotent (a second call short-circuits)
 * and returns a teardown that unsubscribes the router and removes the
 * window listeners. Idempotency matters for two cases:
 *
 *   - Vite HMR can re-import main.tsx without a full page reload;
 *     without the idempotency guard we'd record every navigation
 *     2x / 3x.
 *
 *   - Vitest may import the module per-test under `jsdom`; tests use
 *     the explicit teardown to keep the registration count at 0/1.
 *
 * The function accepts an opaque router shape so the unit test can
 * pass a fake without pulling in the full TanStack Router lib.
 *
 * @see web/src/store/telemetry-collectors.test.ts
 * @see web/src/store/telemetry-store.ts
 */
import { useTelemetryStore } from './telemetry-store';

interface RouterSubscribable {
  subscribe(
    event: 'onResolved',
    handler: (evt: { toLocation: { pathname: string } }) => void,
  ): () => void;
}

let active = false;
let teardown: (() => void) | null = null;

export function bootstrapTelemetryCollectors(router: RouterSubscribable): () => void {
  if (active && teardown) return teardown;
  active = true;

  const record = useTelemetryStore.getState().record;

  // 1. Router navigation wire.
  const unsubscribeRouter = router.subscribe('onResolved', (evt) => {
    const pathname = evt?.toLocation?.pathname;
    if (typeof pathname === 'string' && pathname.length > 0) {
      record({ type: 'navigation', path: pathname });
    }
  });

  // 2. Uncaught error wire.
  const onError = (e: Event): void => {
    const ee = e as ErrorEvent;
    const message = typeof ee.message === 'string' && ee.message.length > 0
      ? ee.message
      : 'Unknown error';
    const stack = ee.error instanceof Error ? ee.error.stack : undefined;
    record({ type: 'error', message, stack });
  };
  const onRejection = (e: Event): void => {
    const re = e as Event & { reason?: unknown };
    const reason = re.reason;
    const message = reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : 'Unhandled rejection';
    const stack = reason instanceof Error ? reason.stack : undefined;
    record({ type: 'error', message, stack });
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  teardown = (): void => {
    unsubscribeRouter();
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    active = false;
    teardown = null;
  };

  return teardown;
}

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { router } from './router';
import { bootstrapTelemetryCollectors } from './store/telemetry-collectors';
import { bootstrapCommandRegistry } from './store/command-bootstrap';

/**
 * Phase B.3 (v0.48.1): MSW browser worker opt-in mount.
 *
 * Vite stringifies all `import.meta.env.*` values, so the equality
 * compare against the literal string 'true' is intentional. The
 * dynamic `await import(...)` keeps the MSW handler graph + service
 * worker code OUT of the production chunk - tree-shaking drops the
 * entire branch when the env var is unset, which is the default.
 *
 * The Playwright cross-tab SSE spec (`web/e2e/sse-cross-tab.spec.ts`,
 * Phase H3-deferred) launches the dev server with `VITE_USE_MSW=true`
 * to get deterministic SCIM mutation events on the wire without
 * standing up a real backend.
 *
 * `onUnhandledRequest: 'bypass'` is required: the default 'warn'
 * floods the Playwright console for every /scim/* request not in
 * `web/src/test/msw/handlers.ts`, which makes failure triage impossible.
 *
 * Source-shape locked by `web/src/test/main-msw-mount.test.ts`.
 *
 * @see docs/PHASE_J_SSE_EVENT_BRIDGE.md S3.2
 * @see web/src/test/msw/browser.ts
 */
async function bootstrap(): Promise<void> {
  if (import.meta.env.VITE_USE_MSW === 'true') {
    const { worker } = await import('./test/msw/browser');
    await worker.start({ onUnhandledRequest: 'bypass' });
  }
  // Phase N5 - wire frontend telemetry collectors once at boot.
  // Idempotent: HMR re-imports won't double-subscribe. Opt-in gating
  // is enforced inside useTelemetryStore.record() against
  // preferences-store.telemetryOptIn.
  bootstrapTelemetryCollectors(router);

  // Phase N6 - register operator-useful palette commands so the
  // Cmd/Ctrl+K "Custom commands" group has content out of the box.
  bootstrapCommandRegistry();

  createRoot(document.getElementById('root')!).render(<App />);
}

void bootstrap();

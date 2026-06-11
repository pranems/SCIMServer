/**
 * MSW browser worker.
 *
 * Phase H1: enables network-level mocking inside a real browser tab
 * (Playwright + manual dev-server). Mount only when explicitly opted
 * into via `VITE_USE_MSW=true`; production builds tree-shake this
 * file because no top-level import touches it.
 *
 * Wiring (caller responsibility, typically in main.tsx):
 *
 *   if (import.meta.env.VITE_USE_MSW === 'true') {
 *     const { worker } = await import('./test/msw/browser');
 *     await worker.start({ onUnhandledRequest: 'bypass' });
 *   }
 *
 * @see https://mswjs.io/docs/api/setup-worker
 */
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);

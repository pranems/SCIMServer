/**
 * MSW Node test server.
 *
 * Phase H1: started/stopped by `web/src/test/setup.ts` so every vitest
 * spec runs against a network-level mock by default. Tests that want
 * an error variant call `server.use(errorHandlers.something())` per
 * test; the `afterEach(() => server.resetHandlers())` in setup wipes
 * those overrides between tests so leakage is impossible.
 *
 * Browser-side MSW worker (for Playwright dev-server) lives in
 * `./browser.ts` and is mounted via `web/src/main.tsx` only when
 * `import.meta.env.VITE_USE_MSW === 'true'`.
 *
 * @see https://mswjs.io/docs/api/setup-server
 */
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);

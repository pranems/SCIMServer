/**
 * sse-cross-tab.spec.ts - F3-deferred two-tab SSE invalidation test.
 *
 * Phase H3 promises this test as part of the visual-regression sub-phase
 * because the F3 SSE invalidation work shipped without it (no MSW
 * infrastructure existed at the time to fixture the SSE stream).
 * Now that H1 has MSW handlers and H3 has the visual-regression
 * Playwright spec runner, this test can ship.
 *
 * Contract under test (F3 docs/PHASE_F3_SSE_INVALIDATION_AUDIT.md):
 *   - Tab A and Tab B both subscribe to the SSE stream via useSSE.
 *   - Tab A creates a user via POST /scim/v2/.../Users.
 *   - The server emits a `user.created` SSE event on the channel.
 *   - The useSSE hook in Tab B's React Query cache invalidates the
 *     `endpoint-users` + `users` + `dashboard` keys.
 *   - Tab B's UsersTab refetches and the new user appears WITHOUT a
 *     manual page refresh.
 *
 * Why this is hard to test in vitest: the cross-tab story requires
 * two independent EventSource connections + two BrowserContexts, which
 * jsdom can't model. Playwright's `browser.newContext()` is the
 * minimum viable harness.
 *
 * Stability strategy:
 *   - Both tabs share the same MSW worker via the dev-server's
 *     `VITE_USE_MSW=true` (Phase H1 wires this through `web/src/main.tsx`).
 *   - The SSE stream is mocked at the network layer by MSW so we don't
 *     depend on a real SCIM server's emission timing.
 *   - 5 s timeout for the cross-tab refetch matches the 30 s SSE
 *     reconnect-on-disconnect ceiling: well under the test runner's
 *     30 s default.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

const TEST_USER = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  userName: `cross-tab-${Date.now()}@msw.test`,
  displayName: 'Cross-Tab MSW Test User',
};

async function authenticatedPage(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  // Inject token before navigation so TokenGate accepts it on first paint.
  await page.addInitScript(
    ({ key, value }) => {
      try { window.localStorage.setItem(key, value); } catch {}
    },
    { key: 'scimserver.authToken', value: 'msw-test-bearer' },
  );
  await page.goto('/');
  await page.evaluate((t) => localStorage.setItem('scim_token', t), 'msw-test-bearer');
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  return page;
}

test.describe('Phase H3 - F3-deferred cross-tab SSE invalidation', () => {
  // This test depends on MSW running in the page (VITE_USE_MSW=true on a local
  // vite dev server). Against a deployed Azure dev URL there is no MSW worker
  // and the mock endpoint `ep-msw-1` does not exist - so skip in that case.
  // Replacement coverage for the F3 SSE contract against real backends is
  // already provided by the live-test 9z-V section (PII boundary + SSE event
  // emission) plus the api/test/e2e/scim-event-sse-bridge.e2e-spec.ts E2E.
  test.skip(
    !!process.env.E2E_BASE_URL && !process.env.E2E_BASE_URL.startsWith('http://localhost'),
    'MSW-only test; requires local vite dev server with VITE_USE_MSW=true. F3 contract is also locked by api/test/e2e/scim-event-sse-bridge.e2e-spec.ts + live-test 9z-V.',
  );

  test('Tab A creates user, Tab B refetches WITHOUT manual reload', async ({ browser }) => {
    // Two independent BrowserContexts so each tab gets its own
    // localStorage / cookies / EventSource - same as a real
    // user opening the app in two windows.
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();

    try {
      // Tab B opens the Users tab first so it's already subscribed to
      // the SSE channel for that endpoint when Tab A mutates.
      const tabB = await authenticatedPage(contextB, '/endpoints/ep-msw-1/users');
      const initialBCount = await tabB.locator('[data-testid^="user-row-"]').count();

      // Tab A navigates to manual provisioning and posts a user.
      const tabA = await authenticatedPage(contextA, '/manual-provision');
      // Pick the same endpoint as Tab B so the SSE channel matches.
      await tabA.getByRole('combobox').click();
      await tabA.getByRole('option', { name: /MSW Test Endpoint|ep-msw-1/i }).click();

      // Type the userName.
      await tabA.getByLabel('userName').fill(TEST_USER.userName);
      await tabA.getByRole('button', { name: /create user/i }).click();

      // Wait for the success panel in Tab A.
      await tabA.locator('[data-testid="manual-provision-success"]').waitFor({ state: 'visible' });

      // Now the contract: Tab B's Users table must refetch WITHOUT us
      // touching it. Poll for up to 5 s for the row count to grow.
      // If it doesn't, the SSE invalidation contract is broken (F3).
      await expect(async () => {
        const newCount = await tabB.locator('[data-testid^="user-row-"]').count();
        expect(newCount).toBeGreaterThan(initialBCount);
      }).toPass({ timeout: 5000 });
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});

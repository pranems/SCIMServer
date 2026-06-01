/**
 * copy-and-truncate.spec.ts - Phase P1 CopyableField + TruncatedText
 * end-to-end coverage.
 *
 * USER PATHS COVERED
 *   /endpoints/$id/users - long userName cells truncate with CSS
 *     ellipsis (no horizontal overflow distortion) and the full value
 *     is reachable as the wrapped tooltip's aria-label.
 *   /endpoints/$id/users - clicking the CopyableField's copy button
 *     writes the full value to navigator.clipboard AND does NOT open
 *     the row's ResourceDetailDrawer (the button's onClick stops
 *     propagation; the row's onClick handler is bypassed).
 *
 * WHY THESE PATHS WERE NOT PREVIOUSLY COVERED
 *   The P1 primitives shipped in commit f06c4d6 (LogsTab url column,
 *   LogsPage url+drawer, WorkbenchPage requestId/body, ScimError
 *   detail/requestId/raw, Discovery schema URN, EndpointDetail SCIM
 *   base path, UsersTab/GroupsTab name columns) addressed the layout
 *   distortion reported by the operator on prod (very long Entra
 *   userName values pushing the table off-screen). Vitest covers the
 *   testid wiring per-surface; this spec locks the browser-level
 *   behavior in three dimensions that vitest cannot reach:
 *     1. real CSS ellipsis in a real layout container,
 *     2. the actual clipboard write through Permissions API,
 *     3. event-propagation isolation between the copy button and the
 *        row's click handler.
 *
 * SAFETY
 *   READ-ONLY. Picks the first available user on whatever endpoint
 *   the dev tenant currently hosts. Skips gracefully when the tenant
 *   has zero endpoints or zero users on the chosen endpoint.
 */
import { test, expect, type Page } from '@playwright/test';

const TOKEN_STORAGE_KEY = 'scimserver.authToken';
const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';

test.beforeEach(async ({ page, context }) => {
  // Grant clipboard permissions BEFORE the page loads so the
  // navigator.clipboard.readText() call in the test can succeed.
  // Chromium requires both read + write to be explicitly granted.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: TOKEN_STORAGE_KEY, value: TOKEN },
  );
});

/**
 * Discovers an endpoint with a long (>= 40 char) userName via the
 * SCIM API (much faster than walking the UI 25x), then navigates
 * directly to its Users tab. Returns the chosen endpointId + the
 * first long-userName user-row testid + the full userName.
 *
 * Skips the spec when:
 *   - the tenant has zero endpoints, OR
 *   - none of the first N endpoints carry users with userName >= 40
 *     chars (the truncation bug is not exercisable on this deployment
 *     and R1 cannot legitimately fire).
 *
 * The earlier UI-walking version stopped at "first endpoint with any
 * users" - which on dev landed on Sagar-ISV with short test1234567@...
 * names, causing the test to PASS even when truncation was broken.
 * Walking the cards sequentially also took 30s+ per empty endpoint
 * and frequently hit navigate timeouts. Going through the API directly
 * keeps the test deterministic and fast.
 */
async function openEndpointWithLongUserName(
  page: Page,
): Promise<{ endpointId: string; userId: string; fullValue: string }> {
  const token = process.env.E2E_TOKEN || 'changeme-scim';

  // Navigate to the app first so subsequent page.evaluate() fetch
  // calls run with a real origin (relative URLs work, and CORS is a
  // non-issue since we hit our own backend).
  await page.goto('/endpoints');
  await expect(page.getByTestId('endpoints-page')).toBeVisible({ timeout: 30_000 });

  // Step 1: list all endpoints via admin API. Bearer = SCIM shared secret.
  const epList = await page.evaluate(
    async (token: string) => {
      const r = await fetch('/scim/admin/endpoints', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`endpoints list failed: ${r.status} ${await r.text()}`);
      const data = await r.json();
      return (data.endpoints ?? []) as Array<{ id: string; name: string }>;
    },
    token,
  );
  test.skip(epList.length === 0, 'Tenant has zero endpoints; cannot exercise P1 primitives.');

  // Step 2: probe each endpoint's first 5 users for a long userName.
  // Typical dev/prod tenant has 1-2 endpoints with Entra-shaped users;
  // checking 25 covers low-density tenants too.
  const target = await page.evaluate(
    async ({ token, endpoints }: { token: string; endpoints: Array<{ id: string; name: string }> }) => {
      for (const ep of endpoints.slice(0, 25)) {
        try {
          const r = await fetch(`/scim/endpoints/${ep.id}/Users?count=5`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!r.ok) continue;
          const data = await r.json();
          for (const user of data.Resources ?? []) {
            if (typeof user.userName === 'string' && user.userName.length >= 40) {
              return { endpointId: ep.id, userId: user.id, userName: user.userName as string };
            }
          }
        } catch {
          // try next endpoint
        }
      }
      return null;
    },
    { token, endpoints: epList },
  );

  test.skip(
    target === null,
    'No endpoint among the first 25 has a userName >= 40 chars; ' +
      'cannot exercise P1 truncation. Add an endpoint with Entra-shaped userNames to dev.',
  );

  // Step 3: navigate directly to the target endpoint's Users tab.
  await page.goto(`/endpoints/${target!.endpointId}/users`);
  await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('users-tab')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(`user-row-${target!.userId}`)).toBeVisible({ timeout: 20_000 });

  return { endpointId: target!.endpointId, userId: target!.userId, fullValue: target!.userName };
}

test.describe('Phase P1 - CopyableField + TruncatedText on Users table', () => {
  test('userName cell ACTUALLY truncates (bounded width + visible text shorter than full value)', async ({ page }) => {
    const { userId, fullValue } = await openEndpointWithLongUserName(page);

    const usernameCell = page.getByTestId(`user-username-${userId}`);
    const copyButton = page.getByTestId(`user-username-${userId}-copy-button`);
    await expect(usernameCell).toBeVisible();
    await expect(copyButton).toBeVisible();

    // R1 (copilot-instructions.md "Visual Layout Discipline"): assert
    // RENDERED layout outcomes, not just computed CSS. A `<span>` with
    // text-overflow:ellipsis but default display:inline silently no-ops
    // - the styles ARE applied (so getComputedStyle passes) but the
    // user sees the full text expanded. The only assertions that catch
    // this class of bug measure real bounds in a real browser.

    // Full value was already captured by the helper; reconfirm it
    // matches what the copy button currently advertises.
    const copyAriaLabel = (await copyButton.getAttribute('aria-label')) ?? '';
    const recheckedFull = copyAriaLabel.startsWith('Copy ')
      ? copyAriaLabel.slice('Copy '.length)
      : copyAriaLabel;
    expect(recheckedFull).toBe(fullValue);
    expect(fullValue.length).toBeGreaterThanOrEqual(40);

    // Outer cell rect - the CopyableField root (inline-flex with
    // max-width:100%). When the inner TruncatedText fails to clip, the
    // cell expands to fit the unbounded content, so the bug is visible
    // as an oversized rect.
    const cellRect = await usernameCell.boundingBox();
    expect(cellRect, 'cell must render with a bounding box').not.toBeNull();
    const cellWidth = cellRect?.width ?? 0;

    // The cell's effective container is the <td> which has the column
    // share of the table width. The TruncatedText maxWidth is 280px;
    // total cell adds icon + gap so cap is 280 + 24 (icon) + 4 (gap)
    // + ~12 (cell padding) = ~320px. Allow 340 to absorb rendering
    // subpixel rounding + browser zoom variance.
    expect(
      cellWidth,
      `username cell width ${cellWidth}px exceeds 340px cap on a "${fullValue}" (${fullValue.length} chars). ` +
        `This means R4 (TruncatedText display:inline-block) and/or R5 (table-layout:fixed) are not in effect.`,
    ).toBeLessThanOrEqual(340);

    // Canonical "CSS ellipsis actually fired" detection (R1):
    // scrollWidth > clientWidth means the inner content is wider
    // than the rendered cell, i.e. the browser had to clip something.
    // We measure the TruncatedText <span> directly (CopyableField's
    // truncate-target) - the <td> wrapper would have scrollWidth ==
    // clientWidth thanks to td overflow:hidden and would not report
    // overflow. innerText() / textContent give the full DOM string
    // even when CSS clips visually, so they are NOT a valid signal
    // for ellipsis activation (Finding-D lesson).
    const overflowReport = await usernameCell.evaluate((root: HTMLElement) => {
      // Walk the subtree for any inline-block <span> that owns the
      // text-overflow:ellipsis style (the TruncatedText primitive).
      const spans = Array.from(root.querySelectorAll('span'));
      const truncators = spans
        .map((s) => {
          const cs = window.getComputedStyle(s);
          return {
            text: (s.textContent ?? '').trim(),
            display: cs.display,
            textOverflow: cs.textOverflow,
            whiteSpace: cs.whiteSpace,
            scrollWidth: s.scrollWidth,
            clientWidth: s.clientWidth,
          };
        })
        .filter(
          (info) =>
            info.textOverflow === 'ellipsis' &&
            info.whiteSpace === 'nowrap' &&
            info.display === 'inline-block',
        );
      return truncators;
    });
    expect(
      overflowReport.length,
      `expected at least one TruncatedText span with display:inline-block + textOverflow:ellipsis + ` +
        `whiteSpace:nowrap inside the username cell; got ${overflowReport.length}. ` +
        `R4 says truncation primitives MUST self-contain display:inline-block.`,
    ).toBeGreaterThan(0);
    const truncatorMatch = overflowReport.find((info) => info.text === fullValue);
    expect(
      truncatorMatch,
      `expected a TruncatedText span whose textContent === "${fullValue}"; ` +
        `report = ${JSON.stringify(overflowReport)}`,
    ).toBeDefined();
    expect(
      truncatorMatch!.scrollWidth,
      `TruncatedText scrollWidth (${truncatorMatch!.scrollWidth}px) must exceed clientWidth ` +
        `(${truncatorMatch!.clientWidth}px) on a ${fullValue.length}-char value, proving CSS ` +
        `ellipsis actually fired. If they are equal, the browser did not clip - layout-distortion ` +
        `risk remains.`,
    ).toBeGreaterThan(truncatorMatch!.clientWidth);
  });

  test('copy button writes the full userName to the clipboard', async ({ page }) => {
    const { userId, fullValue } = await openEndpointWithLongUserName(page);

    const copyButton = page.getByTestId(`user-username-${userId}-copy-button`);
    await expect(copyButton).toBeVisible();

    await copyButton.click();
    const clipboardValue = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardValue).toBe(fullValue);
  });

  test('clicking the copy button does NOT open the row detail drawer', async ({ page }) => {
    const { userId } = await openEndpointWithLongUserName(page);

    const copyButton = page.getByTestId(`user-username-${userId}-copy-button`);
    const drawer = page.getByTestId('resource-detail-drawer');

    // Sanity: drawer is not open before the click.
    await expect(drawer).toBeHidden();

    await copyButton.click();

    // The copy button's onClick calls e.stopPropagation() so the
    // row's onClick that opens the drawer MUST NOT fire. Give the
    // DOM a real animation frame to confirm absence.
    await page.waitForTimeout(500);
    await expect(drawer).toBeHidden();
  });
});

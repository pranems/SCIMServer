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
import { createFixtureEndpointWithUsers, deleteFixtureEndpoint } from './endpoint-fixture';

/** Tracked at module scope so the fixture is removed even when a test throws. */
let fixtureEndpointId: string | null = null;

test.afterEach(async ({ page }) => {
  fixtureEndpointId = await deleteFixtureEndpoint(page, fixtureEndpointId);
});

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
  // DETERMINISM (2026-08-05). This helper used to LIST the tenant's endpoints
  // and hunt the first 25 of them for a user whose userName happened to be
  // >= 40 chars, skipping when it found none. Three problems: the probe cost a
  // request per endpoint, the result depended entirely on ambient tenant data,
  // and a downstream test skipped whenever the user it found carried none of
  // name/emails/externalId/enterprise. On dev that last skip fired every run,
  // so the "Additional attributes" assertions never executed.
  //
  // It now seeds exactly the user it needs. The fixture's userName is
  // deliberately Entra-shaped and well over 40 chars, and carries the
  // enrichment attributes, so R1 truncation and the drawer section are ALWAYS
  // exercisable and no skip is reachable.
  test.setTimeout(120_000);

  const { endpointId, users } = await createFixtureEndpointWithUsers(page, {
    namePrefix: 'e2e-trunc',
    users: 1,
  });
  fixtureEndpointId = endpointId;
  const target = users[0];

  // Non-vacuous guard: if the seeded name were ever shortened, the truncation
  // assertions below would silently stop testing truncation.
  expect(
    target.userName.length,
    'fixture userName must exceed the truncation threshold',
  ).toBeGreaterThanOrEqual(40);

  await page.goto(`/endpoints/${endpointId}/users`);
  await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('users-tab')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId(`user-row-${target.id}`)).toBeVisible({ timeout: 20_000 });

  return { endpointId, userId: target.id, fullValue: target.userName };
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

    // The "ellipsis actually fired" signal (scrollWidth > clientWidth) is only
    // valid when the value is genuinely WIDER than the bounded box. A userName
    // with >= 40 chars is not guaranteed to overflow the 280px TruncatedText
    // cap: narrow glyphs (i, l, ., 1) can render 41 chars in ~263px, which fits
    // WITHOUT clipping. Data varies per tenant (proudbush's long-name user
    // overflowed; calmsand's 41-char user fit), so an unconditional
    // scrollWidth > clientWidth assertion is a data-sensitive false-negative.
    //
    // Robust contract (R1 + R5): the box MUST be bounded (already asserted:
    // cellWidth <= 340). Clipping is asserted ONLY when the box is actually
    // saturated - i.e. the rendered content reached the cap. When the value
    // fits inside the box, non-clipping is correct and asserting overflow would
    // be wrong.
    const TRUNCATE_MAXWIDTH = 280; // CopyableField truncate maxWidth cap (px)
    const isBoxSaturated = truncatorMatch!.clientWidth >= TRUNCATE_MAXWIDTH - 4;
    if (isBoxSaturated) {
      expect(
        truncatorMatch!.scrollWidth,
        `TruncatedText scrollWidth (${truncatorMatch!.scrollWidth}px) must exceed clientWidth ` +
          `(${truncatorMatch!.clientWidth}px) on a ${fullValue.length}-char value that saturated ` +
          `the ${TRUNCATE_MAXWIDTH}px cap, proving CSS ellipsis actually fired. If they are equal, ` +
          `the browser did not clip - layout-distortion risk remains.`,
      ).toBeGreaterThan(truncatorMatch!.clientWidth);
    } else {
      // Value fit inside the bounded box - clipping legitimately did not fire.
      // The bounded-width assertion above (cellWidth <= 340) is the real R5
      // guard and already passed; the content simply did not need an ellipsis.
      expect(
        truncatorMatch!.scrollWidth,
        `value fit inside the ${TRUNCATE_MAXWIDTH}px box (clientWidth ` +
          `${truncatorMatch!.clientWidth}px); scrollWidth should equal clientWidth (no clip needed)`,
      ).toBeLessThanOrEqual(truncatorMatch!.clientWidth);
    }
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

  // Finding-D follow-up #2 (2026-05-29): operator surfaced that the
  // user detail drawer only rendered userName + displayName + active
  // and hid name.*, emails[], externalId, and the enterprise
  // extension. Adds the "Additional attributes" read-only section so
  // every non-editable top-level attribute is visible on dev.
  test('user detail drawer renders Additional attributes section for rich users', async ({ page }) => {
    const { endpointId, userId, fullValue } = await openEndpointWithLongUserName(page);

    // Open the drawer for this row.
    await page.goto(`/endpoints/${endpointId}/users?detail=${userId}`);
    const drawer = page.getByTestId('resource-detail-drawer');
    await expect(drawer).toBeVisible({ timeout: 30_000 });

    // Read the underlying SCIM record so we can assert ONLY the
    // attributes the resource actually carries. Skips when none of
    // the expected enrichment fields are present (e.g. a stub user).
    const token = process.env.E2E_TOKEN || 'changeme-scim';
    const scimUser = await page.evaluate(
      async ({ endpointId, userId, token }: { endpointId: string; userId: string; token: string }) => {
        const r = await fetch(`/scim/endpoints/${endpointId}/Users/${userId}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) {
          // Fall back to OAuth client-credentials.
          const t = await (
            await fetch('/scim/oauth/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                grant_type: 'client_credentials',
                client_id: 'scimserver-client',
                client_secret: 'changeme-oauth',
              }),
            })
          ).json();
          const r2 = await fetch(`/scim/endpoints/${endpointId}/Users/${userId}`, {
            headers: { Authorization: `Bearer ${t.access_token}` },
          });
          return await r2.json();
        }
        return await r.json();
      },
      { endpointId, userId, token },
    );

    const enrichmentKeys = ['name', 'emails', 'externalId', 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'];
    const present = enrichmentKeys.filter((k) => scimUser[k] !== undefined && scimUser[k] !== null);
    // The fixture seeds all four enrichment attributes, so an empty result here
    // is a real regression rather than a reason to skip.
    expect(
      present.length,
      `User ${fullValue} (${userId}) has none of [${enrichmentKeys.join(', ')}]; ` +
        `the Additional-attributes section cannot be exercised.`,
    ).toBeGreaterThan(0);

    // Section heading anchors the read-only block.
    await expect(page.getByText('Additional attributes', { exact: false })).toBeVisible();

    // Each present enrichment key MUST have a corresponding attr-<key>
    // row, with the textContent containing the underlying value.
    for (const key of present) {
      const row = page.getByTestId(`attr-${key}`);
      await expect(row, `attr-${key} row must be present`).toBeVisible();
      // For scalar keys, the value text must appear in the row.
      const value = scimUser[key];
      if (typeof value === 'string') {
        await expect(row).toContainText(value);
      }
    }
  });

  // Finding-D #3 (2026-05-29): operator screenshot showed the entire
  // drawer scrolled horizontally - long monospace tokens (Entra
  // userNames embedded in JSON values) pushed the body past the
  // drawer width, clipping content off the LEFT edge ("formatted"
  // became "tted", IDs disappeared, the title scrolled). R1 says
  // measure bounds, not CSS; this test asserts the canonical
  // "no horizontal overflow" invariant: drawer body scrollWidth
  // must equal clientWidth (no horizontal scroll possible).
  test('user detail drawer body MUST NOT overflow horizontally regardless of content length', async ({ page }) => {
    const { endpointId, userId, fullValue } = await openEndpointWithLongUserName(page);
    await page.goto(`/endpoints/${endpointId}/users?detail=${userId}`);
    const drawer = page.getByTestId('resource-detail-drawer');
    await expect(drawer).toBeVisible({ timeout: 30_000 });
    const body = page.getByTestId('resource-detail-drawer-body');
    await expect(body).toBeVisible();

    const overflow = await body.evaluate((el: HTMLElement) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(
      overflow.scrollWidth,
      `drawer body scrollWidth (${overflow.scrollWidth}px) exceeds clientWidth ` +
        `(${overflow.clientWidth}px) on a ${fullValue.length}-char userName. ` +
        `That means content is hidden off the left/right edge of the drawer ` +
        `and the operator cannot see it. Add wordBreak:break-all + overflowX:hidden ` +
        `to the offending container.`,
    ).toBeLessThanOrEqual(overflow.clientWidth + 1);

    // Belt-and-braces: also verify every attr-* JSON row's pre block
    // is itself width-bounded (no inner horizontal scroll either).
    const innerOverflow = await body.evaluate((el: HTMLElement) => {
      const pres = Array.from(el.querySelectorAll('pre'));
      return pres.map((p) => ({
        scrollWidth: p.scrollWidth,
        clientWidth: p.clientWidth,
        text: (p.textContent ?? '').slice(0, 40),
      }));
    });
    for (const r of innerOverflow) {
      expect(
        r.scrollWidth,
        `JSON <pre> block "${r.text}..." scrollWidth=${r.scrollWidth} > clientWidth=${r.clientWidth}; ` +
          `long unbreakable tokens (URLs/URNs) are pushing it past its container. ` +
          `Add wordBreak:break-all + overflowWrap:anywhere.`,
      ).toBeLessThanOrEqual(r.clientWidth + 1);
    }
  });
});

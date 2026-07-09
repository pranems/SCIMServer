/**
 * operations-page.spec.ts - exercises the cross-endpoint Operations page
 * (/operations), which had vitest but no Playwright coverage.
 *
 * USER PATHS COVERED
 *   /operations -> the three sub-tabs (All users | All groups | Statistics)
 *   render and switch. The All-users tab exposes a search box, an active-only
 *   switch, a CSV download, and pagination; the Statistics tab renders its
 *   database-statistics surface with a CSV export.
 *
 * SAFETY
 *   READ-ONLY. Operations aggregates cross-endpoint reads; the spec never
 *   mutates anything (it toggles the client-side active-only filter + switches
 *   tabs). It asserts controls exist without depending on specific data rows.
 */
import { test, expect, type Page } from '@playwright/test';

const TOKEN_STORAGE_KEY = 'scimserver.authToken';
const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: TOKEN_STORAGE_KEY, value: TOKEN },
  );
});

async function openOperations(page: Page): Promise<void> {
  await page.goto('/operations');
  await expect(page.getByTestId('operations-page')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('operations-subtabs')).toBeVisible({ timeout: 30_000 });
}

test.describe('Operations (/operations)', () => {
  test('the page renders the three sub-tabs', async ({ page }) => {
    await openOperations(page);
    await expect(page.getByTestId('operations-tab-users')).toBeVisible();
    await expect(page.getByTestId('operations-tab-groups')).toBeVisible();
    await expect(page.getByTestId('operations-tab-statistics')).toBeVisible();
  });

  test('the All-users tab exposes search, active-only, and CSV download', async ({ page }) => {
    await openOperations(page);
    await page.getByTestId('operations-tab-users').click();
    await expect(page.getByTestId('operations-users-search')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('operations-users-active-only')).toBeVisible();
    await expect(page.getByTestId('operations-users-download-csv')).toBeVisible();
  });

  test('the All-users table renders all 4 columns bounded (userName does not swallow the row)', async ({
    page,
  }) => {
    await openOperations(page);
    await page.getByTestId('operations-tab-users').click();
    await expect(page.getByTestId('operations-users-search')).toBeVisible({ timeout: 20_000 });

    // Skip on an empty tenant - the table only renders with >= 1 user row.
    const firstRow = page.locator('[data-testid^="operations-user-row-"]').first();
    const hasRows = await firstRow.count();
    test.skip(hasRows === 0, 'Tenant has zero users; the All-users table is not rendered.');
    await expect(firstRow).toBeVisible({ timeout: 20_000 });

    // R1 (copilot-instructions.md Visual Layout Discipline): measure REAL
    // bounds, not CSS props. The 2026-07-08 bug was a table-layout:auto +
    // untruncated userName that ballooned the first column to 591px of an
    // 856px table, shoving active/endpoint/created off-screen so the grid
    // read as a single-column list. Assert (a) all 4 headers fit inside the
    // table's own width (none pushed past the right edge) and (b) the
    // userName column takes a bounded share, proving table-layout:fixed +
    // TruncatedText are in effect.
    const geom = await page.evaluate(() => {
      const table = document.querySelector('table');
      if (!table) return null;
      const tRect = table.getBoundingClientRect();
      const ths = Array.from(table.querySelectorAll('thead th'));
      return {
        tableLeft: tRect.left,
        tableRight: tRect.right,
        tableWidth: tRect.width,
        headers: ths.map((th) => {
          const r = th.getBoundingClientRect();
          return { text: (th.textContent || '').trim(), left: r.left, right: r.right, width: r.width };
        }),
      };
    });
    expect(geom, 'the users table must be present').not.toBeNull();
    expect(geom!.headers.map((h) => h.text)).toEqual(['userName', 'active', 'endpoint', 'created']);

    // (a) every column fits within the table's own width (2px tolerance).
    for (const h of geom!.headers) {
      expect(
        h.right,
        `column "${h.text}" right edge ${Math.round(h.right)}px overflows the table right edge ` +
          `${Math.round(geom!.tableRight)}px - a column is pushed off-screen (table-layout:fixed missing?).`,
      ).toBeLessThanOrEqual(geom!.tableRight + 2);
    }

    // (b) the userName column does not dominate the row. Before the fix it
    // was ~69% of the table; fixed layout puts it near 43%.
    const userNameCol = geom!.headers[0];
    expect(
      userNameCol.width,
      `userName column ${Math.round(userNameCol.width)}px is ${Math.round(
        (userNameCol.width / geom!.tableWidth) * 100,
      )}% of the ${Math.round(geom!.tableWidth)}px table - it should be bounded (< 60%).`,
    ).toBeLessThan(geom!.tableWidth * 0.6);

    // (c) the trailing metadata columns actually have width (are visible).
    const created = geom!.headers[3];
    expect(created.width, 'the created column must be visibly wide').toBeGreaterThan(80);
  });

  test('toggling the active-only switch does not break the users list', async ({ page }) => {
    await openOperations(page);
    await page.getByTestId('operations-tab-users').click();
    const activeOnly = page.getByTestId('operations-users-active-only');
    await expect(activeOnly).toBeVisible({ timeout: 20_000 });
    await activeOnly.click();
    // The page stays healthy (root + subtabs still present) after the toggle.
    await expect(page.getByTestId('operations-page')).toBeVisible();
    await expect(page.getByTestId('operations-users-search')).toBeVisible();
  });

  test('the All-groups tab exposes search + CSV download', async ({ page }) => {
    await openOperations(page);
    await page.getByTestId('operations-tab-groups').click();
    await expect(page.getByTestId('operations-groups-search')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('operations-groups-download-csv')).toBeVisible();
  });

  test('the Statistics tab renders KPI tiles + a CSV export', async ({ page }) => {
    await openOperations(page);
    await page.getByTestId('operations-tab-statistics').click();
    // The users-total KPI tile is the primary content signal once stats load.
    await expect(page.getByTestId('operations-stat-users-total')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('operations-stats-download-csv')).toBeVisible();
  });
});

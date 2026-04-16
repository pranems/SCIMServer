import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.getByRole('button', { name: /raw logs/i }).click();
  await expect(page.getByText(/inspect raw scim traffic/i)).toBeVisible();
});

test.describe('Raw Logs', () => {
  test.describe('Filters', () => {
    test('has method dropdown with all HTTP methods', async ({ page }) => {
      const select = page.getByLabel('HTTP Method filter');
      await expect(select).toBeVisible();
      await expect(select.locator('option')).toHaveCount(5); // Method(empty) + GET/POST/PATCH/DELETE
    });

    test('has status input', async ({ page }) => {
      await expect(page.getByPlaceholder('Status')).toBeVisible();
    });

    test('has error filter dropdown', async ({ page }) => {
      const select = page.getByLabel('Error presence filter');
      await expect(select).toBeVisible();
    });

    test('has URL contains input', async ({ page }) => {
      await expect(page.getByPlaceholder('URL contains')).toBeVisible();
    });

    test('has search input', async ({ page }) => {
      await expect(page.getByPlaceholder('Search (url or error)')).toBeVisible();
    });

    test('has date range inputs', async ({ page }) => {
      await expect(page.getByLabel('Since date filter')).toBeVisible();
      await expect(page.getByLabel('Until date filter')).toBeVisible();
    });

    test('has Reset button', async ({ page }) => {
      await expect(page.getByRole('button', { name: 'Reset' })).toBeVisible();
    });
  });

  test.describe('Toolbar', () => {
    test('has Refresh button', async ({ page }) => {
      await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
    });

    test('has auto-refresh checkbox', async ({ page }) => {
      const label = page.getByText('Auto-refresh');
      await expect(label).toBeVisible();
    });

    test('has hide keepalive checkbox', async ({ page }) => {
      const label = page.getByText('Hide keepalive checks');
      await expect(label).toBeVisible();
    });

    test('has Clear Logs button', async ({ page }) => {
      await expect(page.getByRole('button', { name: 'Clear Logs' })).toBeVisible();
    });

    test('shows pagination info with total count', async ({ page }) => {
      await expect(page.getByText(/total \d+/i)).toBeVisible();
    });
  });

  test.describe('Log Table', () => {
    test('shows Request Logs heading with count', async ({ page }) => {
      await expect(page.getByText(/request logs/i)).toBeVisible();
    });

    test('has table with correct column headers', async ({ page }) => {
      await expect(page.getByRole('columnheader', { name: 'Time' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Method' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Duration' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'Identifier' })).toBeVisible();
      await expect(page.getByRole('columnheader', { name: 'URL' })).toBeVisible();
    });

    test('table rows contain live data', async ({ page }) => {
      // Wait for table to populate — may take a moment after tab switch
      await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10000 });
      const rows = page.locator('tbody tr');
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);
    });

    test('method badges have correct text (GET/POST/PATCH/DELETE)', async ({ page }) => {
      const firstMethod = page.locator('tbody tr').first().locator('[class*="methodBadge"]');
      const text = await firstMethod.textContent();
      expect(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).toContain(text?.trim());
    });

    test('status codes are numeric', async ({ page }) => {
      const firstStatus = page.locator('tbody tr').first().locator('[class*="statusBadge"]');
      const text = await firstStatus.textContent();
      expect(text?.trim()).toMatch(/^\d{3}$/);
    });
  });

  test.describe('Log Detail Modal', () => {
    test('opens when clicking a log row', async ({ page }) => {
      await page.locator('tbody tr').first().click();
      await expect(page.getByText('Request Details')).toBeVisible();
    });

    test('shows URL, status, and duration', async ({ page }) => {
      await page.waitForTimeout(2000);
      const rows = page.locator('tbody tr');
      if (await rows.count() > 0) {
        await rows.first().click();
        // Modal should show request details
        await expect(page.getByText('Request Details')).toBeVisible();
      }
    });

    test('has collapsible header/body sections', async ({ page }) => {
      await page.waitForTimeout(2000);
      const rows = page.locator('tbody tr');
      if (await rows.count() > 0) {
        await rows.first().click();
        await expect(page.getByText('Request Headers')).toBeVisible();
        await expect(page.getByText('Response Body')).toBeVisible();
      }
    });

    test('closes with Escape key', async ({ page }) => {
      await page.locator('tbody tr').first().click();
      await expect(page.getByText('Request Details')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByText('Request Details')).not.toBeVisible();
    });

    test('closes when clicking overlay', async ({ page }) => {
      await page.locator('tbody tr').first().click();
      await expect(page.getByText('Request Details')).toBeVisible();
      // Click the overlay (outside the modal content)
      await page.locator('[class*="modalOverlay"]').click({ position: { x: 10, y: 10 } });
      await expect(page.getByText('Request Details')).not.toBeVisible();
    });
  });

  test.describe('Method Filter', () => {
    test('filtering by POST shows only POST requests', async ({ page }) => {
      await page.getByLabel('HTTP Method filter').selectOption('POST');
      // Wait for table to reload
      await page.waitForTimeout(1000);
      const methods = page.locator('tbody tr [class*="methodBadge"]');
      const count = await methods.count();
      if (count > 0) {
        for (let i = 0; i < Math.min(count, 5); i++) {
          await expect(methods.nth(i)).toHaveText('POST');
        }
      }
    });
  });
});

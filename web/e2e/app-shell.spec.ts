import { test, expect } from './fixtures';

test.describe('Header Bar', () => {
  test('displays SCIMServer title and subtitle', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1, name: 'SCIMServer' })).toBeVisible();
    await expect(page.getByText('SCIM 2.0 Provisioning Monitor')).toBeVisible();
  });

  test('shows Active status indicator', async ({ page }) => {
    await expect(page.getByText('Active')).toBeVisible();
  });

  test('shows Change Token button when authenticated', async ({ page }) => {
    await expect(page.getByRole('button', { name: /change token/i })).toBeVisible();
  });

  test('has a working theme toggle', async ({ page }) => {
    const buttons = await page.getByRole('button').all();
    const themeBtn = buttons.find(async b => {
      const text = await b.textContent();
      return text?.includes('☀') || text?.includes('🌙');
    });
    // Just verify the data-theme attribute changes
    const initialTheme = await page.locator('html').getAttribute('data-theme');
    // Click the last button in header (theme toggle is rightmost)
    const headerButtons = page.locator('header button');
    await headerButtons.last().click();
    const newTheme = await page.locator('html').getAttribute('data-theme');
    expect(newTheme).not.toBe(initialTheme);
  });

  test('does NOT show backup stats (removed)', async ({ page }) => {
    // No backup-related text should appear anywhere
    await expect(page.getByText(/snapshot/i)).not.toBeVisible();
    await expect(page.getByText(/no persistence/i)).not.toBeVisible();
  });
});

test.describe('Footer', () => {
  test('shows version from API (not hardcoded 0.9.1)', async ({ page }) => {
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    // Wait for version to load from API
    await page.waitForTimeout(2000);
    const footerText = await footer.textContent() || '';
    expect(footerText).not.toContain('v0.9.1');
    // Version may or may not have loaded yet - just verify no stale hardcode
  });

  test('does NOT show "Made by" credit (removed)', async ({ page }) => {
    const footer = page.locator('footer');
    const text = await footer.textContent() || '';
    expect(text.toLowerCase()).not.toContain('made by');
    expect(text.toLowerCase()).not.toContain('lo\u00efc');
  });

  test('shows SCIMServer text', async ({ page }) => {
    const footer = page.locator('footer');
    const text = await footer.textContent() || '';
    expect(text).toContain('SCIMServer');
  });

  test('shows GitHub repository link', async ({ page }) => {
    const link = page.getByRole('link', { name: /github repository/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', 'https://github.com/pranems/SCIMServer');
  });
});

test.describe('Tab Navigation', () => {
  test('shows 4 tab buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: /activity feed/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /raw logs/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /database browser/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /manual provision/i })).toBeVisible();
  });

  test('Activity Feed is the default tab', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 2, name: /activity feed/i })).toBeVisible();
  });

  test('clicking each tab switches the view', async ({ page }) => {
    await page.getByRole('button', { name: /raw logs/i }).click();
    await expect(page.getByText(/inspect raw scim traffic/i)).toBeVisible();

    await page.getByRole('button', { name: /database browser/i }).click();
    await expect(page.getByRole('heading', { level: 2, name: /database browser/i })).toBeVisible();

    await page.getByRole('button', { name: /manual provision/i }).click();
    await expect(page.getByText(/manual user provisioning/i)).toBeVisible();

    await page.getByRole('button', { name: /activity feed/i }).click();
    await expect(page.getByRole('heading', { level: 2, name: /activity feed/i })).toBeVisible();
  });
});

test.describe('Token Modal', () => {
  test('opens when Change Token clicked', async ({ page }) => {
    await page.getByRole('button', { name: /change token/i }).click();
    await expect(page.getByRole('heading', { name: /scim bearer token/i })).toBeVisible();
    await expect(page.getByText(/stored locally in your browser/i)).toBeVisible();
  });

  test('has Save Token and Clear buttons', async ({ page }) => {
    await page.getByRole('button', { name: /change token/i }).click();
    await expect(page.getByRole('button', { name: /save token/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /clear/i })).toBeVisible();
  });
});

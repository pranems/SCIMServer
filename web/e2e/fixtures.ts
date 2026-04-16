import { test as base, expect } from '@playwright/test';

/**
 * Shared fixture that authenticates once per test by setting the bearer token.
 * Uses SCIM_SHARED_SECRET env var or defaults to 'local-secret'.
 */
export const test = base.extend<{ authenticated: void }>({
  authenticated: [async ({ page }, use) => {
    const token = process.env.E2E_TOKEN || 'local-secret';
    await page.goto('/');
    // Wait for token modal
    const tokenInput = page.getByRole('textbox', { name: /S3cret/i });
    if (await tokenInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tokenInput.fill(token);
      await page.getByRole('button', { name: 'Save Token' }).click();
      // Wait for modal to close and data to load
      await expect(page.getByRole('heading', { level: 2 })).toBeVisible();
    }
    await use();
  }, { auto: true }],
});

export { expect };

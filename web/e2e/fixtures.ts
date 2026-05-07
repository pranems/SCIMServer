import { test as base, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Directory for all UI screenshots */
const SCREENSHOT_DIR = path.resolve(__dirname, '..', '..', 'test-results', 'ui-screenshots');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

/**
 * Helper to save a named screenshot to the shared screenshot directory.
 */
export async function saveScreenshot(page: any, name: string): Promise<void> {
  const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(SCREENSHOT_DIR, `${sanitized}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
}

/**
 * Shared fixture that authenticates once per test by setting the bearer token.
 * Uses SCIM_SHARED_SECRET env var or defaults to 'local-secret'.
 */
export const test = base.extend<{ authenticated: void }>({
  authenticated: [async ({ page }, use) => {
    const token = process.env.E2E_TOKEN || 'local-secret';
    await page.goto('/');
    // Wait for token modal (legacy UI only - new UI may not show it)
    const tokenInput = page.getByRole('textbox', { name: /S3cret/i });
    if (await tokenInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tokenInput.fill(token);
      await page.getByRole('button', { name: 'Save Token' }).click();
      // Wait for content to load
      await page.waitForTimeout(1000);
    }
    await use();
  }, { auto: true }],
});

export { expect, SCREENSHOT_DIR };

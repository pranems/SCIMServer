import { defineConfig } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:4000';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  workers: 3,
  retries: 0,
  globalSetup: './e2e/global-setup.ts',
  reporter: [['list'], ['html', { open: 'never', outputFolder: '../test-results/playwright-report' }]],
  outputDir: '../test-results/playwright-output',
  use: {
    baseURL,
    storageState: {
      cookies: [],
      origins: [{
        origin: new URL(baseURL).origin,
        localStorage: [{
          name: 'scimserver.onboarding.completedAt',
          value: 'e2e-default-complete',
        }],
      }],
    },
    headless: true,
    screenshot: 'on',
    trace: 'retain-on-failure',
    actionTimeout: 5_000,
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});

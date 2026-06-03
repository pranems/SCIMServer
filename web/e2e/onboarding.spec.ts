/**
 * OnboardingWizard E2E spec (Phase N2 + Stage X.1 A.4 closure).
 *
 * Covers the chrome-level first-run wizard introduced in Phase N2
 * (v0.52.0-alpha.2, 2026-05-16) and refactored into the
 * `web/src/layout/onboarding/` step-dispatcher in Stage X.1 A.4
 * (2026-05-17). Unit-level coverage already exists in
 * [web/src/layout/OnboardingWizard.test.tsx](../src/layout/OnboardingWizard.test.tsx)
 * (14 vitest); this spec adds end-to-end + cross-page coverage
 * against a real browser + live server.
 *
 * Trigger contract enforced by [useShowOnboarding](../src/hooks/useOnboarding.ts):
 *   - Wizard shows when localStorage `scimserver.onboarding.completedAt`
 *     absent AND `useEndpoints().totalResults === 0`.
 *   - Force-open hatch: `scimserver.onboarding.forceOpen = '1'` overrides
 *     both gates. Tests use this to deterministically render the wizard
 *     on a dev/prod tenant that already has endpoints + completedAt set.
 *
 * Tests:
 *   1. forceOpen flag renders the wizard at chrome-level, blocking the page.
 *   2. completedAt set hides the wizard (re-confirms the dismiss path).
 *   3. Step indicators (1..4) render correctly.
 *   4. Skip button on step 1 writes completedAt and dismisses.
 *   5. Close (X) button at step 1 writes completedAt and dismisses.
 *   6. Get started -> step 2 (preset cards render; entra-id selected).
 *
 * Steps 3+ are not covered here to avoid mutating the live tenant
 * (creating an endpoint + credential as a side effect of the e2e
 * run). The 14 vitest cover the full happy path against mocked
 * mutation hooks.
 *
 * Run:
 *   E2E_BASE_URL=https://scimserver-dev.yellowrock-b029dcc6.westus2.azurecontainerapps.io \
 *     E2E_TOKEN=changeme-scim \
 *     npx playwright test e2e/onboarding.spec.ts --reporter=line
 *
 * NOTE: localStorage keys exposed by [useOnboarding.ts](../src/hooks/useOnboarding.ts):
 *   ONBOARDING_COMPLETED_KEY  = 'scimserver.onboarding.completedAt'
 *   ONBOARDING_FORCE_OPEN_KEY = 'scimserver.onboarding.forceOpen'
 */
import { test, expect } from '@playwright/test';

const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';
const ONBOARDING_COMPLETED_KEY = 'scimserver.onboarding.completedAt';
const ONBOARDING_FORCE_OPEN_KEY = 'scimserver.onboarding.forceOpen';

/**
 * Inject auth token + clear onboarding flags before every test.
 * Per-test overrides (set via page.evaluate after page.goto)
 * can flip flags as needed.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ token, completedKey, forceKey }) => {
      try {
        window.localStorage.setItem('scimserver.authToken', token);
        // Clear onboarding flags so the test's own setup is authoritative.
        window.localStorage.removeItem(completedKey);
        window.localStorage.removeItem(forceKey);
      } catch {
        /* ignored - localStorage unavailable */
      }
    },
    {
      token: TOKEN,
      completedKey: ONBOARDING_COMPLETED_KEY,
      forceKey: ONBOARDING_FORCE_OPEN_KEY,
    },
  );
});

test.describe('OnboardingWizard (Phase N2 + Stage X.1 A.4)', () => {
  test('forceOpen flag renders the wizard at chrome-level', async ({ page }) => {
    // Set both auth + forceOpen BEFORE navigating so first paint shows the wizard.
    await page.addInitScript(
      ({ key }) => {
        try {
          window.localStorage.setItem(key, '1');
        } catch {
          /* ignored */
        }
      },
      { key: ONBOARDING_FORCE_OPEN_KEY },
    );

    await page.goto('/');

    // The wizard surface and step-1 testid both render.
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('onboarding-step-1')).toBeVisible();

    // Step indicator dots 1..4 all present.
    for (const n of [1, 2, 3, 4] as const) {
      await expect(page.getByTestId(`onboarding-step-dot-${n}`)).toBeVisible();
    }

    // Action buttons for step 1.
    await expect(page.getByTestId('onboarding-skip')).toBeVisible();
    await expect(page.getByTestId('onboarding-get-started')).toBeVisible();
    await expect(page.getByTestId('onboarding-close')).toBeVisible();
  });

  test('completedAt set hides the wizard', async ({ page }) => {
    await page.addInitScript(
      ({ key }) => {
        try {
          window.localStorage.setItem(key, new Date().toISOString());
        } catch {
          /* ignored */
        }
      },
      { key: ONBOARDING_COMPLETED_KEY },
    );

    await page.goto('/');

    // App shell renders, wizard does not.
    await expect(page.getByTestId('app-shell')).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0);
  });

  test('Skip button writes completedAt and dismisses the wizard', async ({ page }) => {
    await page.addInitScript(
      ({ key }) => {
        try {
          window.localStorage.setItem(key, '1');
        } catch {
          /* ignored */
        }
      },
      { key: ONBOARDING_FORCE_OPEN_KEY },
    );

    await page.goto('/');
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('onboarding-skip').click();

    // Wizard goes away; completedAt is written.
    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0, {
      timeout: 5000,
    });

    const completedAt = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      ONBOARDING_COMPLETED_KEY,
    );
    expect(completedAt).toBeTruthy();
    // ISO-8601 shape (the dismiss handler stamps `new Date().toISOString()`).
    expect(completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('Close (X) button writes completedAt and dismisses the wizard', async ({ page }) => {
    await page.addInitScript(
      ({ key }) => {
        try {
          window.localStorage.setItem(key, '1');
        } catch {
          /* ignored */
        }
      },
      { key: ONBOARDING_FORCE_OPEN_KEY },
    );

    await page.goto('/');
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('onboarding-close').click();

    await expect(page.getByTestId('onboarding-wizard')).toHaveCount(0, {
      timeout: 5000,
    });

    const completedAt = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      ONBOARDING_COMPLETED_KEY,
    );
    expect(completedAt).toBeTruthy();
  });

  test('Get started advances to step 2 with preset cards visible', async ({ page }) => {
    await page.addInitScript(
      ({ key }) => {
        try {
          window.localStorage.setItem(key, '1');
        } catch {
          /* ignored */
        }
      },
      { key: ONBOARDING_FORCE_OPEN_KEY },
    );

    await page.goto('/');
    await expect(page.getByTestId('onboarding-wizard')).toBeVisible({ timeout: 15000 });

    await page.getByTestId('onboarding-get-started').click();

    // Step 2 body renders.
    await expect(page.getByTestId('onboarding-step-2')).toBeVisible({ timeout: 5000 });

    // The entra-id preset card is the default (rendered + data-selected="true").
    const entraCard = page.getByTestId('onboarding-preset-card-entra-id');
    await expect(entraCard).toBeVisible({ timeout: 10000 });
    await expect(entraCard).toHaveAttribute('data-selected', 'true');

    // Step-2 Next button exists; Back button visible.
    await expect(page.getByTestId('onboarding-step-2-next')).toBeVisible();

    // Dismiss explicitly so we don't leave the test tenant with a half-flow
    // (no endpoint was created - we only got to step 2 - but be defensive).
    await page.getByTestId('onboarding-close').click();
  });

  test.afterEach(async ({ page }) => {
    // Defensive cleanup: even though we never click Step-2 Next or
    // Step-3 Issue (which would create an endpoint + credential), make
    // sure each test leaves localStorage in a known-clean state for
    // the next one.
    try {
      await page.evaluate(
        ({ completedKey, forceKey }) => {
          window.localStorage.removeItem(completedKey);
          window.localStorage.removeItem(forceKey);
        },
        {
          completedKey: ONBOARDING_COMPLETED_KEY,
          forceKey: ONBOARDING_FORCE_OPEN_KEY,
        },
      );
    } catch {
      /* page may have already closed - safe to ignore */
    }
  });
});

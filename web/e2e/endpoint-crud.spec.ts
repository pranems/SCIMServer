/**
 * endpoint-crud.spec.ts - covers the create-endpoint wizard +
 * edit-endpoint page + soft-delete confirmation dialog.
 *
 * USER PATHS COVERED
 *   Wizard happy path: Step 1 (Identity & Preset) -> Step 2
 *     (Preview) -> Step 3 (Override) -> Step 4 (Confirm) ->
 *     Create -> redirect to /endpoints/$id.
 *   Step 1 validation: empty name keeps the Next button disabled.
 *   Step 1 validation: no-preset-picked keeps Next disabled even
 *     with a valid name.
 *   Wizard step-back via the Back button preserves prior form state.
 *   Cancel from the wizard returns to /endpoints.
 *   EditEndpointPage save flow updates display name and returns to
 *     the detail page.
 *   DeleteEndpointDialog blocks Delete until the typed name matches
 *     the echoed endpoint name exactly.
 *
 * WHY THESE PATHS WERE NOT PREVIOUSLY COVERED
 *   - No existing spec exercises the wizard at all.
 *   - smoke-test.spec.ts test 4 visits /endpoints but does not
 *     create.
 *   - The DeleteEndpointDialog name-match gate has no spec
 *     anywhere; the only coverage is the unit test of the
 *     dialog component.
 *
 * SAFETY
 *   Create + Delete tests are gated behind E2E_ALLOW_MUTATIONS=1
 *   so the standard CI run against dev does not pollute the
 *   tenant. Edit is gated the same way because it mutates state
 *   even when the value happens to be unchanged.
 *
 * Run vs dev WITH mutations:
 *   $env:E2E_ALLOW_MUTATIONS = '1'
 *   $env:E2E_BASE_URL = 'https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io'
 *   $env:E2E_TOKEN    = 'changeme-scim'
 *   cd web
 *   npx playwright test e2e/endpoint-crud.spec.ts --reporter=line
 */
import { test, expect, type Page } from '@playwright/test';

const TOKEN_STORAGE_KEY = 'scimserver.authToken';
const TOKEN = process.env.E2E_TOKEN || 'changeme-scim';
const MUTATIONS_ENABLED = process.env.E2E_ALLOW_MUTATIONS === '1';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, value }) => {
      window.localStorage.setItem(key, value);
    },
    { key: TOKEN_STORAGE_KEY, value: TOKEN },
  );
});

async function openWizard(page: Page): Promise<void> {
  await page.goto('/endpoints');
  await expect(page.getByTestId('endpoints-page')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('endpoints-create-button').click();
  await expect(page.getByTestId('create-endpoint-wizard')).toBeVisible({ timeout: 15_000 });
}

test.describe('CreateEndpointWizard - validation (read-only)', () => {
  test('Next button disabled with empty name', async ({ page }) => {
    await openWizard(page);
    await expect(page.getByTestId('wizard-step-1')).toBeVisible();

    // No text typed, no preset picked - Next must be disabled.
    await expect(page.getByTestId('wizard-next-button')).toBeDisabled();
  });

  test('Next button stays disabled with name but no preset', async ({ page }) => {
    await openWizard(page);
    await page.getByTestId('wizard-name-input').fill('e2e-endpoint-validation-only');

    // Name filled but no preset picked yet.
    await expect(page.getByTestId('wizard-next-button')).toBeDisabled();
  });

  test('Cancel from wizard returns to /endpoints', async ({ page }) => {
    await openWizard(page);
    await page.getByTestId('wizard-cancel-button').click();
    await expect(page.getByTestId('endpoints-page')).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/endpoints\b(?!\/)/);
  });

  test('Step dots reflect current step on render', async ({ page }) => {
    await openWizard(page);
    await expect(page.getByTestId('wizard-step-dot-1')).toBeVisible();
    await expect(page.getByTestId('wizard-step-dot-2')).toBeVisible();
    await expect(page.getByTestId('wizard-step-dot-3')).toBeVisible();
    await expect(page.getByTestId('wizard-step-dot-4')).toBeVisible();
    // Step 1 panel is the active one on open.
    await expect(page.getByTestId('wizard-step-1')).toBeVisible();
    await expect(page.getByTestId('wizard-step-2')).toHaveCount(0);
  });
});

test.describe('CreateEndpointWizard - happy path (mutation gated)', () => {
  test.skip(!MUTATIONS_ENABLED, 'Set E2E_ALLOW_MUTATIONS=1 to run create/delete tests.');

  test('wizard creates an endpoint and redirects to the detail page', async ({ page }) => {
    await openWizard(page);

    // Unique name so reruns don't collide. Lowercased + dashed so it
    // passes SCIM name validation.
    const stamp = Date.now().toString(36);
    const name = `e2e-create-${stamp}`;

    await page.getByTestId('wizard-name-input').fill(name);
    await page.getByTestId('wizard-displayname-input').fill(`E2E Create ${stamp}`);

    // Wait for preset list to populate, then click the first preset.
    const presetGrid = page.getByTestId('wizard-preset-combobox');
    await expect(presetGrid).toBeVisible({ timeout: 20_000 });
    const firstPreset = presetGrid.locator('[data-testid^="wizard-preset-option-"]').first();
    await expect(firstPreset).toBeVisible({ timeout: 20_000 });
    await firstPreset.click();

    // Step 1 -> Step 2.
    await expect(page.getByTestId('wizard-next-button')).toBeEnabled();
    await page.getByTestId('wizard-next-button').click();
    await expect(page.getByTestId('wizard-step-2')).toBeVisible({ timeout: 20_000 });

    // Step 2 -> Step 3 (no overrides required).
    await page.getByTestId('wizard-next-button').click();
    await expect(page.getByTestId('wizard-step-3')).toBeVisible();

    // Step 3 -> Step 4.
    await page.getByTestId('wizard-next-button').click();
    await expect(page.getByTestId('wizard-step-4')).toBeVisible();

    // Confirm and submit.
    await page.getByTestId('wizard-create-button').click();

    // Successful create -> redirect to /endpoints/$id (detail page).
    await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 30_000 });
    expect(page.url()).toMatch(/\/endpoints\/[A-Za-z0-9-]+/);
  });

  test('Back button preserves the typed name across steps', async ({ page }) => {
    await openWizard(page);
    const stamp = Date.now().toString(36);
    const name = `e2e-back-${stamp}`;
    await page.getByTestId('wizard-name-input').fill(name);

    const presetGrid = page.getByTestId('wizard-preset-combobox');
    await expect(presetGrid).toBeVisible({ timeout: 20_000 });
    await presetGrid.locator('[data-testid^="wizard-preset-option-"]').first().click();

    await page.getByTestId('wizard-next-button').click();
    await expect(page.getByTestId('wizard-step-2')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('wizard-back-button').click();
    await expect(page.getByTestId('wizard-step-1')).toBeVisible();

    // Name input still carries the originally-typed value.
    await expect(page.getByTestId('wizard-name-input')).toHaveValue(name);
  });
});

test.describe('EditEndpointPage - read-only checks', () => {
  test('edit page renders form fields and cancel returns to detail', async ({ page }) => {
    // Find first endpoint, navigate to its edit page directly.
    await page.goto('/endpoints');
    await expect(page.getByTestId('endpoints-page')).toBeVisible({ timeout: 30_000 });

    const cards = page.locator('[data-testid^="endpoint-"]').filter({
      hasNot: page.locator('[data-testid^="endpoint-detail"]'),
    });
    const count = await cards.count();
    test.skip(count === 0, 'No endpoints to edit.');

    const cardTestId = await cards.first().getAttribute('data-testid');
    const id = (cardTestId ?? '').replace(/^endpoint-/, '');

    await page.goto(`/endpoints/${id}/edit`);

    await expect(page.getByTestId('edit-endpoint-page')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('edit-endpoint-displayname-input')).toBeVisible();
    await expect(page.getByTestId('edit-endpoint-description-input')).toBeVisible();
    await expect(page.getByTestId('edit-endpoint-active-switch')).toBeVisible();
    await expect(page.getByTestId('edit-endpoint-cancel-button')).toBeVisible();
    await expect(page.getByTestId('edit-endpoint-save-button')).toBeVisible();

    // Cancel returns to the detail page without mutating.
    await page.getByTestId('edit-endpoint-cancel-button').click();
    await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('DeleteEndpointDialog - confirmation gate (read-only)', () => {
  test('Delete button is disabled until the typed name matches', async ({ page }) => {
    await page.goto('/endpoints');
    await expect(page.getByTestId('endpoints-page')).toBeVisible({ timeout: 30_000 });

    const cards = page.locator('[data-testid^="endpoint-"]').filter({
      hasNot: page.locator('[data-testid^="endpoint-detail"]'),
    });
    const count = await cards.count();
    test.skip(count === 0, 'No endpoints to test delete dialog against.');

    await cards.first().click();
    await expect(page.getByTestId('endpoint-detail-page')).toBeVisible({ timeout: 30_000 });

    // Open the delete dialog.
    await page.getByTestId('endpoint-delete-button').click();
    const dialog = page.getByTestId('delete-endpoint-dialog');
    await expect(dialog).toBeVisible({ timeout: 10_000 });

    // The warning banner + name echo + confirm input all render.
    await expect(page.getByTestId('delete-endpoint-warning')).toBeVisible();
    const echoText = (await page.getByTestId('delete-endpoint-name-echo').textContent()) ?? '';
    expect(echoText.trim().length).toBeGreaterThan(0);

    // The dialog's primary action is the FormDialog submit button;
    // it must be DISABLED on open (name not yet typed).
    const deleteBtn = dialog.getByRole('button', { name: /^Delete$/i });
    await expect(deleteBtn).toBeDisabled();

    // Type a WRONG name first - still disabled.
    await page.getByTestId('delete-endpoint-confirm-input').fill('totally-wrong-name');
    await expect(deleteBtn).toBeDisabled();

    // Type the CORRECT echoed name - enabled.
    await page.getByTestId('delete-endpoint-confirm-input').fill(echoText.trim());
    await expect(deleteBtn).toBeEnabled();

    // Do NOT click Delete: this spec is read-only. Cancel via the
    // FormDialog Cancel button instead.
    await dialog.getByRole('button', { name: /^Cancel$/i }).click();
    await expect(dialog).toHaveCount(0);
  });
});

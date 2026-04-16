import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.getByRole('button', { name: /manual provision/i }).click();
  await expect(page.getByText(/manual user provisioning/i)).toBeVisible();
});

test.describe('Manual Provision', () => {
  test.describe('User Form', () => {
    test('shows Manual User Provisioning heading', async ({ page }) => {
      await expect(page.getByText(/manual user provisioning/i)).toBeVisible();
    });

    test('has userName input with placeholder', async ({ page }) => {
      await expect(page.getByPlaceholder('user@example.com')).toBeVisible();
    });

    test('has externalId input', async ({ page }) => {
      // The externalId field has a label with key emoji
      await expect(page.getByText(/externalid/i).first()).toBeVisible();
    });

    test('has all form fields', async ({ page }) => {
      await expect(page.getByPlaceholder('user@example.com')).toBeVisible();
      // Check for label text
      await expect(page.getByText(/givenname/i)).toBeVisible();
      await expect(page.getByText(/familyname/i)).toBeVisible();
    });

    test('Create User button is disabled without userName', async ({ page }) => {
      const btn = page.getByRole('button', { name: /create user/i });
      await expect(btn).toBeDisabled();
    });

    test('Create User button enables when userName is filled', async ({ page }) => {
      await page.getByPlaceholder('user@example.com').fill('e2e-test@example.com');
      const btn = page.getByRole('button', { name: /create user/i });
      await expect(btn).toBeEnabled();
    });

    test('Reset button clears the form', async ({ page }) => {
      await page.getByPlaceholder('user@example.com').fill('test@example.com');
      const resetButtons = page.getByRole('button', { name: /reset/i });
      await resetButtons.first().click();
      await expect(page.getByPlaceholder('user@example.com')).toHaveValue('');
    });

    test('shows collision testing guide disclosure', async ({ page }) => {
      await expect(page.getByText(/how to create collision scenarios/i)).toBeVisible();
    });

    test('Active checkbox is checked by default', async ({ page }) => {
      const checkbox = page.getByRole('checkbox', { name: /active/i });
      await expect(checkbox).toBeChecked();
    });

    test('creates a user and shows result', async ({ page }) => {
      const userName = `e2e-pw-${Date.now()}@test.com`;
      await page.getByPlaceholder('user@example.com').fill(userName);
      await page.getByRole('button', { name: /create user/i }).click();
      // Wait for success result section to appear
      await expect(page.locator('dt, dd').filter({ hasText: userName }).first()).toBeVisible({ timeout: 15000 });
    });

    test('shows error for duplicate userName', async ({ page }) => {
      const userName = `e2e-dup2-${Date.now()}@test.com`;
      await page.getByPlaceholder('user@example.com').fill(userName);
      await page.getByRole('button', { name: /create user/i }).click();
      // Wait for first creation
      await expect(page.locator('dt, dd').filter({ hasText: userName }).first()).toBeVisible({ timeout: 15000 });
      // Reset and retry
      await page.getByRole('button', { name: /reset/i }).first().click();
      await page.getByPlaceholder('user@example.com').fill(userName);
      await page.getByRole('button', { name: /create user/i }).click();
      // Error
      await expect(page.locator('[class*="error"]').filter({ hasText: /already exists|uniqueness/i })).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Group Form', () => {
    test('shows Manual Group Provisioning heading', async ({ page }) => {
      await expect(page.getByText(/manual group provisioning/i)).toBeVisible();
    });

    test('Create Group button is disabled without displayName', async ({ page }) => {
      const btn = page.getByRole('button', { name: /create group/i });
      await expect(btn).toBeDisabled();
    });

    test('has member IDs textarea', async ({ page }) => {
      await expect(page.getByRole('textbox', { name: /member ids/i })).toBeVisible();
    });

    test('creates a group and shows result', async ({ page }) => {
      const groupName = `E2E-Group-${Date.now()}`;
      const groupHeading = page.getByText(/manual group provisioning/i);
      await groupHeading.scrollIntoViewIfNeeded();
      const displayNameInputs = page.getByRole('textbox', { name: /displayname/i });
      await displayNameInputs.last().fill(groupName);
      await page.getByRole('button', { name: /create group/i }).click();
      // Wait for the group name to appear in the result
      await expect(page.locator('dt, dd').filter({ hasText: groupName }).first()).toBeVisible({ timeout: 15000 });
    });
  });
});

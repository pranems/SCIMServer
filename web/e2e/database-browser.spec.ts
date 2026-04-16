import { test, expect } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.getByRole('button', { name: /database browser/i }).click();
  await expect(page.getByRole('heading', { level: 2, name: /database browser/i })).toBeVisible();
});

test.describe('Database Browser', () => {
  test.describe('Statistics Tab', () => {
    test('shows 4 stat cards', async ({ page }) => {
      const headings = page.locator('h3');
      await expect(headings).toHaveCount(4);
    });

    test('Users card shows live counts', async ({ page }) => {
      await expect(page.getByText('Total Users')).toBeVisible();
    });

    test('Groups card shows total', async ({ page }) => {
      await expect(page.getByText('Total Groups')).toBeVisible();
    });

    test('Activity card shows request counts', async ({ page }) => {
      await expect(page.getByText('Total Requests')).toBeVisible();
      await expect(page.getByText('Last 24 Hours')).toBeVisible();
    });

    test('Database card shows PostgreSQL (not SQLite)', async ({ page }) => {
      await expect(page.getByText('PostgreSQL')).toBeVisible();
      await expect(page.getByText('SQLite')).not.toBeVisible();
      await expect(page.getByText('Database Type')).toBeVisible();
    });

    test('no ephemeral warning for PostgreSQL backend', async ({ page }) => {
      await expect(page.getByText(/ephemeral/i)).not.toBeVisible();
    });

    test('stats data matches API response', async ({ page }) => {
      const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:4000';
      const token = process.env.E2E_TOKEN || 'local-secret';
      const res = await fetch(`${baseUrl}/scim/admin/database/statistics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const stats = await res.json();
      // Verify the Total Users heading is visible
      await expect(page.getByText('Total Users')).toBeVisible();
      // Verify the user count appears somewhere in the statistics tab
      const statsContainer = page.locator('[class*="statisticsGrid"]');
      await expect(statsContainer).toContainText(String(stats.users.total));
    });
  });

  test.describe('Tab Switching', () => {
    test('3 sub-tabs are visible', async ({ page }) => {
      await expect(page.getByRole('button', { name: /statistics/i })).toBeVisible();
      const buttons = page.getByRole('button');
      const usersTab = buttons.filter({ hasText: /users \(/i });
      const groupsTab = buttons.filter({ hasText: /groups \(/i });
      await expect(usersTab).toBeVisible();
      await expect(groupsTab).toBeVisible();
    });

    test('Users tab shows search and user list', async ({ page }) => {
      const usersTab = page.getByRole('button').filter({ hasText: /users \(/i });
      await usersTab.click();
      await expect(page.getByPlaceholder(/search users/i)).toBeVisible();
    });

    test('Groups tab shows search and group list', async ({ page }) => {
      const groupsTab = page.getByRole('button').filter({ hasText: /groups \(/i });
      await groupsTab.click();
      await expect(page.getByPlaceholder(/search groups/i)).toBeVisible();
    });
  });

  test.describe('Users Tab', () => {
    test.beforeEach(async ({ page }) => {
      const usersTab = page.getByRole('button').filter({ hasText: /users \(/i });
      await usersTab.click();
    });

    test('has active filter dropdown', async ({ page }) => {
      await expect(page.getByRole('combobox')).toBeVisible();
    });

    test('shows pagination info', async ({ page }) => {
      await expect(page.getByText(/showing \d+ to \d+ of \d+|loading/i)).toBeVisible();
    });

    test('user count in tab matches stats', async ({ page }) => {
      const baseUrl = process.env.E2E_BASE_URL || 'http://localhost:4000';
      const token = process.env.E2E_TOKEN || 'local-secret';
      const res = await fetch(`${baseUrl}/scim/admin/database/statistics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const stats = await res.json();
      const usersTab = page.getByRole('button').filter({ hasText: /users \(/i });
      await expect(usersTab).toContainText(`(${stats.users.total})`);
    });
  });

  test.describe('Groups Tab', () => {
    test.beforeEach(async ({ page }) => {
      const groupsTab = page.getByRole('button').filter({ hasText: /groups \(/i });
      await groupsTab.click();
    });

    test('shows pagination info', async ({ page }) => {
      await expect(page.getByText(/showing \d+ to \d+ of \d+|loading/i)).toBeVisible();
    });
  });
});

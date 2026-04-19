import { expect, test, type Page } from '@playwright/test';

async function loginAsSeededAdmin(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill('e2e.admin.operator@example.com');
  await page.getByLabel('Password').fill('Password123!');
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL('/admin/exams');
}

test.describe('Admin route tree', () => {
  test.beforeEach(async ({ page }) => {
    // Ensure the seeded admin operator can authenticate through the real UI flows.
    await loginAsSeededAdmin(page);
  });

  test('unknown admin routes render the not found surface', async ({ page }) => {
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Route Not Found' })).toBeVisible();
  });

  test('admin can access all configured admin sections', async ({ page }) => {
    await page.goto('/admin/exams');
    await expect(page.getByRole('heading', { name: 'Exam Library' })).toBeVisible({ timeout: 15000 });

    await page.goto('/admin/library');
    await expect(page.getByRole('heading', { name: 'Content Library' })).toBeVisible({ timeout: 15000 });

    await page.goto('/admin/scheduling');
    await expect(page.getByRole('heading', { name: 'Exam Scheduler' })).toBeVisible({ timeout: 15000 });

    await page.goto('/admin/grading');
    await expect(page.getByRole('heading', { name: 'Grading Queue' })).toBeVisible({ timeout: 15000 });

    await page.goto('/admin/results');
    await expect(page.getByRole('heading', { name: 'Results & Analytics' })).toBeVisible({ timeout: 15000 });

    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'Global Exam Defaults' })).toBeVisible({ timeout: 15000 });
  });
});

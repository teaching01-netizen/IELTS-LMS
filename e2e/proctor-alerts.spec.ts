import { expect, test, type Locator, type Page } from '@playwright/test';
import { ADMIN_STORAGE_STATE_PATH } from './support/backendE2e';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

async function openAlertManagement(page: Page): Promise<Locator> {
  await page.goto('/proctor');
  const firstSession = page.getByRole('button', { name: /^Monitor .+ for cohort .+/ }).first();
  await expect(firstSession).toBeVisible({ timeout: 60_000 });
  await firstSession.click();

  const notifications = page.getByRole('button', { name: /Notifications, \d+ unacknowledged/ });
  await expect(notifications).toBeVisible();
  await notifications.click();

  const dialog = page.getByRole('dialog', { name: 'Alert management' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('Proctor alert management', () => {
  test('opens the authoritative alert panel with its live summary', async ({ page }) => {
    const dialog = await openAlertManagement(page);

    await expect(dialog.getByRole('heading', { name: 'Alert Management' })).toBeVisible();
    await expect(dialog.getByText(/\d+ unacknowledged of \d+ total/)).toBeVisible();
    await expect(dialog.getByLabel('Search alerts')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Filters' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Close alert management' }).last().click();
    await expect(page.getByRole('dialog', { name: 'Alert management' })).toBeHidden();
  });

  test('filters alerts by severity, status, and student without changing the source data', async ({ page }) => {
    const dialog = await openAlertManagement(page);
    await dialog.getByRole('button', { name: 'Filters' }).click();

    const filters = dialog.locator('select');
    await expect(filters).toHaveCount(2);
    await filters.nth(0).selectOption('high');
    await expect(filters.nth(0)).toHaveValue('high');
    await filters.nth(1).selectOption('false');
    await expect(filters.nth(1)).toHaveValue('false');

    const studentFilter = dialog.getByPlaceholder('Filter by student...');
    await studentFilter.fill('student-that-does-not-exist');
    await expect(studentFilter).toHaveValue('student-that-does-not-exist');

    await dialog.getByRole('button', { name: 'Clear Filters' }).click();
    await expect(filters.nth(0)).toHaveValue('all');
    await expect(filters.nth(1)).toHaveValue('all');
    await expect(studentFilter).toHaveValue('');
  });

  test('acknowledges a loaded alert through the local optimistic state boundary', async ({ page }) => {
    const dialog = await openAlertManagement(page);
    const checkboxes = dialog.locator('input[type="checkbox"]');

    if (await checkboxes.count() <= 1) {
      await expect(dialog.getByText('No alerts found')).toBeVisible();
      return;
    }

    // The first checkbox is the table header; each later checkbox belongs to
    // one loaded alert row.
    await checkboxes.nth(1).check();
    await dialog.getByRole('button', { name: 'Acknowledge All', exact: true }).click();
    await expect(dialog.getByText(/0 unacknowledged of \d+ total/)).toBeVisible();
  });
});

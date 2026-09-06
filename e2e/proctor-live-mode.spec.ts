import { expect, test } from '@playwright/test';
import {
  ADMIN_STORAGE_STATE_PATH,
  readBackendE2EManifest,
} from './support/backendE2e';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

test.describe('Proctor live mode and degraded state', () => {
  test.describe.configure({ timeout: 60_000 });

  async function openSeededCohort(page: import('@playwright/test').Page) {
    await page.goto('/proctor');
    await expect(page.getByRole('heading', { name: 'Cohorts and students' })).toBeVisible();
    await page.getByRole('button', {
      name: 'Monitor Student Backend E2E Delivery for cohort Backend E2E Cohort',
    }).click();
    await expect(page.getByRole('heading', { name: /Student Backend E2E Delivery · Backend E2E Cohort/ })).toBeVisible();
  }

  function headerConnectionStatus(page: import('@playwright/test').Page) {
    return page.getByRole('banner').getByRole('status');
  }

  test('starts in live mode and opens the live monitoring channel', async ({ page }) => {
    await page.goto('/proctor');

    await expect(headerConnectionStatus(page)).toContainText('Live');
    await openSeededCohort(page);
    await expect(page.getByRole('status', { name: 'Proctor presence' })).toBeVisible();
  });

  test('serves the authoritative live-mode snapshot for a schedule', async ({ page }) => {
    const manifest = readBackendE2EManifest();
    await page.goto('/proctor');

    const response = await page.request.get(
      `/api/v1/proctor/live-mode?scheduleId=${encodeURIComponent(manifest.student.scheduleId)}`,
    );
    expect(response.ok()).toBeTruthy();
    const snapshot = (await response.json()) as { degraded?: unknown; reason?: unknown };
    expect(typeof snapshot.degraded).toBe('boolean');
    if (snapshot.reason !== undefined && snapshot.reason !== null) {
      expect(typeof snapshot.reason).toBe('string');
    }
  });

});

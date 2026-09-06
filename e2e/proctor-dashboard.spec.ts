import { expect, test } from '@playwright/test';
import {
  ADMIN_STORAGE_STATE_PATH,
  readBackendE2EManifest,
  STUDENT_STORAGE_STATE_PATH,
} from './support/backendE2e';
import {
  completePreCheckIfPresent,
  openStudentSessionWithRetry,
  studentCheckIn,
  stubScreenDetails,
} from './support/studentUi';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

test.describe('Proctor dashboard and session monitoring', () => {
  test.describe.configure({ timeout: 60_000 });

  async function openSeededCohort(page: import('@playwright/test').Page) {
    await page.goto('/proctor');
    await expect(page.getByRole('heading', { name: 'Cohorts and students' })).toBeVisible();

    const cohort = page.getByRole('button', {
      name: 'Monitor Student Backend E2E Delivery for cohort Backend E2E Cohort',
    });
    await expect(cohort).toBeVisible();
    await cohort.click();
    await expect(page.getByRole('heading', { name: /Student Backend E2E Delivery · Backend E2E Cohort/ })).toBeVisible();
  }

  test('loads the active cohort overview', async ({ page }) => {
    await page.goto('/proctor');

    await expect(page.getByRole('heading', { name: 'Cohorts and students' })).toBeVisible();
    await expect(page.getByRole('tablist', { name: 'Overview sessions' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Active sessions \(\d+\)/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: /Monitor .* for cohort .*$/ }).first()).toBeVisible();
    await expect(page.getByText('Monitor Session').first()).toBeVisible();
  });

  test('separates past cohorts and exposes the past status filter', async ({ page }) => {
    await page.goto('/proctor');

    const pastTab = page.getByRole('tab', { name: /Past sessions \(\d+\)/ });
    await pastTab.click();
    await expect(pastTab).toHaveAttribute('aria-selected', 'true');

    const statusFilter = page.getByRole('combobox', { name: 'Past status' });
    await expect(statusFilter).toBeVisible();
    await expect(statusFilter.locator('option')).toHaveText(['All past', 'Completed', 'Cancelled']);
    await statusFilter.selectOption('completed');
    await expect(statusFilter).toHaveValue('completed');

    await page.getByRole('tab', { name: /Active sessions \(\d+\)/ }).click();
    await expect(page.getByRole('tab', { name: /Active sessions \(\d+\)/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('opens a cohort roster with monitoring controls', async ({ page }) => {
    await openSeededCohort(page);

    await expect(page.getByText(/visible students · join progress/)).toBeVisible();
    for (const name of ['Start Exam', 'Pause Cohort', 'Resume Cohort', 'Extend +5', 'Extend +10', 'End Section', 'Complete']) {
      await expect(page.getByRole('button', { name })).toBeVisible();
    }
    await expect(page.getByRole('status', { name: 'Proctor presence' })).toBeVisible();
  });

  test('filters the roster and switches list density', async ({ page }) => {
    await openSeededCohort(page);

    await page.getByRole('button', { name: 'Filters' }).click();
    const filters = page.locator('select');
    await expect(filters).toHaveCount(2);
    await filters.nth(0).selectOption('active');
    await filters.nth(1).selectOption('listening');
    await page.getByLabel('Minimum violations').fill('1');
    await page.getByLabel('Maximum time remaining in minutes').fill('30');

    await expect(page.getByRole('button', { name: 'Remove status filter' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove section filter' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove minimum violations filter' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove maximum time filter' })).toBeVisible();

    await page.getByRole('button', { name: 'Comfortable' }).click();
    await expect(page.getByRole('button', { name: 'Compact' })).toBeVisible();
    await page.getByRole('button', { name: 'Compact' }).click();
    await expect(page.getByRole('button', { name: 'Comfortable' })).toBeVisible();
  });

  test('opens student activity tabs from the roster', async ({ browser, page }) => {
    const manifest = readBackendE2EManifest();
    const studentContext = await browser.newContext({ storageState: STUDENT_STORAGE_STATE_PATH });
    await stubScreenDetails(studentContext);
    const studentPage = await studentContext.newPage();

    try {
      await studentCheckIn(studentPage, manifest.student.scheduleId, {
        wcode: manifest.student.candidateId,
        email: 'e2e.student@example.com',
        fullName: 'Alice Candidate',
      });
      await openStudentSessionWithRetry(studentPage, manifest.student.scheduleId, manifest.student.candidateId);
      await completePreCheckIfPresent(studentPage);

      await openSeededCohort(page);

      const student = page.getByRole('button', { name: 'Open Alice Candidate session details' });
      await expect(student).toBeVisible();
      await student.click();

      await expect(page.getByRole('button', { name: 'Close student details' })).toBeVisible();
      for (const tab of ['Timeline', 'Violations', 'Notes', 'Audit']) {
        await expect(page.getByRole('button', { name: tab, exact: true })).toBeVisible();
      }

      await page.getByRole('button', { name: 'Notes', exact: true }).click();
      await expect(page.getByLabel('Note category')).toBeVisible();
      await expect(page.getByLabel('Note content')).toBeVisible();
    } finally {
      await studentContext.close();
    }
  });

  test('searches the selected cohort roster', async ({ page }) => {
    await openSeededCohort(page);

    const search = page.getByPlaceholder('Search students...');
    await search.fill('does-not-exist');
    await expect(page.getByText('No students match the current cohort filters.')).toBeVisible();
    await expect(search).toHaveValue('does-not-exist');
  });
});

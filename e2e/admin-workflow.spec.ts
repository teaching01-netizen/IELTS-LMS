import { expect, test } from '@playwright/test';
import {
  ADMIN_STORAGE_STATE_PATH,
} from './support/backendE2e';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

test.describe('Admin workflow', () => {
  test('covers scheduling, grading, results, and settings interactions', async ({ page }) => {
    await page.goto('/admin/scheduling');
    await expect(page.getByRole('heading', { name: 'Exam Scheduler' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    const editScheduleButton = page.getByRole('button', { name: 'Edit' }).first();
    await expect(editScheduleButton).toBeVisible();
    await editScheduleButton.click();
    await expect(page.getByRole('heading', { name: 'Edit Schedule' })).toBeVisible();
    await page.getByLabel('Select cohort').selectOption({ label: 'Morning Batch B' });
    await page.getByRole('button', { name: 'Update Schedule' }).click();
    await expect(page.getByText('Morning Batch B')).toBeVisible();

    await page.goto('/admin/grading');
    await expect(page.getByRole('heading', { name: 'Grading Queue' })).toBeVisible();
    await expect(page.getByPlaceholder('Search sessions...')).toBeVisible();
    await page.getByPlaceholder('Search sessions...').fill('Backend E2E Cohort');
    await page
      .locator('tbody tr')
      .filter({ hasText: 'Backend E2E Cohort' })
      .getByRole('button', { name: 'View' })
      .click();
    await expect(page.getByRole('heading', { name: 'Session Students' })).toBeVisible();
    await expect(page.getByPlaceholder('Search students...')).toBeVisible();
    await page.getByPlaceholder('Search students...').fill('Alice');

    await page.goto('/admin/results');
    await expect(page.getByRole('heading', { name: 'Results & Analytics' })).toBeVisible();
    await page.getByPlaceholder('Search results...').fill('Wei Zhang');
    await page.getByRole('button', { name: 'Export' }).click();
    await page
      .locator('tbody tr')
      .filter({ hasText: 'Wei Zhang' })
      .getByRole('button', { name: 'View Report' })
      .click();

    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'Global Exam Defaults' })).toBeVisible();
    await page.getByRole('button', { name: 'General' }).click();
    const summaryField = page.getByPlaceholder('Enter default exam summary...');
    await summaryField.fill('Workflow baseline summary override');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Reset Baseline' }).click();
    await expect(summaryField).toHaveValue('Standard IELTS Academic Exam');

    await page.getByRole('button', { name: 'Save Profile' }).click();
  });

  test('manages grading workflow with rubrics and annotations', async ({ page }) => {
    await page.goto('/admin/grading');
    await expect(page.getByRole('heading', { name: 'Grading Queue' })).toBeVisible();

    // Filter by schedule
    await page.getByRole('combobox', { name: 'Filter by schedule' }).selectOption({ label: 'Backend E2E Cohort' });

    // Open grading session for student
    await page
      .locator('tbody tr')
      .first()
      .getByRole('button', { name: 'Grade' })
      .click();
    await expect(page.getByRole('heading', { name: /Grading Session/i })).toBeVisible();

    // Apply rubric scores for writing
    await page.getByRole('tab', { name: 'Writing' }).click();
    await page.getByLabel('Task Achievement Score').fill('7');
    await page.getByLabel('Coherence and Cohesion Score').fill('6');
    await page.getByLabel('Lexical Resource Score').fill('7');
    await page.getByLabel('Grammatical Range Score').fill('6');

    // Apply rubric scores for speaking
    await page.getByRole('tab', { name: 'Speaking' }).click();
    await page.getByLabel('Fluency and Coherence Score').fill('7');
    await page.getByLabel('Lexical Resource Score').fill('6');
    await page.getByLabel('Grammatical Range Score').fill('7');
    await page.getByLabel('Pronunciation Score').fill('6');

    // Add annotation to writing answer
    await page.getByRole('tab', { name: 'Writing' }).click();
    await page.getByRole('button', { name: 'Add Annotation' }).click();
    await page.getByLabel('Annotation text').fill('Good use of vocabulary');
    await page.getByRole('button', { name: 'Save Annotation' }).click();
    await expect(page.getByText('Annotation added')).toBeVisible();

    // Add evaluator notes
    await page.getByLabel('Evaluator Notes').fill('Student performed well overall');
    await page.getByRole('button', { name: 'Save Draft' }).click();
    await expect(page.getByText('Draft saved successfully')).toBeVisible();

    // Submit final grade
    await page.getByRole('button', { name: 'Submit Final Grade' }).click();
    await expect(page.getByRole('dialog', { name: 'Confirm Submission' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Grade submitted successfully')).toBeVisible();
  });

  test('views results and exports reports', async ({ page }) => {
    await page.goto('/admin/results');
    await expect(page.getByRole('heading', { name: 'Results & Analytics' })).toBeVisible();

    // Filter by date range
    await page.getByLabel('Start Date').fill('2024-01-01');
    await page.getByLabel('End Date').fill('2024-12-31');

    // Filter by cohort
    await page.getByRole('combobox', { name: 'Filter by cohort' }).selectOption({ label: 'Morning Batch B' });

    // View individual student report
    await page
      .locator('tbody tr')
      .first()
      .getByRole('button', { name: 'View Report' })
      .click();
    await expect(page.getByRole('heading', { name: /Student Report/i })).toBeVisible();

    // Verify band scores display
    await expect(page.getByText(/Overall Band:/i)).toBeVisible();
    await expect(page.getByText(/Listening:/i)).toBeVisible();
    await expect(page.getByText(/Reading:/i)).toBeVisible();
    await expect(page.getByText(/Writing:/i)).toBeVisible();
    await expect(page.getByText(/Speaking:/i)).toBeVisible();

    // Export to CSV
    await page.goto('/admin/results');
    await page.getByRole('button', { name: 'Export' }).click();
    await page.getByRole('menuitem', { name: 'Export to CSV' }).click();
    await expect(page.getByText('Export started')).toBeVisible();

    // Export to PDF
    await page.getByRole('button', { name: 'Export' }).click();
    await page.getByRole('menuitem', { name: 'Export to PDF' }).click();
    await expect(page.getByText('Export started')).toBeVisible();
  });

  test('manages global settings and profiles', async ({ page }) => {
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'Global Exam Defaults' })).toBeVisible();

    // Configure general settings
    await page.getByRole('button', { name: 'General' }).click();
    await page.getByPlaceholder('Enter default exam summary...').fill('Updated default summary');
    await page.getByLabel('Default Exam Duration').fill('180');

    // Configure section settings
    await page.getByRole('button', { name: 'Sections' }).click();
    await page.getByLabel('Listening Duration').fill('30');
    await page.getByLabel('Reading Duration').fill('60');
    await page.getByLabel('Writing Duration').fill('60');
    await page.getByLabel('Speaking Duration').fill('15');

    // Configure security settings
    await page.getByRole('button', { name: 'Security' }).click();
    await page.getByLabel('Detect Tab Switching').check();
    await page.getByLabel('Low Severity Threshold').fill('5');
    await page.getByLabel('Medium Severity Threshold').fill('3');
    await page.getByLabel('High Severity Threshold').fill('2');

    // Save custom profile
    await page.getByLabel('Profile Name').fill('E2E Test Profile');
    await page.getByRole('button', { name: 'Save Profile' }).click();
    await expect(page.getByText('Profile saved successfully')).toBeVisible();

    // Apply profile to new exams
    await page.getByRole('combobox', { name: 'Default Profile' }).selectOption({ label: 'E2E Test Profile' });
    await page.getByRole('button', { name: 'Apply Default' }).click();
    await expect(page.getByText('Profile applied as default')).toBeVisible();

    // Reset to baseline
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: 'Reset Baseline' }).click();
    await expect(page.getByText('Settings reset to baseline')).toBeVisible();
  });

  test('configures media cache and outbox settings', async ({ page }) => {
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'Global Exam Defaults' })).toBeVisible();

    // Navigate to system settings
    await page.getByRole('button', { name: 'System' }).click();

    // Configure media cache settings
    await page.getByLabel('Media Cache TTL').fill('3600');
    await page.getByLabel('Max Cache Size').fill('1024');

    // Configure outbox settings
    await page.getByLabel('Outbox Retry Interval').fill('30');
    await page.getByLabel('Max Retries').fill('3');

    await page.getByRole('button', { name: 'Save Settings' }).click();
    await expect(page.getByText('Settings saved successfully')).toBeVisible();
  });

  test('verifies audit logs for admin actions', async ({ page }) => {
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: 'Global Exam Defaults' })).toBeVisible();

    // Make a settings change to trigger audit log
    await page.getByPlaceholder('Enter default exam summary...').fill('Audit log test');
    await page.getByRole('button', { name: 'Save Profile' }).click();

    // Navigate to audit logs
    await page.goto('/admin/audit-logs');
    await expect(page.getByRole('heading', { name: /Audit Logs/i })).toBeVisible();

    // Verify audit log entry exists
    await expect(page.getByText('SETTINGS_UPDATED')).toBeVisible();

    // Filter logs by action type
    await page.getByRole('combobox', { name: 'Filter by action' }).selectOption('SETTINGS_UPDATED');

    // Verify logs are queryable
    const logEntries = page.locator('[data-audit-log-entry]');
    expect(await logEntries.count()).toBeGreaterThan(0);
  });
});

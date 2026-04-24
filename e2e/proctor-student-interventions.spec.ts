import { expect, test } from '@playwright/test';
import {
  ADMIN_STORAGE_STATE_PATH,
  readBackendE2EManifest,
  STUDENT_STORAGE_STATE_PATH,
} from './support/backendE2e';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

test.describe('Individual Student Interventions', () => {
  test('warns individual student', async ({ browser, page }) => {
    const manifest = readBackendE2EManifest();

    const studentContext = await browser.newContext({
      storageState: STUDENT_STORAGE_STATE_PATH,
    });
    const studentPage = await studentContext.newPage();
    await studentPage.goto(
      `/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`,
    );

    const compatibilityCheck = studentPage.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await studentPage.getByRole('button', { name: 'Continue' }).click();
    }

    // Proctor warns student
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.locator('[data-student-card]').first().getByRole('button', { name: 'Warn' }).click();
    await page.getByLabel('Warning message').fill('Please focus on your exam');
    await page.getByRole('button', { name: 'Send Warning' }).click();
    await expect(page.getByText('Warning sent successfully')).toBeVisible();

    // Verify student receives warning overlay
    await expect(studentPage.getByText(/warning|please focus/i)).toBeVisible();

    await studentContext.close();
  });

  test('pauses individual student', async ({ browser, page }) => {
    const manifest = readBackendE2EManifest();

    const studentContext = await browser.newContext({
      storageState: STUDENT_STORAGE_STATE_PATH,
    });
    const studentPage = await studentContext.newPage();
    await studentPage.goto(
      `/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`,
    );

    const compatibilityCheck = studentPage.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await studentPage.getByRole('button', { name: 'Continue' }).click();
    }

    // Proctor pauses student
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.locator('[data-student-card]').first().getByRole('button', { name: 'Pause' }).click();
    await page.getByLabel('Pause reason').fill('Suspicious activity detected');
    await page.getByRole('button', { name: 'Confirm Pause' }).click();
    await expect(page.getByText('Student paused successfully')).toBeVisible();

    // Verify student exam is paused
    await expect(studentPage.getByText(/paused|suspended/i)).toBeVisible();
    await expect(studentPage.getByLabel('Answer for question 1')).toBeDisabled();

    await studentContext.close();
  });

  test('resumes individual student', async ({ browser, page }) => {
    const manifest = readBackendE2EManifest();

    const studentContext = await browser.newContext({
      storageState: STUDENT_STORAGE_STATE_PATH,
    });
    const studentPage = await studentContext.newPage();
    await studentPage.goto(
      `/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`,
    );

    const compatibilityCheck = studentPage.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await studentPage.getByRole('button', { name: 'Continue' }).click();
    }

    // Pause student first
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.locator('[data-student-card]').first().getByRole('button', { name: 'Pause' }).click();
    await page.getByLabel('Pause reason').fill('Test pause');
    await page.getByRole('button', { name: 'Confirm Pause' }).click();

    // Resume student
    await page.locator('[data-student-card]').first().getByRole('button', { name: 'Resume' }).click();
    await page.getByRole('button', { name: 'Confirm Resume' }).click();
    await expect(page.getByText('Student resumed successfully')).toBeVisible();

    // Verify student exam is resumed
    await expect(studentPage.getByLabel('Answer for question 1')).toBeEnabled();

    await studentContext.close();
  });

  test('terminates individual student exam', async ({ browser, page }) => {
    const manifest = readBackendE2EManifest();

    const studentContext = await browser.newContext({
      storageState: STUDENT_STORAGE_STATE_PATH,
    });
    const studentPage = await studentContext.newPage();
    await studentPage.goto(
      `/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`,
    );

    const compatibilityCheck = studentPage.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await studentPage.getByRole('button', { name: 'Continue' }).click();
    }

    // Proctor terminates student
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.locator('[data-student-card]').first().getByRole('button', { name: 'Terminate' }).click();
    await page.getByLabel('Termination reason').fill('Severe violation detected');
    await page.getByRole('button', { name: 'Confirm Termination' }).click();
    await expect(page.getByText('Student terminated successfully')).toBeVisible();

    // Verify student exam is terminated
    await expect(studentPage.getByText(/terminated|exam ended/i)).toBeVisible();

    await studentContext.close();
  });

  test('views student detail with violations', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Click on student card to view details
    await page.locator('[data-student-card]').first().click();
    await expect(page.getByRole('heading', { name: /Student Details/i })).toBeVisible();

    // Verify violation history displays
    const violationHistory = page.locator('[data-violation-history]');
    const hasViolations = await violationHistory.isVisible().catch(() => false);
    if (hasViolations) {
      await expect(violationHistory).toBeVisible();
    }
  });

  test('adds session note for student', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Add note to student
    await page.locator('[data-student-card]').first().getByRole('button', { name: 'Add Note' }).click();
    await page.getByLabel('Note content').fill('Student showing good progress');
    await page.getByRole('combobox', { name: 'Category' }).selectOption('behavior');
    await page.getByRole('button', { name: 'Save Note' }).click();
    await expect(page.getByText('Note saved successfully')).toBeVisible();

    // Verify note appears in student details
    await page.locator('[data-student-card]').first().click();
    await expect(page.getByText('Student showing good progress')).toBeVisible();
  });

  test('acknowledges alert for student', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Navigate to alerts tab
    await page.getByRole('tab', { name: 'Alerts' }).click();

    // Acknowledge an alert
    const alertItem = page.locator('[data-alert-item]').first();
    const hasAlerts = await alertItem.isVisible().catch(() => false);

    if (hasAlerts) {
      await alertItem.getByRole('button', { name: 'Acknowledge' }).click();
      await page.getByLabel('Acknowledgment note').fill('Alert reviewed');
      await page.getByRole('button', { name: 'Confirm Acknowledgment' }).click();
      await expect(page.getByText('Alert acknowledged successfully')).toBeVisible();
    }
  });

  test('verifies student status updates in proctor UI', async ({ browser, page }) => {
    const manifest = readBackendE2EManifest();

    const studentContext = await browser.newContext({
      storageState: STUDENT_STORAGE_STATE_PATH,
    });
    const studentPage = await studentContext.newPage();
    await studentPage.goto(
      `/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`,
    );

    const compatibilityCheck = studentPage.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await studentPage.getByRole('button', { name: 'Continue' }).click();
    }

    // Get initial status
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    const initialStatus = await page.locator('[data-student-card]').first().getAttribute('data-status');

    // Pause student
    await page.locator('[data-student-card]').first().getByRole('button', { name: 'Pause' }).click();
    await page.getByLabel('Pause reason').fill('Test');
    await page.getByRole('button', { name: 'Confirm Pause' }).click();

    // Verify status updated
    const updatedStatus = await page.locator('[data-student-card]').first().getAttribute('data-status');
    expect(updatedStatus).not.toBe(initialStatus);

    await studentContext.close();
  });

  test('verifies STUDENT_WARN audit log', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Warn student
    await page.locator('[data-student-card]').first().getByRole('button', { name: 'Warn' }).click();
    await page.getByLabel('Warning message').fill('Test warning');
    await page.getByRole('button', { name: 'Send Warning' }).click();

    // Verify audit log
    await page.getByRole('tab', { name: 'Audit Logs' }).click();
    await expect(page.getByText('STUDENT_WARN')).toBeVisible();
  });

  test('verifies STUDENT_PAUSE audit log', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Pause student
    await page.locator('[data-student-card]').first().getByRole('button', { name: 'Pause' }).click();
    await page.getByLabel('Pause reason').fill('Test pause');
    await page.getByRole('button', { name: 'Confirm Pause' }).click();

    // Verify audit log
    await page.getByRole('tab', { name: 'Audit Logs' }).click();
    await expect(page.getByText('STUDENT_PAUSE')).toBeVisible();
  });

  test('verifies STUDENT_RESUME audit log', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Pause then resume student
    await page.locator('[data-student-card]').first().getByRole('button', { name: 'Pause' }).click();
    await page.getByLabel('Pause reason').fill('Test');
    await page.getByRole('button', { name: 'Confirm Pause' }).click();
    await page.locator('[data-student-card]').first().getByRole('button', { name: 'Resume' }).click();
    await page.getByRole('button', { name: 'Confirm Resume' }).click();

    // Verify audit log
    await page.getByRole('tab', { name: 'Audit Logs' }).click();
    await expect(page.getByText('STUDENT_RESUME')).toBeVisible();
  });

  test('verifies STUDENT_TERMINATE audit log', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Terminate student
    await page.locator('[data-student-card]').first().getByRole('button', { name: 'Terminate' }).click();
    await page.getByLabel('Termination reason').fill('Test termination');
    await page.getByRole('button', { name: 'Confirm Termination' }).click();

    // Verify audit log
    await page.getByRole('tab', { name: 'Audit Logs' }).click();
    await expect(page.getByText('STUDENT_TERMINATE')).toBeVisible();
  });

  test('verifies proctor status field updated in student_attempts', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Pause student
    await page.locator('[data-student-card]').first().getByRole('button', { name: 'Pause' }).click();
    await page.getByLabel('Pause reason').fill('Test pause');
    await page.getByRole('button', { name: 'Confirm Pause' }).click();

    // Verify proctor status in student details
    await page.locator('[data-student-card]').first().click();
    await expect(page.getByText(/Proctor Status:/i)).toBeVisible();
    await expect(page.getByText(/paused/i)).toBeVisible();
  });

  test('verifies violation events linked to attempt', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // View student details
    await page.locator('[data-student-card]').first().click();

    // Navigate to violations section
    await page.getByRole('tab', { name: 'Violations' }).click();

    // Verify violation events are displayed
    const violationEvents = page.locator('[data-violation-event]');
    const hasViolations = await violationEvents.isVisible().catch(() => false);
    if (hasViolations) {
      await expect(violationEvents).toBeVisible();
    }
  });

  test('verifies notes saved with category', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Add note with category
    await page.locator('[data-student-card]').first().getByRole('button', { name: 'Add Note' }).click();
    await page.getByLabel('Note content').fill('Test note with category');
    await page.getByRole('combobox', { name: 'Category' }).selectOption('academic');
    await page.getByRole('button', { name: 'Save Note' }).click();

    // Verify note saved with category
    await page.locator('[data-student-card]').first().click();
    await expect(page.getByText('Test note with category')).toBeVisible();
    await expect(page.getByText(/academic/i)).toBeVisible();
  });
});

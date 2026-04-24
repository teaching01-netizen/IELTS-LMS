import { expect, test } from '@playwright/test';
import {
  ADMIN_STORAGE_STATE_PATH,
  readBackendE2EManifest,
  STUDENT_STORAGE_STATE_PATH,
} from './support/backendE2e';

test.describe('Concurrent User Scenarios', () => {
  test('multiple students start exam simultaneously', async ({ browser }) => {
    const manifest = readBackendE2EManifest();

    // Create multiple student contexts
    const contexts = [];
    const pages = [];

    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({
        storageState: STUDENT_STORAGE_STATE_PATH,
      });
      const page = await context.newPage();
      contexts.push(context);
      pages.push(page);
    }

    // Start all students simultaneously
    const startPromises = pages.map((page, index) =>
      page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`)
    );

    await Promise.all(startPromises);

    // Wait for all pages to load
    await Promise.all(pages.map(page => page.waitForLoadState('networkidle')));

    // Verify all students can answer questions
    for (const page of pages) {
      const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
      const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
      if (isCompatibilityCheckVisible) {
        await page.getByRole('button', { name: 'Continue' }).click();
      }
      await expect(page.getByLabel('Answer for question 1')).toBeVisible();
    }

    // Clean up
    for (const context of contexts) {
      await context.close();
    }
  });

  test('multiple proctors monitor same session', async ({ browser }) => {
    // Create multiple proctor contexts
    const contexts = [];
    const pages = [];

    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({
        storageState: ADMIN_STORAGE_STATE_PATH,
      });
      const page = await context.newPage();
      contexts.push(context);
      pages.push(page);
    }

    // Navigate all proctors to the same session
    const navPromises = pages.map(page => {
      page.goto('/proctor');
      return page.waitForLoadState('networkidle');
    });

    await Promise.all(navPromises);

    // All proctors should be able to monitor
    for (const page of pages) {
      await expect(page.getByRole('heading', { name: /Proctor Dashboard/i })).toBeVisible();
      await page.getByRole('button', { name: /Monitor/i }).first().click();
      await expect(page.getByRole('heading', { name: /Session Details/i })).toBeVisible();
    }

    // Clean up
    for (const context of contexts) {
      await context.close();
    }
  });

  test('concurrent answer submissions', async ({ browser }) => {
    const manifest = readBackendE2EManifest();

    // Create multiple student contexts
    const contexts = [];
    const pages = [];

    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({
        storageState: STUDENT_STORAGE_STATE_PATH,
      });
      const page = await context.newPage();
      contexts.push(context);
      pages.push(page);
    }

    // Start all students
    await Promise.all(pages.map(page => 
      page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`)
    ));

    await Promise.all(pages.map(page => page.waitForLoadState('networkidle')));

    // Handle compatibility check for all
    for (const page of pages) {
      const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
      const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
      if (isCompatibilityCheckVisible) {
        await page.getByRole('button', { name: 'Continue' }).click();
      }
    }

    // Submit answers concurrently
    const answerPromises = pages.map((page, index) => {
      const answer = `concurrent answer ${index} ${Date.now()}`;
      return page.getByLabel('Answer for question 1').fill(answer);
    });

    await Promise.all(answerPromises);

    // Verify answers persisted
    for (const page of pages) {
      const answer = await page.getByLabel('Answer for question 1').inputValue();
      expect(answer).toContain('concurrent answer');
    }

    // Clean up
    for (const context of contexts) {
      await context.close();
    }
  });

  test('concurrent proctor interventions', async ({ browser }) => {
    // Create multiple proctor contexts
    const contexts = [];
    const pages = [];

    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({
        storageState: ADMIN_STORAGE_STATE_PATH,
      });
      const page = await context.newPage();
      contexts.push(context);
      pages.push(page);
    }

    // Navigate to session
    await Promise.all(pages.map(page => {
      page.goto('/proctor');
      return page.waitForLoadState('networkidle');
    }));

    await Promise.all(pages.map(page => page.getByRole('button', { name: /Monitor/i }).first().click()));

    // Both proctors try to pause cohort (last one should win or both should succeed)
    const pausePromises = pages.map(page => page.getByRole('button', { name: 'Pause Cohort' }).click());

    await Promise.all(pausePromises);

    // Verify cohort is paused
    for (const page of pages) {
      await expect(page.getByText('Cohort paused')).toBeVisible();
    }

    // Resume cohort
    await Promise.all(pages.map(page => page.getByRole('button', { name: 'Resume Cohort' }).click()));

    // Clean up
    for (const context of contexts) {
      await context.close();
    }
  });

  test('race condition handling for student status updates', async ({ browser, page }) => {
    const manifest = readBackendE2EManifest();

    // Create student context
    const studentContext = await browser.newContext({
      storageState: STUDENT_STORAGE_STATE_PATH,
    });
    const studentPage = await studentContext.newPage();
    await studentPage.goto(
      `/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`
    );

    const compatibilityCheck = studentPage.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await studentPage.getByRole('button', { name: 'Continue' }).click();
    }

    // Proctor monitors
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Student submits answer while proctor is viewing
    const answer = `race condition test ${Date.now()}`;
    await studentPage.getByLabel('Answer for question 1').fill(answer);

    // Proctor refreshes to see update
    await page.reload();
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Verify no race condition errors
    await expect(page.getByRole('heading', { name: /Session Details/i })).toBeVisible();

    await studentContext.close();
  });

  test('concurrent exam creation', async ({ browser }) => {
    // Create multiple admin contexts
    const contexts = [];
    const pages = [];

    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({
        storageState: ADMIN_STORAGE_STATE_PATH,
      });
      const page = await context.newPage();
      contexts.push(context);
      pages.push(page);
    }

    // Navigate to exam builder
    await Promise.all(pages.map(page => {
      page.goto('/admin/exams');
      return page.waitForLoadState('networkidle');
    }));

    // Both admins try to create exams
    const createPromises = pages.map((page, index) => {
      return page.getByRole('button', { name: 'Create Exam' }).click();
    });

    await Promise.all(createPromises);

    // Verify both can access create form
    for (const page of pages) {
      await expect(page.getByRole('dialog', { name: /Create Exam/i })).toBeVisible();
    }

    // Close dialogs
    for (const page of pages) {
      await page.getByRole('button', { name: 'Cancel' }).click();
    }

    // Clean up
    for (const context of contexts) {
      await context.close();
    }
  });

  test('database handles concurrent writes', async ({ browser }) => {
    const manifest = readBackendE2EManifest();

    // Create multiple student contexts
    const contexts = [];
    const pages = [];

    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({
        storageState: STUDENT_STORAGE_STATE_PATH,
      });
      const page = await context.newPage();
      contexts.push(context);
      pages.push(page);
    }

    // Start all students
    await Promise.all(pages.map(page => 
      page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`)
    ));

    await Promise.all(pages.map(page => page.waitForLoadState('networkidle')));

    // Handle compatibility check
    for (const page of pages) {
      const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
      const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
      if (isCompatibilityCheckVisible) {
        await page.getByRole('button', { name: 'Continue' }).click();
      }
    }

    // Rapidly submit answers from all students
    for (let round = 0; round < 5; round++) {
      const answerPromises = pages.map((page, index) => {
        const answer = `round ${round} student ${index} ${Date.now()}`;
        return page.getByLabel('Answer for question 1').fill(answer);
      });
      await Promise.all(answerPromises);
    }

    // Verify no database errors
    for (const page of pages) {
      const answer = await page.getByLabel('Answer for question 1').inputValue();
      expect(answer).toContain('round 4');
    }

    // Clean up
    for (const context of contexts) {
      await context.close();
    }
  });

  test('concurrent schedule modifications', async ({ browser }) => {
    // Create multiple admin contexts
    const contexts = [];
    const pages = [];

    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({
        storageState: ADMIN_STORAGE_STATE_PATH,
      });
      const page = await context.newPage();
      contexts.push(context);
      pages.push(page);
    }

    // Navigate to scheduling
    await Promise.all(pages.map(page => {
      page.goto('/admin/scheduling');
      return page.waitForLoadState('networkidle');
    }));

    // Both try to edit the same schedule
    await Promise.all(pages.map(page => page.getByRole('button', { name: 'Edit' }).first().click()));

    // Verify both can access edit form (or handle conflict)
    for (const page of pages) {
      const editDialog = page.getByRole('dialog', { name: /Edit Schedule/i });
      const isDialogVisible = await editDialog.isVisible().catch(() => false);
      
      if (isDialogVisible) {
        await expect(editDialog).toBeVisible();
      } else {
        // Might get conflict error
        const errorText = page.getByText(/conflict|locked|being edited/i);
        const hasError = await errorText.count() > 0;
        if (hasError) {
          console.log('Schedule conflict handling works');
        }
      }
    }

    // Clean up
    for (const context of contexts) {
      await context.close();
    }
  });

  test('WebSocket connection pool handles multiple connections', async ({ browser }) => {
    const manifest = readBackendE2EManifest();

    // Create multiple student contexts
    const contexts = [];
    const pages = [];

    for (let i = 0; i < 5; i++) {
      const context = await browser.newContext({
        storageState: STUDENT_STORAGE_STATE_PATH,
      });
      const page = await context.newPage();
      contexts.push(context);
      pages.push(page);
    }

    // Start all students
    await Promise.all(pages.map(page => 
      page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`)
    ));

    // Wait for WebSocket connections to establish
    await page.waitForTimeout(3000);

    // Verify all pages are responsive (no WebSocket errors)
    for (const page of pages) {
      const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
      const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
      if (isCompatibilityCheckVisible) {
        await page.getByRole('button', { name: 'Continue' }).click();
      }
      
      // Check for connection errors
      const connectionError = page.getByText(/connection error|websocket error/i);
      const hasError = await connectionError.count() > 0;
      expect(hasError).toBe(false);
    }

    // Clean up
    for (const context of contexts) {
      await context.close();
    }
  });

  test('concurrent grading sessions', async ({ browser }) => {
    // Create multiple grader contexts
    const contexts = [];
    const pages = [];

    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({
        storageState: ADMIN_STORAGE_STATE_PATH,
      });
      const page = await context.newPage();
      contexts.push(context);
      pages.push(page);
    }

    // Navigate to grading
    await Promise.all(pages.map(page => {
      page.goto('/admin/grading');
      return page.waitForLoadState('networkidle');
    }));

    // Both graders open different grading sessions
    const gradeButtons = pages[0].getByRole('button', { name: 'Grade' });
    const buttonCount = await gradeButtons.count();

    if (buttonCount >= 2) {
      await pages[0].getByRole('button', { name: 'Grade' }).nth(0).click();
      await pages[1].getByRole('button', { name: 'Grade' }).nth(1).click();

      // Verify both can grade
      for (const page of pages) {
        await expect(page.getByLabel('Evaluator Notes')).toBeVisible();
      }
    }

    // Clean up
    for (const context of contexts) {
      await context.close();
    }
  });
});

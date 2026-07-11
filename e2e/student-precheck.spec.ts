import { expect, test } from '@playwright/test';
import { readBackendE2EManifest } from './support/backendE2e';
import { deterministicWcode, studentCheckIn, stubScreenDetails } from './support/studentUi';

test.describe('Student exam briefing and waiting room', () => {
  test.describe.configure({ timeout: 90_000 });

  test('goes straight to the waiting room and silently persists checks, then waits for the proctor', async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    const persisted = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes(`/student/sessions/${manifest.student.scheduleId}/precheck`) && response.ok());

    await studentCheckIn(page, manifest.student.scheduleId, {
      wcode,
      email: `e2e+${wcode.toLowerCase()}@example.com`,
      fullName: 'E2E Candidate',
    });

    const waiting = page.getByRole('heading', { name: 'Waiting for the exam to start' });
    await expect(waiting).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Before you continue' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue to waiting room' })).not.toBeVisible();
    await expect(page.getByText('E2E Candidate')).toBeVisible();
    await expect(page.getByText(/Your exam timer will not begin while you are waiting/)).toBeVisible();
    await expect(page.getByText('Browser compatibility')).not.toBeVisible();

    await persisted;

    await expect(page.getByText('Waiting for proctor')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Exam' })).not.toBeVisible();
    await expect(page.getByLabel('Answer for question 1')).not.toBeVisible();
    await context.close();
  });
});

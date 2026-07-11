import { expect, test } from '@playwright/test';
import { readBackendE2EManifest } from './support/backendE2e';
import { completePreCheckIfPresent, deterministicWcode, studentCheckIn, stubScreenDetails } from './support/studentUi';

test.describe('Student exam briefing and waiting room', () => {
  test.describe.configure({ timeout: 90_000 });

  test('shows exam information without exposing technical checks, then waits for the proctor', async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await studentCheckIn(page, manifest.student.scheduleId, {
      wcode,
      email: `e2e+${wcode.toLowerCase()}@example.com`,
      fullName: 'E2E Candidate',
    });

    const briefing = page.getByRole('heading', { name: 'Before you continue' });
    const waiting = page.getByRole('heading', { name: 'Waiting for the exam to start' });
    await expect(briefing).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('E2E Candidate')).toBeVisible();
    await expect(page.getByText(/Your exam timer will not begin while you are waiting/)).toBeVisible();
    await expect(page.getByText('Browser compatibility')).not.toBeVisible();

    const persisted = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().includes(`/student/sessions/${manifest.student.scheduleId}/precheck`) && response.ok());
    await completePreCheckIfPresent(page);
    await persisted;

    await expect(waiting).toBeVisible();
    await expect(page.getByText('Waiting for proctor')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Exam' })).not.toBeVisible();
    await expect(page.getByLabel('Answer for question 1')).not.toBeVisible();
    await context.close();
  });
});

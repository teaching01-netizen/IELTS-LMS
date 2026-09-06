import { expect, test } from '@playwright/test';
import { readBackendE2EManifest } from './support/backendE2e';
import {
  completePreCheckIfPresent,
  deterministicWcode,
  startLobbyIfPresent,
  studentCheckIn,
  stubScreenDetails,
} from './support/studentUi';

test.describe('Student network resilience (runtime-backed LRW)', () => {
  test.describe.configure({ timeout: 90_000 });

  test('shows offline sync status and resumes after reconnect', async ({ browser }, testInfo) => {
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
    await completePreCheckIfPresent(page);
    await startLobbyIfPresent(page);

    await expect(page.getByLabel('Answer for question 1')).toBeVisible({ timeout: 30_000 });

    await context.setOffline(true);
    await expect(page.getByTestId('student-auto-save-status')).toHaveText('Offline');

    await context.setOffline(false);
    await expect(page.getByTestId('student-auto-save-status')).toHaveText(/Saved|Syncing/);
    await expect(
      page.getByLabel('Answer for question 1'),
    ).toBeVisible();

    await context.close();
  });
});

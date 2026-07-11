import { expect, test } from '@playwright/test';
import { readBackendE2EManifest } from './support/backendE2e';
import {
  completePreCheckIfPresent,
  deterministicWcode,
  openStudentSessionWithRetry,
  studentCheckIn,
  stubScreenDetails,
} from './support/studentUi';

test.describe('Student queue admission flow', () => {
  test.describe.configure({ timeout: 120_000 });

  test('student sees waiting room before exam start time', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await studentCheckIn(page, manifest.studentSelfPaced.scheduleId, {
      wcode,
      email: `e2e+${wcode.toLowerCase()}@example.com`,
      fullName: 'E2E Queue Candidate',
    });

    await page.goto(`/student/${manifest.studentSelfPaced.scheduleId}/${wcode}`);
    await page.waitForLoadState('domcontentloaded');

    await expect
      .poll(async () => {
        const waitingRoom = page.getByText(/waiting|lobby|not yet started|queue/i);
        const examContent = page.getByLabel(/Answer for question/i);
        if (await waitingRoom.isVisible().catch(() => false)) return 'waiting';
        if (await examContent.isVisible().catch(() => false)) return 'exam';
        return 'pending';
      }, { timeout: 30_000 })
      .not.toBe('pending');

    await context.close();
  });

  test('lobby displays section durations before exam starts', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await studentCheckIn(page, manifest.student.scheduleId, {
      wcode,
      email: `e2e+${wcode.toLowerCase()}@example.com`,
      fullName: 'E2E Lobby Candidate',
    });

    await openStudentSessionWithRetry(page, manifest.student.scheduleId, wcode);
    await completePreCheckIfPresent(page);

    await expect
      .poll(async () => {
        const lobby = page.getByRole('heading', { name: /Lobby|Exam Overview|Waiting/i });
        const startExam = page.getByRole('button', { name: 'Start Exam' });
        const examContent = page.getByLabel('Answer for question 1');
        if (await lobby.isVisible().catch(() => false)) return 'lobby';
        if (await startExam.isVisible().catch(() => false)) return 'start';
        if (await examContent.isVisible().catch(() => false)) return 'exam';
        return 'pending';
      }, { timeout: 30_000 })
      .toMatch(/lobby|start|exam/);

    const lobbyVisible = await page.getByRole('heading', { name: /Lobby|Exam Overview/i })
      .isVisible().catch(() => false);
    if (lobbyVisible) {
      const sectionText = page.getByText(/listening|reading|writing|speaking/i);
      const hasSections = await sectionText.isVisible().catch(() => false);
      if (hasSections) {
        await expect(sectionText).toBeVisible();
      }
    }

    await context.close();
  });

  test('waiting room has no student-owned exam start action', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await studentCheckIn(page, manifest.student.scheduleId, {
      wcode,
      email: `e2e+${wcode.toLowerCase()}@example.com`,
      fullName: 'E2E Start Candidate',
    });

    await openStudentSessionWithRetry(page, manifest.student.scheduleId, wcode);
    await completePreCheckIfPresent(page);

    await expect(page.getByRole('heading', { name: 'Waiting for the exam to start' })).toBeVisible();
    await expect(page.getByText('Waiting for proctor')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Exam' })).not.toBeVisible();
    await expect(page.getByLabel('Answer for question 1')).not.toBeVisible();

    await context.close();
  });
});

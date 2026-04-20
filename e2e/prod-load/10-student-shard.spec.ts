import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readEffectiveProdTarget } from '../support/prodData';
import {
  computeArrivalJitterMs,
  computeScenarioAssignments,
  resolveProdRunContext,
  selectShardStudents,
  violationTypeForWcode,
} from '../support/prodOrchestration';
import {
  acknowledgeWarningOverlayIfPresent,
  completePreCheckIfPresent,
  grantStrictProctoringPermissions,
  openStudentSessionWithRetry,
  startLobbyIfPresent,
  studentCheckIn,
  stubScreenDetails,
  triggerClipboardBlockedViolation,
  triggerContextMenuBlockedViolation,
  triggerTabSwitchViolation,
} from '../support/studentUi';

async function waitForExamSurface(page: Page) {
  const completeHeading = page.getByRole('heading', { name: /Examination Complete!/i });
  const waiting = page.getByRole('heading', { name: /Waiting for start/i });
  const answerField = page.getByLabel(/Answer for question/i);
  const writingEditor = page.locator('[contenteditable="true"]').first();
  const finishButton = page.getByRole('button', { name: 'Finish' });
  const reviewSubmitButton = page.getByRole('button', { name: 'Review & Submit' });

  await expect
    .poll(async () => {
      if (await completeHeading.isVisible().catch(() => false)) return 'complete';
      if (await answerField.isVisible().catch(() => false)) return 'answer';
      if (await writingEditor.isVisible().catch(() => false)) return 'writing';
      if (await finishButton.isVisible().catch(() => false)) return 'finish';
      if (await reviewSubmitButton.isVisible().catch(() => false)) return 'review';
      if (await waiting.isVisible().catch(() => false)) return 'waiting';
      return 'pending';
    }, { timeout: 90_000 })
    .not.toBe('pending');
}

async function performViolationIfAssignedWith(
  page: Page,
  assignments: ReturnType<typeof computeScenarioAssignments>,
  wcode: string,
) {
  const violation = violationTypeForWcode(assignments, wcode);
  if (!violation) return;

  const answerField = page.getByLabel(/Answer for question/i).first();
  const writingEditor = page.locator('[contenteditable="true"]').first();
  if (await answerField.isVisible().catch(() => false)) {
    await answerField.click().catch(() => {});
  } else if (await writingEditor.isVisible().catch(() => false)) {
    await writingEditor.click().catch(() => {});
  }

  if (violation === 'TAB_SWITCH') await triggerTabSwitchViolation(page);
  if (violation === 'CLIPBOARD_BLOCKED') await triggerClipboardBlockedViolation(page);
  if (violation === 'CONTEXT_MENU_BLOCKED') await triggerContextMenuBlockedViolation(page);

  await acknowledgeWarningOverlayIfPresent(page);
}

async function toggleOfflineBrieflyIfAssignedWith(
  context: BrowserContext,
  assignments: ReturnType<typeof computeScenarioAssignments>,
  wcode: string,
) {
  if (!assignments.offlineToggle.has(wcode)) return;
  await context.setOffline(true);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  await context.setOffline(false);
}

async function tryProgressAndSubmit(
  page: Page,
  runId: string,
  assignments: ReturnType<typeof computeScenarioAssignments>,
  wcode: string,
) {
  const completeHeading = page.getByRole('heading', { name: /Examination Complete!/i });
  const submitSection = page.getByRole('button', { name: 'Submit Section' });
  const confirmSubmission = page.getByRole('button', { name: 'Confirm Submission' });
  const reviewSubmitButton = page.getByRole('button', { name: 'Review & Submit' });
  const finishButton = page.getByRole('button', { name: 'Finish' });
  const answerField = page.getByLabel(/Answer for question/i).first();
  const writingEditor = page.locator('[contenteditable="true"]').first();

  const startedAt = Date.now();
  while (Date.now() - startedAt < 8 * 60_000) {
    if (await completeHeading.isVisible().catch(() => false)) return 'submitted';

    const terminatedCopy = page.getByText(/terminated|exam ended/i);
    if (assignments.terminate.has(wcode) && (await terminatedCopy.isVisible().catch(() => false))) {
      return 'terminated';
    }

    await acknowledgeWarningOverlayIfPresent(page);

    if (await confirmSubmission.isVisible().catch(() => false)) {
      await confirmSubmission.click().catch(() => confirmSubmission.click({ force: true }));
      await page.waitForTimeout(500);
      continue;
    }

    if (await submitSection.isVisible().catch(() => false)) {
      await submitSection.click().catch(() => submitSection.click({ force: true }));
      await page.waitForTimeout(500);
      continue;
    }

    if (await reviewSubmitButton.isVisible().catch(() => false)) {
      await reviewSubmitButton.click().catch(() => reviewSubmitButton.click({ force: true }));
      await page.waitForTimeout(500);
      continue;
    }

    if (await finishButton.isVisible().catch(() => false)) {
      await finishButton.scrollIntoViewIfNeeded().catch(() => {});
      await finishButton.click().catch(() => finishButton.click({ force: true }));
      await page.waitForTimeout(500);
      continue;
    }

    if (await answerField.isVisible().catch(() => false)) {
      const answer = `E2E ${runId} ${wcode} @ ${new Date().toISOString()}`;
      await answerField.click().catch(() => {});
      await answerField.fill('');
      await answerField.type(answer, { delay: 15 });
      await page.waitForTimeout(400);
      continue;
    }

    if (await writingEditor.isVisible().catch(() => false)) {
      await writingEditor.click().catch(() => {});
      await writingEditor.type(`E2E ${runId} ${wcode} response. `, { delay: 10 });
      await page.waitForTimeout(400);
      continue;
    }

    const firstRadio = page.locator('input[type="radio"]').first();
    if (await firstRadio.isVisible().catch(() => false)) {
      await firstRadio.check().catch(() => firstRadio.click({ force: true }));
      await page.waitForTimeout(250);
      continue;
    }

    await page.waitForTimeout(750);
  }

  throw new Error(`Student ${wcode} did not submit/terminate within timeout.`);
}

test.describe('Prod load: student shard', () => {
  test('students check in, wait, and complete the short load exam', async ({ browser }, testInfo) => {
    const target = readEffectiveProdTarget();
    const run = resolveProdRunContext(target);
    const assignments = computeScenarioAssignments(target);

    if (run.shardIndex === 0 && process.env['E2E_PROD_RUN_STUDENTS_ON_CONTROL_SHARD'] !== 'true') {
      testInfo.skip(true, 'Shard 0 reserved for control plane by default.');
    }

    const shardStudents = selectShardStudents(target, run.shardIndex, run.shardCount);
    expect(shardStudents.length).toBeGreaterThan(0);

    const maxConcurrent = Number(process.env['E2E_PROD_MAX_CONCURRENT_STUDENTS'] ?? '5');
    const queue = [...shardStudents];
    const running: Array<Promise<void>> = [];

    const runOne = async () => {
      const student = queue.shift();
      if (!student) return;

      const jitterMs = computeArrivalJitterMs(run.runId, student.wcode, target.scenario.arrivalRampSeconds);
      await new Promise((resolve) => setTimeout(resolve, jitterMs));

      const context = await browser.newContext();
      await stubScreenDetails(context);
      await grantStrictProctoringPermissions(context, target.baseURL);
      const page = await context.newPage();

      const isInvalidFirstSubmit = assignments.invalidCheckIn.has(student.wcode);
      if (isInvalidFirstSubmit) {
        await page.goto(`/student/${target.scheduleId}/register`);
        await page.getByRole('heading', { name: 'Exam Check-in' }).waitFor({ state: 'visible' });
        await page.getByRole('button', { name: 'Continue' }).click();
        await expect(page.getByText(/required/i)).toBeVisible();
      }

      await studentCheckIn(page, target.scheduleId, {
        wcode: student.wcode,
        email: student.email,
        fullName: student.fullName,
      });

      await openStudentSessionWithRetry(page, target.scheduleId, student.wcode);
      await completePreCheckIfPresent(page);
      await startLobbyIfPresent(page);

      await openStudentSessionWithRetry(page, target.scheduleId, student.wcode);
      await waitForExamSurface(page);

      await performViolationIfAssignedWith(page, assignments, student.wcode);
      await toggleOfflineBrieflyIfAssignedWith(context, assignments, student.wcode);

      const outcome = await tryProgressAndSubmit(page, run.runId, assignments, student.wcode);
      if (assignments.terminate.has(student.wcode)) {
        expect(outcome).toBe('terminated');
      } else {
        expect(outcome).toBe('submitted');
      }

      await context.close();
      await runOne();
    };

    for (let i = 0; i < Math.min(maxConcurrent, shardStudents.length); i += 1) {
      running.push(runOne());
    }

    await Promise.all(running);
  });
});

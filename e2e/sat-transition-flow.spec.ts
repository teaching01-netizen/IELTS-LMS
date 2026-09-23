import { expect, test } from '@playwright/test';
import { ADMIN_STORAGE_STATE_PATH } from './support/backendE2e';
import { executeUpdate } from './support/db';
import { createRunningSatSession } from './support/satStudentSession';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

test.describe('SAT student transitions', () => {
  test.describe.configure({ timeout: 240_000 });
  test.skip(
    ({ browserName }, testInfo) => browserName !== 'chromium' || testInfo.project.name !== 'chromium',
    'The transition flow runs once in desktop Chromium; device sizes are checked in the scenario.',
  );

  test('moves from pre-start through early branch routing, the scheduled break, and completion', async ({
    page,
    browser,
  }) => {
    const { studentContext, studentPage, scheduleId, candidateId } = await createRunningSatSession(browser, page, {
      label: 'transitions',
      startRuntime: false,
      studentContext: { reducedMotion: 'reduce' },
    });

    try {
      expect(
        await studentPage.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
      ).toBe(true);
      await expect(
        studentPage.getByRole('heading', { name: 'Waiting for the proctor to start your exam' }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(studentPage.getByTestId('sat-exam-shell')).toHaveCount(0);
      await expect(studentPage.getByRole('button', { name: /Begin module/i })).toHaveCount(0);
      await studentPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(
        studentPage.getByRole('heading', { name: 'Waiting for the proctor to start your exam' }),
      ).toBeVisible({ timeout: 30_000 });

      await page.getByRole('button', { name: 'Start' }).click();
      await expect(page.getByText('Session started.')).toBeVisible({ timeout: 20_000 });
      await expect(studentPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      await expect(studentPage.getByRole('button', { name: /Begin module/i })).toHaveCount(0);
      await studentPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(studentPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });

      const beforeSubmit = await readSectionModules(studentPage, scheduleId, candidateId, 'reading-writing');
      expect(beforeSubmit.find((module) => module.adaptiveRole === 'base')?.state).toBe('active');

      const branchEntry = await holdNextModuleStartResponse(studentPage, { failFirstRequest: true });
      try {
        await submitCurrentModule(studentPage);
        await expect.poll(() => branchEntry.attempts()).toBe(1, { timeout: 15_000 });
        await branchEntry.failed;
        await expect.poll(() => branchEntry.attempts()).toBe(2, { timeout: 15_000 });
        await branchEntry.entered;
        await expect(studentPage.locator('[data-sat-transition-hold]')).toBeVisible();
        await assertHeldExamCannotBeInteractedWith(studentPage);

        await expect.poll(
          async () => {
            const modules = await readSectionModules(studentPage, scheduleId, candidateId, 'reading-writing');
            return modules.find((module) => module.adaptiveRole !== 'base' && module.state === 'active')?.state ?? null;
          },
          { timeout: 45_000, intervals: [250, 500, 1_000, 2_000] },
        ).toBe('active');
      } finally {
        branchEntry.release();
        await branchEntry.remove();
      }
      await expect(studentPage.locator('[data-sat-transition-hold]')).toHaveCount(0);
      await expect(studentPage.getByTestId('sat-exam-shell')).toBeVisible();
      await expect(studentPage.getByRole('button', { name: /Begin module/i })).toHaveCount(0);
      await expect(studentPage.getByRole('heading', { name: 'Review your answers' })).toHaveCount(0);
      await studentPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(studentPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      await expect(studentPage.getByRole('button', { name: /Begin module/i })).toHaveCount(0);

      await submitCurrentModule(studentPage);
      const scheduledBreak = studentPage.getByTestId('sat-scheduled-break');
      await expect(scheduledBreak).toBeVisible({ timeout: 30_000 });
      await expect(scheduledBreak).toHaveAttribute('data-sat-break-phase', 'waiting-for-break');
      await expect(scheduledBreak.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(scheduledBreak.getByRole('timer')).toBeVisible();
      await expect(studentPage.getByRole('button', { name: /Begin module/i })).toHaveCount(0);
      await studentPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(studentPage.getByTestId('sat-scheduled-break')).toHaveAttribute(
        'data-sat-break-phase',
        'waiting-for-break',
      );
      await assertNoHorizontalOverflow(studentPage, [
        { width: 390, height: 844 },
        { width: 768, height: 1024 },
        { width: 1440, height: 900 },
      ]);

      const expiredSection = await executeUpdate(
        `UPDATE exam_session_runtime_sections rs
         JOIN exam_session_runtimes r ON r.id = rs.runtime_id
            SET rs.actual_start_at = NOW(6) - INTERVAL 2 MINUTE,
                rs.planned_duration_minutes = 1,
                rs.gap_after_minutes = 5,
                rs.extension_minutes = 0,
                rs.accumulated_paused_seconds = 0
          WHERE r.schedule_id = ?
            AND rs.section_key = 'reading-writing'
            AND rs.status = 'live'`,
        [scheduleId],
      );
      expect(expiredSection).toBe(1);
      await expect.poll(async () => {
        const runtime = await readSatRuntime(page, scheduleId);
        return runtime.sections.find((section) => section.sectionKey === 'reading-writing')?.status ?? null;
      }, { timeout: 30_000, intervals: [250, 500, 1_000, 2_000] }).toBe('completed');
      await expect(scheduledBreak).toHaveAttribute('data-sat-break-phase', 'on-break', { timeout: 30_000 });
      await studentPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(studentPage.getByTestId('sat-scheduled-break')).toHaveAttribute(
        'data-sat-break-phase',
        'on-break',
      );

      const skippedBreak = await executeUpdate(
        `UPDATE exam_session_runtime_sections rs
         JOIN exam_session_runtimes r ON r.id = rs.runtime_id
            SET rs.actual_end_at = NOW(6) - INTERVAL 6 MINUTE
          WHERE r.schedule_id = ?
            AND rs.section_key = 'reading-writing'
            AND rs.status = 'completed'`,
        [scheduleId],
      );
      expect(skippedBreak).toBe(1);
      await expect.poll(async () => (await readSatRuntime(page, scheduleId)).currentSectionKey, {
        timeout: 30_000,
        intervals: [250, 500, 1_000, 2_000],
      }).toBe('math');
      await expect(studentPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      await expect(studentPage.getByTestId('sat-scheduled-break')).toHaveCount(0);
      await expect(studentPage.getByRole('button', { name: /Begin module/i })).toHaveCount(0);
      await studentPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(studentPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      await expect.poll(async () => {
        const modules = await readSectionModules(studentPage, scheduleId, candidateId, 'math');
        return modules.find((module) => module.adaptiveRole === 'base')?.state ?? null;
      }, { timeout: 45_000, intervals: [250, 500, 1_000, 2_000] }).toBe('active');

      const mathBaseEntry = await holdNextModuleStartResponse(studentPage);
      try {
        await submitCurrentModule(studentPage);
        await mathBaseEntry.entered;
        await expect(studentPage.locator('[data-sat-transition-hold]')).toBeVisible();
        await assertHeldExamCannotBeInteractedWith(studentPage);
      } finally {
        mathBaseEntry.release();
        await mathBaseEntry.remove();
      }
      await expect(studentPage.locator('[data-sat-transition-hold]')).toHaveCount(0);

      await expect.poll(async () => {
        const modules = await readSectionModules(studentPage, scheduleId, candidateId, 'math');
        return modules.find((module) => module.adaptiveRole !== 'base' && module.state === 'active')?.state ?? null;
      }, { timeout: 45_000, intervals: [250, 500, 1_000, 2_000] }).toBe('active');
      await expect(studentPage.getByTestId('sat-exam-shell')).toBeVisible();
      await expect(studentPage.getByRole('button', { name: /Begin module/i })).toHaveCount(0);
      await studentPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(studentPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });

      await submitCurrentModule(studentPage);
      await expect(studentPage.getByRole('heading', { name: 'SAT Complete' })).toBeVisible({ timeout: 60_000 });
      await expect(studentPage.getByRole('button', { name: /Begin module/i })).toHaveCount(0);
    } finally {
      await studentContext.close();
    }
  });
});

async function submitCurrentModule(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: /Open question navigator/ }).click();
  await page.getByRole('button', { name: 'Review answers', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review your answers' })).toBeVisible();
  await page.getByRole('button', { name: 'Submit module', exact: true }).click();
  await page.getByRole('button', { name: 'Submit anyway', exact: true }).click();
}

async function holdNextModuleStartResponse(
  page: import('@playwright/test').Page,
  options: { failFirstRequest?: boolean } = {},
) {
  let failedResolve!: () => void;
  let enteredResolve!: () => void;
  let releaseResolve!: () => void;
  const failed = new Promise<void>((resolve) => { failedResolve = resolve; });
  const entered = new Promise<void>((resolve) => { enteredResolve = resolve; });
  const released = new Promise<void>((resolve) => { releaseResolve = resolve; });
  let attempts = 0;
  let held = false;
  const routePattern = '**/v1/assessment-delivery/schedules/*/modules/start';
  await page.route(routePattern, async (route) => {
    attempts += 1;
    if (options.failFirstRequest && attempts === 1) {
      await route.abort('internetdisconnected');
      failedResolve();
      return;
    }
    const response = await route.fetch();
    if (!held) {
      held = true;
      enteredResolve();
      await released;
    }
    await route.fulfill({ response });
  });
  return {
    failed,
    entered,
    attempts: () => attempts,
    release: releaseResolve,
    remove: () => page.unroute(routePattern),
  };
}

async function assertHeldExamCannotBeInteractedWith(page: import('@playwright/test').Page): Promise<void> {
  const held = page.locator('[data-sat-transition-hold]');
  const radio = held.locator('input[type="radio"]').first();
  if (await radio.count()) {
    const shell = held.getByTestId('sat-exam-shell');
    const navigator = shell.getByRole('button', {
      name: /Open question navigator/,
      includeHidden: true,
    });
    const questionPosition = await navigator.getAttribute('aria-label');
    const radioBounds = await radio.boundingBox();
    if (!radioBounds) throw new Error('The held module answer control was not visible.');
    await page.mouse.click(radioBounds.x + radioBounds.width / 2, radioBounds.y + radioBounds.height / 2);
    await expect(radio).not.toBeChecked();

    await page.keyboard.press('Control+Alt+x');
    await expect(navigator).toHaveAttribute('aria-label', questionPosition ?? '');
    const next = shell.getByRole('button', { name: 'Next question', includeHidden: true });
    const nextBounds = await next.boundingBox();
    if (!nextBounds) throw new Error('The held module navigation control was not visible.');
    await page.mouse.click(nextBounds.x + nextBounds.width / 2, nextBounds.y + nextBounds.height / 2);
    await expect(navigator).toHaveAttribute('aria-label', questionPosition ?? '');
    return;
  }

  const submit = held.getByRole('button', {
    name: 'Submit module',
    exact: true,
    includeHidden: true,
  });
  const submitBounds = await submit.boundingBox();
  if (!submitBounds) throw new Error('The held review submit control was not visible.');
  await page.mouse.click(submitBounds.x + submitBounds.width / 2, submitBounds.y + submitBounds.height / 2);
  await expect(page.getByTestId('sat-submit-confirm')).toHaveCount(0);
}

async function assertNoHorizontalOverflow(
  page: import('@playwright/test').Page,
  viewports: Array<{ width: number; height: number }>,
): Promise<void> {
  const originalViewport = page.viewportSize();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasOverflow, `horizontal overflow at ${viewport.width}×${viewport.height}`).toBe(false);
  }
  if (originalViewport) await page.setViewportSize(originalViewport);
}

async function readSectionModules(
  page: import('@playwright/test').Page,
  scheduleId: string,
  candidateId: string,
  sectionKey: 'reading-writing' | 'math',
): Promise<Array<{ adaptiveRole: string; state: string | null }>> {
  return page.evaluate(async ({ scheduleId: id, candidateId: studentId, sectionKey: requestedSection }) => {
    const liveResponse = await fetch(
      `/api/v1/student/sessions/${id}/live?candidateId=${encodeURIComponent(studentId)}`,
    );
    const livePayload = await liveResponse.json();
    const attemptId = livePayload?.data?.attempt?.id ?? livePayload?.attempt?.id;
    if (typeof attemptId !== 'string') {
      throw new Error('SAT student attempt was unavailable during the transition.');
    }

    const delivery = await import('/src/features/student-delivery/api/assessmentDeliveryApi.ts');
    delivery.configureAssessmentDeliveryAttempt(id, attemptId, studentId);
    const snapshot = await delivery.assessmentDeliveryApi.bootstrap(id, attemptId);
    const section = snapshot.sections.find((item) => item.sectionKey === requestedSection);
    if (!section) throw new Error(`${requestedSection} was missing from the SAT bootstrap.`);
    return section.modules.map((module) => ({
      adaptiveRole: module.adaptiveRole,
      state: snapshot.attempt.moduleAttempts.find((attempt) => attempt.moduleId === module.id)?.state ?? null,
    }));
  }, { scheduleId, candidateId, sectionKey });
}

async function readSatRuntime(
  page: import('@playwright/test').Page,
  scheduleId: string,
): Promise<{
  currentSectionKey: string | null;
  sections: Array<{ sectionKey: string; status: string | null }>;
}> {
  const response = await page.request.get(`/api/v1/schedules/${scheduleId}/runtime`);
  if (!response.ok()) throw new Error(`Runtime read failed: ${response.status()} ${await response.text()}`);
  const payload = await response.json();
  const runtime = payload?.data ?? payload;
  return {
    currentSectionKey: runtime.currentSectionKey ?? null,
    sections: (runtime.sections ?? []).map((section: { sectionKey: string; status?: string | null }) => ({
      sectionKey: section.sectionKey,
      status: section.status ?? null,
    })),
  };
}

import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STORAGE_STATE_PATH } from './support/backendE2e';
import { closeDb, executeUpdate, queryDb } from './support/db';
import { postProctorApi } from './support/proctorControls';
import { createRunningSatSession } from './support/satStudentSession';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

async function waitForSatSaved(page: Page) {
  await expect(page.getByTestId('sat-exam-shell')).toHaveAttribute('data-sat-save-state', 'idle', {
    timeout: 30_000,
  });
}

async function readAttemptIdentity(page: Page, scheduleId: string, candidateId: string) {
  return page.evaluate(async ({ scheduleId, candidateId }) => {
    const query = new URLSearchParams({ candidateId });
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch(`/api/v1/student/sessions/${scheduleId}?${query}`, {
        credentials: 'include',
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`Session lookup failed with ${response.status}`);
    const wire = await response.json() as {
      data?: { attempt?: { id?: string; deadlineAt?: string | null; answers?: Record<string, unknown> | null } | null };
      attempt?: { id?: string; deadlineAt?: string | null; answers?: Record<string, unknown> | null } | null;
    };
    const payload = wire.data ?? wire;
    if (!payload.attempt?.id) throw new Error('The authenticated session did not return an attempt id.');
    return {
      id: payload.attempt.id,
      deadlineAt: payload.attempt.deadlineAt ?? null,
      answers: payload.attempt.answers ?? {},
    };
  }, { scheduleId, candidateId });
}

async function readSatRemainingSeconds(page: Page): Promise<number> {
  const label = await page.getByRole('timer').first().getAttribute('aria-label');
  const match = label?.match(/(\d+):(\d{2})/);
  if (!match) throw new Error(`Could not read the SAT timer from ${JSON.stringify(label)}.`);
  return Number(match[1]) * 60 + Number(match[2]);
}

async function selectFirstStimulusText(page: Page) {
  const toggle = page.getByRole('button', { name: /^Highlights & Notes/ });
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-sat-annotation-region="stimulus"]').evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node && (node.nodeValue ?? '').trim().length < 4) node = walker.nextNode();
    if (!node) throw new Error('No selectable SAT stimulus text was rendered.');

    const textNode = node as Text;
    const value = textNode.data.trim();
    const start = textNode.data.indexOf(value);
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + Math.min(value.length, 12));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    textNode.parentElement?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
}

test.describe('SAT automatic resume', () => {
  test.describe.configure({ timeout: 300_000 });
  test.afterAll(async () => closeDb());

  test('recovers the same server attempt across a new tab, Student Link, and missing local storage', async ({
    page,
    browser,
  }) => {
    const { studentContext, studentPage, scheduleId, candidateId, joinHref } = await createRunningSatSession(
      browser,
      page,
      { label: 'auto-resume' },
    );
    try {
      const radios = studentPage.locator('input[type="radio"]');
      await studentPage.locator('label').filter({ has: radios.first() }).first().click();
      await studentPage.getByRole('button', { name: 'Turn on cross-out mode' }).click();
      await studentPage.getByRole('button', { name: 'Eliminate option B' }).click();
      await selectFirstStimulusText(studentPage);
      await studentPage
        .getByRole('toolbar', { name: 'Selected text actions' })
        .getByRole('button', { name: 'Highlight Yellow' })
        .click();
      await expect(studentPage.locator('[data-sat-highlight="true"]')).toHaveCount(1);
      await waitForSatSaved(studentPage);
      const savedAnswer = await radios.first().inputValue();
      const original = await readAttemptIdentity(studentPage, scheduleId, candidateId);
      expect(Object.values(original.answers)).toContain(savedAnswer);
      const cachedAttemptA = await studentPage.evaluate(() => window.localStorage.getItem('ielts_student_attempts_v1'));
      expect(cachedAttemptA).toBeTruthy();
      const originalRemainingSeconds = await readSatRemainingSeconds(studentPage);

      await studentPage.evaluate(() => window.sessionStorage.clear());

      // A new Page in the same context models closing the tab. It has a new
      // sessionStorage area while the server cookie and local resume locator survive.
      await studentPage.close({ runBeforeUnload: false });
      const schedulePage = await studentContext.newPage();
      await schedulePage.addInitScript(() => {
        // The page-local answer cache and outbox are not admission or recovery
        // evidence. Keep the locator and browser writer identity, but force
        // this new page to hydrate the answer from the authenticated server.
        window.localStorage.removeItem('ielts_student_attempts_v1');
        window.localStorage.removeItem('ielts_student_attempt_pending_mutations_v1');
      });
      await schedulePage.goto(`/student/${scheduleId}`, { waitUntil: 'domcontentloaded' });
      await expect(schedulePage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      await expect(schedulePage.locator('input[type="radio"]').first()).toBeChecked({ timeout: 30_000 });
      const resumed = await readAttemptIdentity(schedulePage, scheduleId, candidateId);
      expect(resumed).toEqual(original);
      expect(await schedulePage.locator('input[type="radio"]:checked').first().inputValue()).toBe(savedAnswer);
      await schedulePage.getByRole('button', { name: 'Turn on cross-out mode' }).click();
      await expect(schedulePage.getByRole('button', { name: 'Restore option B' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(schedulePage.locator('[data-sat-highlight="true"]')).toHaveCount(1);
      expect(await readSatRemainingSeconds(schedulePage)).toBeLessThanOrEqual(originalRemainingSeconds);

      // Create another real candidate on the same Student Link. A's resume
      // must remain bound to A even when the local locator names B.
      const secondStudentContext = await browser.newContext();
      const secondStudentPage = await secondStudentContext.newPage();
      await secondStudentPage.goto(joinHref, { waitUntil: 'domcontentloaded' });
      await secondStudentPage.getByLabel('Full name').fill('Second SAT candidate');
      await secondStudentPage.getByLabel('Email').fill(`second-${Date.now()}@example.com`);
      await secondStudentPage.getByRole('button', { name: /Continue/i }).click();
      await expect(secondStudentPage).toHaveURL(new RegExp(`/student/${scheduleId}/[^/]+$`), { timeout: 30_000 });
      const secondCandidateId = decodeURIComponent(new URL(secondStudentPage.url()).pathname.split('/').at(-1) ?? '');
      expect(secondCandidateId).not.toBe(candidateId);
      await expect(secondStudentPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      const secondAttempt = await readAttemptIdentity(secondStudentPage, scheduleId, secondCandidateId);
      expect(secondAttempt.id).not.toBe(original.id);

      // Student B presents A's real canonical URL and A's real cached attempt.
      // The authenticated server must deny the route before local state can
      // mount the SAT shell. Repeat with no cached record to cover both paths.
      await secondStudentPage.evaluate((cached) => {
        window.localStorage.setItem('ielts_student_attempts_v1', cached);
      }, cachedAttemptA);
      await secondStudentPage.goto(`/student/${scheduleId}/${encodeURIComponent(candidateId)}`, { waitUntil: 'domcontentloaded' });
      await expect(secondStudentPage.getByRole('heading', { name: /Exam Not Found|SAT attempt unavailable/i })).toBeVisible({ timeout: 45_000 });
      await expect(secondStudentPage.getByTestId('sat-exam-shell')).toHaveCount(0);

      await secondStudentPage.evaluate(() => window.localStorage.removeItem('ielts_student_attempts_v1'));
      await secondStudentPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(secondStudentPage.getByRole('heading', { name: /Exam Not Found|SAT attempt unavailable/i })).toBeVisible({ timeout: 45_000 });
      await expect(secondStudentPage.getByTestId('sat-exam-shell')).toHaveCount(0);

      // A manually edited candidate and attempt locator remain hints only;
      // the authenticated user's server identity supplies the canonical route.
      await schedulePage.evaluate(({ secondCandidateId, secondAttemptId }) => {
        const key = 'sat-resume-locator:v1';
        const raw = window.localStorage.getItem(key);
        if (!raw) throw new Error('SAT resume locator was not written.');
        const locator = JSON.parse(raw) as Record<string, unknown>;
        locator.candidateId = secondCandidateId;
        locator.attemptId = secondAttemptId;
        window.localStorage.setItem(key, JSON.stringify(locator));
      }, { secondCandidateId, secondAttemptId: secondAttempt.id });
      await schedulePage.goto(`/student/${scheduleId}`, { waitUntil: 'domcontentloaded' });
      await expect(schedulePage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      await expect(schedulePage).toHaveURL(new RegExp(`/student/${scheduleId}/${encodeURIComponent(candidateId)}$`));
      expect(await readAttemptIdentity(schedulePage, scheduleId, candidateId)).toEqual(original);
      await secondStudentContext.close();

      await schedulePage.close({ runBeforeUnload: false });
      const linkPage = await studentContext.newPage();
      await linkPage.goto(joinHref, { waitUntil: 'domcontentloaded' });
      await expect(linkPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      await expect(linkPage.locator('input[type="radio"]').first()).toBeChecked({ timeout: 30_000 });
      expect(await readAttemptIdentity(linkPage, scheduleId, candidateId)).toEqual(original);

      // The canonical student URL plus the HttpOnly cookie is sufficient even
      // after local discovery data has been removed.
      await linkPage.evaluate(() => window.localStorage.clear());
      await linkPage.goto(`/student/${scheduleId}/${encodeURIComponent(candidateId)}`, { waitUntil: 'domcontentloaded' });
      await expect(linkPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      expect(await readAttemptIdentity(linkPage, scheduleId, candidateId)).toEqual(original);

      // A new browser context with only the persistent HttpOnly auth cookie
      // has no localStorage, sessionStorage, or IndexedDB attempt cache. It
      // must recover the saved answer from the authenticated server response.
      const cookies = await studentContext.cookies();
      expect(cookies.some((cookie) => cookie.httpOnly && cookie.expires > Date.now() / 1_000)).toBe(true);
      const restartedContext = await browser.newContext({ storageState: { cookies, origins: [] } });
      const restartedPage = await restartedContext.newPage();
      await restartedPage.goto(`/student/${scheduleId}`, { waitUntil: 'domcontentloaded' });
      await expect(restartedPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      await expect(restartedPage.locator('input[type="radio"]').first()).toBeChecked({ timeout: 30_000 });
      expect(await readAttemptIdentity(restartedPage, scheduleId, candidateId)).toEqual(original);
      expect(await restartedPage.locator('input[type="radio"]:checked').first().inputValue()).toBe(savedAnswer);
      await restartedPage.getByRole('button', { name: 'Turn on cross-out mode' }).click();
      await expect(restartedPage.getByRole('button', { name: 'Restore option B' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(restartedPage.locator('[data-sat-highlight="true"]')).toHaveCount(1);

      // This context has the same authenticated student but a fresh writer
      // identity. It may recover the read-only exam state, but its first write
      // must hit the existing active-writer gate until the student takes over.
      const checkedFreshAnswer = restartedPage.locator('input[type="radio"]:checked').first();
      const freshQuestionName = await checkedFreshAnswer.getAttribute('name');
      if (!freshQuestionName) throw new Error('Resumed SAT answer control did not expose its question group.');
      const freshQuestionChoices = restartedPage.locator(
        `input[type="radio"][name="${freshQuestionName}"]`,
      );
      const currentFreshIndex = await freshQuestionChoices.evaluateAll((choices) =>
        choices.findIndex((choice) => (choice as HTMLInputElement).checked),
      );
      const nextFreshChoice = freshQuestionChoices.nth((currentFreshIndex + 1) % 4);
      const rejectedFreshAnswer = await nextFreshChoice.inputValue();
      const nextFreshChoiceId = await nextFreshChoice.evaluate((input) =>
        (input as HTMLInputElement).labels?.[0]?.htmlFor ?? null,
      );
      if (!nextFreshChoiceId) throw new Error('Fresh browser answer control did not expose its associated label.');
      await restartedPage.locator(`label[for="${nextFreshChoiceId}"]`).click();
      await expect(
        restartedPage.getByRole('alert').filter({ hasText: 'This attempt is open in another session.' }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(restartedPage.getByTestId('sat-exam-shell')).toHaveAttribute(
        'data-sat-save-state',
        'superseded',
        { timeout: 30_000 },
      );
      const afterRejectedFreshWrite = await readAttemptIdentity(restartedPage, scheduleId, candidateId);
      expect(afterRejectedFreshWrite.id).toBe(original.id);
      expect(Object.values(afterRejectedFreshWrite.answers)).toContain(savedAnswer);
      expect(Object.values(afterRejectedFreshWrite.answers)).not.toContain(rejectedFreshAnswer);

      // A valid locator and even a cached attempt are still only hints. Removing
      // the persistent auth cookie must return to check-in without mounting SAT.
      await restartedPage.evaluate(({ scheduleId, candidateId, attemptId, cachedAttempt }) => {
        window.localStorage.setItem('sat-resume-locator:v1', JSON.stringify({
          version: 1,
          providerKey: 'sat',
          scheduleId,
          candidateId,
          attemptId,
          updatedAt: new Date().toISOString(),
        }));
        window.localStorage.setItem('ielts_student_attempts_v1', cachedAttempt);
      }, { scheduleId, candidateId, attemptId: original.id, cachedAttempt: cachedAttemptA });
      await restartedContext.clearCookies();
      await restartedPage.goto(`/student/${scheduleId}`, { waitUntil: 'domcontentloaded' });
      await expect(restartedPage.getByRole('heading', { name: 'Exam Check-in' })).toBeVisible({ timeout: 30_000 });
      await expect(restartedPage.getByTestId('sat-exam-shell')).toHaveCount(0);
      await restartedPage.goto(`/student/${scheduleId}/${encodeURIComponent(candidateId)}`, { waitUntil: 'domcontentloaded' });
      await expect(restartedPage.getByTestId('sat-exam-shell')).toHaveCount(0);
      await restartedContext.close();

      // Restore only the non-secret locator, then remove the auth cookie. The
      // locator and cached attempt must not mount an exam on their own.
      await linkPage.evaluate(({ scheduleId, candidateId, attemptId }) => {
        window.localStorage.setItem('sat-resume-locator:v1', JSON.stringify({
          version: 1,
          providerKey: 'sat',
          scheduleId,
          candidateId,
          attemptId,
          updatedAt: new Date().toISOString(),
        }));
      }, { scheduleId, candidateId, attemptId: original.id });

      // Reopen while the resume endpoint is offline, then restore connectivity.
      // The failed probe retains its non-authoritative locator and the online
      // event triggers exactly one new bounded probe.
      await linkPage.close({ runBeforeUnload: false });
      const offlinePage = await studentContext.newPage();
      let resumeProbes = 0;
      const resumePattern = `**/api/v1/student/sessions/${scheduleId}**`;
      const resumeRoute = async (route: import('@playwright/test').Route) => {
        const url = new URL(route.request().url());
        if (url.pathname === `/api/v1/student/sessions/${scheduleId}` && url.searchParams.has('refreshAttemptCredential')) {
          resumeProbes += 1;
          if (resumeProbes === 1) {
            await route.abort('internetdisconnected');
            return;
          }
        }
        await route.continue();
      };
      await studentContext.route(resumePattern, resumeRoute);
      await offlinePage.goto(`/student/${scheduleId}`, { waitUntil: 'domcontentloaded' });
      await expect(offlinePage.getByRole('heading', { name: 'We couldn’t reconnect to your SAT' })).toBeVisible({ timeout: 45_000 });
      expect(resumeProbes).toBe(1);
      await expect.poll(() => offlinePage.evaluate(() => window.localStorage.getItem('sat-resume-locator:v1'))).not.toBeNull();
      await offlinePage.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect(offlinePage).toHaveURL(new RegExp(`/student/${scheduleId}/${encodeURIComponent(candidateId)}$`), { timeout: 45_000 });
      await expect(offlinePage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      expect(resumeProbes).toBe(2);
      await studentContext.unroute(resumePattern, resumeRoute);

      // A writer lease may advance while the student is away. Resume must mint
      // a credential for the current server epoch so the existing write path
      // remains usable, rather than reusing the original epoch 1 token.
      const advancedLease = await executeUpdate(
        'UPDATE student_attempts SET lease_epoch = lease_epoch + 5 WHERE id = ?',
        [original.id],
      );
      expect(advancedLease).toBe(1);
      await offlinePage.goto(`/student/${scheduleId}`, { waitUntil: 'domcontentloaded' });
      await expect(offlinePage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      const resumedQuestionName = await offlinePage.locator('input[type="radio"]').first().getAttribute('name');
      if (!resumedQuestionName) throw new Error('SAT answer control did not expose its question group.');
      const resumedQuestionChoices = offlinePage.locator(`input[type="radio"][name="${resumedQuestionName}"]`);
      await expect(resumedQuestionChoices).toHaveCount(4);
      const replacementChoice = resumedQuestionChoices.nth(1);
      const replacementChoiceId = await replacementChoice.evaluate((input) => {
        const element = input as HTMLInputElement;
        return element.labels?.[0]?.htmlFor ?? null;
      });
      if (!replacementChoiceId) throw new Error('SAT answer control did not expose its associated label.');
      const changedAnswer = await replacementChoice.inputValue();
      const replacementLabel = offlinePage.locator(`label[for="${replacementChoiceId}"]`);
      await expect(replacementLabel).toBeVisible();
      await replacementLabel.scrollIntoViewIfNeeded();
      await replacementLabel.click();
      await waitForSatSaved(offlinePage);
      const postLeaseWrite = await readAttemptIdentity(offlinePage, scheduleId, candidateId);
      expect(postLeaseWrite.id).toBe(original.id);
      expect(Object.values(postLeaseWrite.answers)).toContain(changedAnswer);

      // Terminate while the student tab is closed. The next visit must route
      // through the authoritative terminal attempt, then forget its locator.
      await offlinePage.close({ runBeforeUnload: false });
      const terminate = await postProctorApi(
        page.context(),
        `/api/v1/proctor/sessions/${scheduleId}/attempts/${original.id}/terminate`,
        { reason: 'e2e termination while student is away' },
      );
      expect(terminate.status, terminate.body).toBe(200);
      const terminatedPage = await studentContext.newPage();
      await terminatedPage.goto(`/student/${scheduleId}`, { waitUntil: 'domcontentloaded' });
      try {
        await expect(terminatedPage.getByRole('heading', { name: 'Your SAT attempt has ended' })).toBeVisible({ timeout: 45_000 });
      } catch (error) {
        throw new Error(
          `Terminated reopen did not show the terminal surface: ${JSON.stringify({
            url: terminatedPage.url(),
            text: await terminatedPage.locator('body').innerText().catch((readError) => String(readError)),
            runtime: await readRuntimeSnapshot(scheduleId),
            attempt: await queryDb(
              `SELECT proctor_status AS proctorStatus, phase, submitted_at AS submittedAt
                 FROM student_attempts WHERE id = ?`,
              [original.id],
            ),
          })}`,
          { cause: error },
        );
      }
      await expect(terminatedPage.getByTestId('sat-exam-shell')).toHaveCount(0);
      await expect.poll(() => terminatedPage.evaluate(() => window.localStorage.getItem('sat-resume-locator:v1'))).toBeNull();
      await terminatedPage.close({ runBeforeUnload: false });

      await studentContext.clearCookies();
      const unauthenticatedPage = await studentContext.newPage();
      await unauthenticatedPage.goto(`/student/${scheduleId}`, { waitUntil: 'domcontentloaded' });
      await expect(unauthenticatedPage.getByRole('heading', { name: 'Exam Check-in' })).toBeVisible({ timeout: 30_000 });
      await expect(unauthenticatedPage.getByTestId('sat-exam-shell')).toHaveCount(0);
    } finally {
      await studentContext.close();
    }
  });

  test('reopens from proctor pause and section break while the student is away', async ({
    page,
    browser,
  }) => {
    const { studentContext, studentPage, scheduleId, candidateId } = await createRunningSatSession(
      browser,
      page,
      { label: 'resume-lifecycle' },
    );
    const adminContext = page.context();
    try {
      const radios = studentPage.locator('input[type="radio"]');
      await studentPage.locator('label').filter({ has: radios.first() }).first().click();
      await waitForSatSaved(studentPage);
      const original = await readAttemptIdentity(studentPage, scheduleId, candidateId);
      await studentPage.close({ runBeforeUnload: false });

      const attemptControlUrl = `/api/v1/proctor/sessions/${scheduleId}/attempts/${original.id}`;
      const pause = await postProctorApi(adminContext, `${attemptControlUrl}/pause`, {
        reason: 'e2e pause while student is away',
      });
      expect(pause.status, pause.body).toBe(200);

      const pausedPage = await studentContext.newPage();
      await pausedPage.goto(`/student/${scheduleId}`, { waitUntil: 'domcontentloaded' });
      await expect(pausedPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      await expect(pausedPage.getByRole('heading', { name: 'Your timer is paused' })).toBeVisible({ timeout: 30_000 });
      const pausedSeconds = await readSatRemainingSeconds(pausedPage);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect(await readSatRemainingSeconds(pausedPage)).toBe(pausedSeconds);

      const resume = await postProctorApi(adminContext, `${attemptControlUrl}/resume`, {
        reason: 'e2e resume after closed-tab pause',
      });
      expect(resume.status, resume.body).toBe(200);
      await pausedPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(pausedPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      await expect(pausedPage.getByRole('heading', { name: 'Your timer is paused' })).toHaveCount(0);
      await pausedPage.close({ runBeforeUnload: false });

      // Expire the active shared section while no student page is mounted.
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
        const runtime = await readRuntimeSnapshot(scheduleId);
        return runtime.sections.find((section) => section.sectionKey === 'reading-writing')?.status ?? null;
      }, { timeout: 60_000, intervals: [250, 500, 1_000, 2_000] }).toBe('completed');

      const breakPage = await studentContext.newPage();
      await breakPage.goto(`/student/${scheduleId}`, { waitUntil: 'domcontentloaded' });
      await expect(breakPage.getByTestId('sat-scheduled-break')).toHaveAttribute(
        'data-sat-break-phase',
        /^(waiting-for-break|on-break)$/,
        { timeout: 45_000 },
      );
      await breakPage.close({ runBeforeUnload: false });

      // Advance the scheduled break while the browser is closed; reopening
      // must show the server's next section, not the prior local stage.
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
      await expect.poll(async () => (await readRuntimeSnapshot(scheduleId)).currentSectionKey, {
        timeout: 60_000,
        intervals: [250, 500, 1_000, 2_000],
      }).toBe('math');

      const mathPage = await studentContext.newPage();
      await mathPage.goto(`/student/${scheduleId}`, { waitUntil: 'domcontentloaded' });
      try {
        await expect(mathPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      } catch (error) {
        const rendered = await mathPage.evaluate(() => ({
          title: document.title,
          text: document.body.innerText.slice(0, 1_200),
        }));
        throw new Error(
          `Math reopen did not mount the SAT shell: ${JSON.stringify({
            url: mathPage.url(),
            rendered,
            runtime: await readRuntimeSnapshot(scheduleId),
            attempt: await readAttemptIdentity(mathPage, scheduleId, candidateId).catch((readError) => String(readError)),
            modules: await queryDb(
              `SELECT s.section_key AS sectionKey, m.module_key AS moduleKey, m.adaptive_role AS adaptiveRole,
                      ma.state, ma.started_at AS startedAt, ma.submitted_at AS submittedAt, ma.locked_at AS lockedAt
                 FROM assessment_module_attempts ma
                 JOIN assessment_modules m ON m.id = ma.module_id
                 JOIN assessment_sections s ON s.id = m.section_id
                WHERE ma.attempt_id = ?
                ORDER BY s.display_order, m.display_order`,
              [original.id],
            ),
          })}`,
          { cause: error },
        );
      }
      await expect(mathPage.getByTestId('sat-scheduled-break')).toHaveCount(0);
      expect(await readAttemptIdentity(mathPage, scheduleId, candidateId)).toMatchObject({ id: original.id });
      await mathPage.close({ runBeforeUnload: false });

    } finally {
      await studentContext.close();
    }
  });
});

async function readRuntimeSnapshot(scheduleId: string): Promise<{
  currentSectionKey: string | null;
  sections: Array<{ sectionKey: string; status: string | null }>;
}> {
  const rows = await queryDb<{
    current_section_key: string | null;
    section_key: string;
    status: string | null;
  }>(
    `SELECT r.current_section_key, rs.section_key, rs.status
       FROM exam_session_runtimes r
       JOIN exam_session_runtime_sections rs ON rs.runtime_id = r.id
      WHERE r.schedule_id = ?`,
    [scheduleId],
  );
  return {
    currentSectionKey: rows[0]?.current_section_key ?? null,
    sections: rows.map((section) => ({
      sectionKey: section.section_key,
      status: section.status ?? null,
    })),
  };
}

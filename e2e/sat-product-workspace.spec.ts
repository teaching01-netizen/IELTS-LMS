import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STORAGE_STATE_PATH } from './support/backendE2e';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

type SatBootstrapSummary = {
  attemptId: string;
  sectionKey: string;
  submittedModuleIds: string[];
};

async function finishCurrentSatSection(
  page: Page,
  scheduleId: string,
  attemptId: string,
  candidateId: string,
): Promise<SatBootstrapSummary> {
  return page.evaluate(async ({ scheduleId, attemptId, candidateId }) => {
    const delivery = await import('/src/features/student-delivery/api/assessmentDeliveryApi.ts');
    delivery.configureAssessmentDeliveryAttempt(scheduleId, attemptId, candidateId);
    let snapshot = await delivery.assessmentDeliveryApi.bootstrap(scheduleId, attemptId);
    const stageKey = snapshot.timing.stageKey;
    const section = snapshot.sections.find((item) => item.sectionKey === stageKey)
      ?? snapshot.sections.find((item) => item.modules.some((module) => snapshot.attempt.moduleAttempts.some((attempt) => attempt.moduleId === module.id && ['not_started', 'active', 'review'].includes(attempt.state))));
    if (!section) throw new Error(`No active SAT section for stage ${stageKey ?? 'unknown'}`);

    const submittedModuleIds: string[] = [];
    const submitModule = async (moduleId: string) => {
      const attempt = snapshot.attempt.moduleAttempts.find((item) => item.moduleId === moduleId);
      if (!attempt) throw new Error(`No module attempt for ${moduleId}`);
      if (attempt.state === 'not_started') {
        snapshot = await delivery.assessmentDeliveryApi.startModule(scheduleId, attemptId, { moduleId });
      }
      const current = snapshot.attempt.moduleAttempts.find((item) => item.moduleId === moduleId);
      if (current && !['submitted', 'locked'].includes(current.state)) {
        snapshot = await delivery.assessmentDeliveryApi.submitModule(scheduleId, attemptId, { moduleId });
      }
      submittedModuleIds.push(moduleId);
    };

    const base = section.modules.find((module) => module.adaptiveRole === 'base');
    if (!base) throw new Error(`No base module for ${section.sectionKey}`);
    await submitModule(base.id);

    const selectedBranchAttempt = snapshot.attempt.moduleAttempts.find((attempt) => {
      if (!['not_started', 'active', 'review'].includes(attempt.state)) return false;
      return section.modules.some((module) => module.id === attempt.moduleId && module.adaptiveRole !== 'base');
    });
    if (!selectedBranchAttempt) throw new Error(`No adaptive branch selected for ${section.sectionKey}`);
    await submitModule(selectedBranchAttempt.moduleId);

    return { attemptId: snapshot.attempt.id, sectionKey: section.sectionKey, submittedModuleIds };
  }, { scheduleId, attemptId, candidateId });
}

async function endCurrentCohortStage(page: Page, scheduleId: string) {
  return page.evaluate(async (id) => {
    const { backendPost } = await import('/src/services/backendBridge.ts');
    return backendPost<{ currentSectionKey: string | null; status: string }>(
      `/v1/proctor/sessions/${id}/control/end-section-now`,
      {},
      { retries: 0 },
    );
  }, scheduleId);
}

test.describe('Digital SAT product workspace', () => {
  test('creates, publishes, joins, proctors, submits, and surfaces a SAT result without IELTS leakage', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const stamp = Date.now().toString(36);
    const examTitle = `SAT Product Smoke ${stamp}`;
    const linkName = `SAT Open Link ${stamp}`;
    const studentName = `SAT Smoke Student ${stamp}`;
    const studentEmail = `sat-smoke-${stamp}@example.com`;

    await page.goto('/sat/exams');
    await expect(page.getByRole('heading', { name: 'Exam Library' })).toBeVisible();
    await expect(page.getByText('Digital SAT').first()).toBeVisible();
    await expect(page.getByText('IELTS', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'New SAT' }).click();
    await page.getByLabel('SAT exam name').fill(examTitle);
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page).toHaveURL(/\/sat\/exams\/[0-9a-f-]+$/i, { timeout: 30_000 });
    const examId = page.url().match(/\/sat\/exams\/([^/?#]+)/)?.[1];
    if (!examId) throw new Error('SAT exam id was not present after creation');

    await expect(page.getByRole('heading', { name: examTitle })).toBeVisible();
    await page.getByRole('button', { name: 'Load sample' }).click();
    await expect(page.getByRole('dialog', { name: 'Load sample SAT' })).toBeVisible();
    await page.getByRole('button', { name: 'Load 147 questions' }).click();
    await expect(page.getByText('147 of 147 questions authored')).toBeVisible({ timeout: 90_000 });

    await page.getByRole('button', { name: 'Release' }).click();
    await expect(page).toHaveURL(`/sat/exams/${examId}/release`);
    await expect(page.getByText('Ready to publish')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Publish' }).click();
    const publishDialog = page.getByRole('dialog');
    await expect(publishDialog).toBeVisible();
    await publishDialog.getByRole('button', { name: 'Publish' }).click();

    await expect(page).toHaveURL(`/sat/exams/${examId}/access`, { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Student Access' })).toBeVisible();
    await page.getByRole('button', { name: 'New Link' }).click();
    await page.getByLabel('Student Link name').fill(linkName);
    await page.getByRole('button', { name: /Name \+ email only/i }).click();
    await page.getByRole('button', { name: /Anytime/i }).click();
    await page.getByRole('button', { name: 'Create Link' }).click();
    await expect(page.getByText(linkName).first()).toBeVisible({ timeout: 20_000 });
    const joinHref = await page.getByRole('link', { name: 'Open student page' }).getAttribute('href');
    if (!joinHref) throw new Error('Student join URL was not created');

    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    try {
      await studentPage.goto(joinHref);
      await expect(studentPage.getByRole('heading', { name: linkName })).toBeVisible();
      await expect(studentPage.getByText(`${examTitle} · Version 1`)).toBeVisible();
      await studentPage.getByLabel('Full name').fill(studentName);
      await studentPage.getByLabel('Email').fill(studentEmail);
      await studentPage.getByRole('button', { name: /Continue/i }).click();
      await expect(studentPage).toHaveURL(/\/student\/[0-9a-f-]+\/[^/]+$/i, { timeout: 30_000 });
      const studentPath = new URL(studentPage.url()).pathname.split('/').filter(Boolean);
      const scheduleId = studentPath[1];
      const candidateId = decodeURIComponent(studentPath[2] ?? '');
      if (!scheduleId || !candidateId) throw new Error('Student handoff did not include schedule and candidate ids');

      await page.goto('/sat/sessions');
      await expect(page.getByRole('heading', { name: 'Sessions' })).toBeVisible();
      const sessionRow = page.locator('button').filter({ hasText: examTitle }).filter({ hasText: linkName }).first();
      await expect(sessionRow).toBeVisible({ timeout: 30_000 });
      await sessionRow.click();
      await expect(page).toHaveURL(`/sat/sessions/${scheduleId}`);
      await expect(page.getByText(studentName).first()).toBeVisible({ timeout: 30_000 });
      await page.getByRole('button', { name: 'Start' }).click();
      await expect(page.getByText('Session started.')).toBeVisible({ timeout: 20_000 });

      await studentPage.reload();
      await expect(studentPage.locator('body')).toContainText(/SAT|Reading|Module/i, { timeout: 30_000 });
      const attemptId = await studentPage.evaluate(async ({ scheduleId, candidateId }) => {
        const response = await fetch(`/api/v1/student/sessions/${scheduleId}/live?candidateId=${encodeURIComponent(candidateId)}`);
        const payload = await response.json();
        return payload?.data?.attempt?.id ?? payload?.attempt?.id ?? null;
      }, { scheduleId, candidateId });
      if (!attemptId) throw new Error('SAT student attempt did not materialize after proctor start');

      const reading = await finishCurrentSatSection(studentPage, scheduleId, attemptId, candidateId);
      expect(reading.sectionKey).toBe('reading-writing');

      let runtime = await endCurrentCohortStage(page, scheduleId);
      for (let step = 0; step < 3 && runtime.currentSectionKey !== 'math'; step += 1) {
        runtime = await endCurrentCohortStage(page, scheduleId);
      }
      expect(runtime.currentSectionKey).toBe('math');

      const math = await finishCurrentSatSection(studentPage, scheduleId, attemptId, candidateId);
      expect(math.sectionKey).toBe('math');

      const result = await studentPage.evaluate(async ({ scheduleId, attemptId, candidateId }) => {
        const delivery = await import('/src/features/student-delivery/api/assessmentDeliveryApi.ts');
        delivery.configureAssessmentDeliveryAttempt(scheduleId, attemptId, candidateId);
        return delivery.assessmentDeliveryApi.submitAssessment(scheduleId, attemptId, {
          submissionId: crypto.randomUUID(),
        });
      }, { scheduleId, attemptId, candidateId });
      expect(result.providerKey).toBe('sat');
      expect(result.scoreKind).toBe('practice');

      await page.goto('/sat/results');
      await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible();
      await page.getByLabel('Search SAT results').fill(studentName);
      const resultRow = page.locator('button').filter({ hasText: studentName }).filter({ hasText: examTitle }).first();
      await expect(resultRow).toBeVisible({ timeout: 30_000 });
      await expect(resultRow).not.toContainText('Overall Band');
      await resultRow.click();
      await expect(page.getByText('Practice score').or(page.getByText('Practice · raw score'))).toBeVisible();
      await expect(page.getByText('Reading & Writing')).toBeVisible();
      await expect(page.getByText('Math')).toBeVisible();

      await page.goto('/admin/exams');
      await expect(page.getByText(examTitle)).toHaveCount(0);
      await page.goto('/proctor');
      await expect(page.getByText(examTitle)).toHaveCount(0);
      await page.goto('/admin/results');
      await expect(page.getByText(studentName)).toHaveCount(0);
    } finally {
      await studentContext.close();
    }
  });
});

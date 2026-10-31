import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STORAGE_STATE_PATH } from './support/backendE2e';
import { closeDb, executeUpdate, queryDb } from './support/db';

// Regression: every schedule answer-key override call (list, upsert, delete,
// regrade from latest draft) failed with "Invalid request body." because the
// Go port kept a different contract on these routes. This drives each one
// through the real grading UI and checks the regraded rows in MySQL.

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

const suffix = randomUUID().slice(0, 8);
const examTitle = `IELTS Override E2E ${suffix}`;
const ids = {
  exam: randomUUID(),
  published: randomUUID(),
  draft: randomUUID(),
  schedule: randomUUID(),
  attempts: [randomUUID(), randomUUID()],
};
// Slot ids carry ":" (sent as %3A), which the API must decode before keying.
const questionId = `override-blk-${suffix}:lbl-1`;
// The worker's projection cursor is (updated_at, id) at second precision, so a
// row sharing the global seed's second with a smaller id can be skipped. Seed
// rows one second later so the worker always picks them up.
const afterSeedSecond = 'CURRENT_TIMESTAMP + INTERVAL 1 SECOND';

function content(correctAnswer: string) {
  return JSON.stringify({
    title: examTitle, type: 'Academic', providerKey: 'ielts',
    reading: { passages: [{
      id: `override-passage-${suffix}`, title: 'Override passage', content: 'The festival opens on 28 June.',
      blocks: [{ id: `override-block-${suffix}`, type: 'SHORT_ANSWER', instruction: 'Write a date.', questions: [
        { id: questionId, prompt: 'When does the festival open?', correctAnswer, answerRule: 'THREE_WORDS' },
      ] }],
    }] },
    listening: { parts: [] },
    writing: { tasks: [] },
    speaking: { part1Topics: [], cueCard: '', part3Discussion: [] },
  });
}

interface QuestionResult {
  isCorrect?: boolean;
  hasOverride?: boolean;
  correctAnswer?: string;
  acceptedAnswers?: string[];
}

async function readingResults(): Promise<QuestionResult[]> {
  const rows = await queryDb<{ results: string | null }>(`
    SELECT CAST(ss.auto_grading_results AS CHAR) AS results
    FROM section_submissions ss JOIN student_submissions s ON s.id = ss.submission_id
    WHERE s.schedule_id = ? AND ss.section = 'reading' ORDER BY s.attempt_id`, [ids.schedule]);
  return rows.map((row) => {
    const parsed = JSON.parse(row.results ?? '{}') as { questionResults?: Array<QuestionResult & { questionId: string }> };
    return parsed.questionResults?.find((result) => result.questionId === questionId) ?? {};
  });
}

async function openOverallCheck(page: Page) {
  await page.goto('/admin/grading');
  await page.getByRole('textbox', { name: 'Search sessions by exam or cohort' }).fill(examTitle);
  const row = page.locator('tbody tr').filter({ hasText: examTitle }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole('button', { name: /Open grading session/ }).click();
  await page.getByRole('button', { name: 'Overall answer check' }).click();
  await expect(page.getByRole('heading', { name: 'Overall exam answer check' })).toBeVisible();
  await page.getByRole('group', { name: 'Filter answer groups' }).getByRole('button', { name: /^All/ }).click();
  const group = page.getByRole('region', { name: '28 june' });
  await expect(group).toBeVisible({ timeout: 30_000 });
  return group;
}

async function decide(page: Page, accept: boolean) {
  const group = page.getByRole('region', { name: '28 june' });
  await group.getByRole('button', { name: accept ? 'Accept for whole exam' : 'Keep incorrect' }).click();
  const saves = page.waitForResponse((response) =>
    response.request().method() === 'PUT' && response.url().includes('/objective-overrides/'));
  await page.getByRole('button', { name: accept ? 'Accept and regrade' : 'Keep incorrect and regrade' }).click();
  const response = await saves;
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json() as { overrideRow?: { questionId: string }; regradeReport?: { submissionsMatched: number } };
  expect(body.overrideRow?.questionId).toBe(questionId);
  expect(body.regradeReport?.submissionsMatched).toBe(2);
  await expect(page.getByText(accept
    ? /Added “28 june” to the answer key for 1 question and regraded 2 students\./
    : /Kept “28 june” incorrect for the exam and regraded 2 students\./)).toBeVisible();
  await expect(page.getByText('Invalid request body.')).toHaveCount(0);
}

test.describe.serial('IELTS schedule answer-key overrides', () => {
  // The first test pays for the cold Vite dev compile of the admin bundle.
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async () => {
    const now = new Date();
    await executeUpdate(`
      INSERT INTO exam_entities (id, slug, title, provider_key, provider_exam_type, exam_type, status, visibility,
        organization_id, owner_id, schema_version, revision)
      VALUES (?, ?, ?, 'ielts', 'Academic', 'Academic', 'published', 'organization', 'e2e-org', 'override-e2e-owner', 1, 0)`,
      [ids.exam, `ielts-override-e2e-${suffix}`, examTitle]);
    await executeUpdate(`
      INSERT INTO exam_versions (id, exam_id, version_number, content_snapshot, config_snapshot, created_by, is_published, revision)
      VALUES (?, ?, 1, ?, '{}', 'override-e2e-owner', TRUE, 0), (?, ?, 2, ?, '{}', 'override-e2e-owner', FALSE, 0)`,
      [ids.published, ids.exam, content('28 June'), ids.draft, ids.exam, content('28 June | 28th June')]);
    await executeUpdate(
      'UPDATE exam_entities SET current_published_version_id = ?, current_draft_version_id = ? WHERE id = ?',
      [ids.published, ids.draft, ids.exam]);
    await executeUpdate(`
      INSERT INTO exam_schedules (id, exam_id, provider_key, organization_id, exam_title, proctor_display_name,
        grading_display_name, published_version_id, cohort_name, institution, start_time, end_time,
        planned_duration_minutes, delivery_mode, status, created_by, updated_at)
      VALUES (?, ?, 'ielts', 'e2e-org', ?, ?, ?, ?, 'Override cohort', 'Codex', ?, ?, 60, 'proctor_start', 'completed', 'override-e2e-owner',
        ${afterSeedSecond})`,
      [ids.schedule, ids.exam, examTitle, examTitle, examTitle, ids.published,
        new Date(now.getTime() - 2 * 3_600_000), new Date(now.getTime() - 3_600_000)]);
    const finalSubmission = JSON.stringify({ answers: { [questionId]: '28 june' }, writingAnswers: {} });
    for (const [index, attemptId] of ids.attempts.entries()) {
      await executeUpdate(`
        INSERT INTO student_attempts (id, schedule_id, student_key, organization_id, exam_id, published_version_id,
          exam_title, candidate_id, candidate_name, candidate_email, phase, current_module, answers, writing_answers,
          flags, violations_snapshot, integrity, recovery, revision, protocol_version, delivery_status, lease_epoch,
          control_epoch, response_revision, submitted_at, final_submission, updated_at)
        VALUES (?, ?, ?, 'e2e-org', ?, ?, ?, ?, ?, ?, 'post-exam', 'writing', '{}', '{}', '{}', '[]', '{}', '{}',
          0, 1, 'submitted', 1, 1, 0, ?, ?, ${afterSeedSecond})`,
        [attemptId, ids.schedule, attemptId, ids.exam, ids.published, examTitle,
          `override-candidate-${index}-${suffix}`, `Override Candidate ${index + 1}`,
          `override-${index}-${suffix}@example.test`, now, finalSubmission]);
    }
    // The worker's grading projection turns the submitted attempts into the
    // grading session and section rows the UI reads.
    await expect.poll(async () => (await readingResults()).length, { timeout: 60_000 }).toBe(2);
    await expect.poll(async () => (await queryDb<{ id: string }>(
      'SELECT id FROM grading_sessions WHERE schedule_id = ?', [ids.schedule])).length, { timeout: 60_000 }).toBe(1);
  });

  test.afterAll(async () => {
    await executeUpdate('DELETE FROM grading_sessions WHERE schedule_id = ?', [ids.schedule]).catch(() => 0);
    await executeUpdate('DELETE FROM exam_entities WHERE id = ?', [ids.exam]).catch(() => 0);
    await closeDb();
  });

  test('overall answer check accepts and then keeps an answer incorrect for the whole exam', async ({ page }) => {
    const group = await openOverallCheck(page);

    await decide(page, true);
    await expect.poll(readingResults).toEqual([
      expect.objectContaining({ isCorrect: true, hasOverride: true }),
      expect.objectContaining({ isCorrect: true, hasOverride: true }),
    ]);
    await expect(group.getByRole('status', { name: 'Correct' })).toBeVisible();

    // A fresh load reads the saved override back from the list endpoint.
    await page.reload();
    const reloaded = await openOverallCheck(page);
    await expect(reloaded.getByRole('status', { name: 'Correct' })).toBeVisible();

    await decide(page, false);
    await expect.poll(readingResults).toEqual([
      expect.objectContaining({ isCorrect: false, hasOverride: true }),
      expect.objectContaining({ isCorrect: false, hasOverride: true }),
    ]);
    await expect(reloaded.getByRole('status', { name: 'Incorrect' })).toBeVisible();
  });

  test('session settings removes the override and regrades from the latest draft', async ({ page }) => {
    await openOverallCheck(page);
    await page.getByRole('button', { name: /Session Settings/ }).click();
    const panel = page.locator('#objective-overrides-panel');
    await panel.getByRole('button', { name: /READING • Q1/ }).click();
    await panel.getByPlaceholder('Why is this override needed?').fill('E2E: back to the sealed key');

    const deleted = page.waitForResponse((response) =>
      response.request().method() === 'DELETE' && response.url().includes('/objective-overrides/'));
    await panel.getByRole('button', { name: 'Remove override' }).click();
    const deleteResponse = await deleted;
    expect(deleteResponse.status(), await deleteResponse.text()).toBe(200);
    // The panel resets its result message when the refreshed list drops the
    // override, so the regrade is checked on the response and in MySQL.
    expect(await deleteResponse.json()).toMatchObject({
      deleted: true,
      regradeReport: expect.objectContaining({ submissionsMatched: 2 }),
    });
    await expect.poll(readingResults).toEqual([
      expect.objectContaining({ hasOverride: false, correctAnswer: '28 June' }),
      expect.objectContaining({ hasOverride: false, correctAnswer: '28 June' }),
    ]);
    await expect(panel.getByRole('button', { name: 'Remove override' })).toBeDisabled();

    const regraded = page.waitForResponse((response) => response.url().includes('/objective-regrade-latest-draft'));
    await panel.getByRole('button', { name: 'Retry regrade' }).click();
    const regradeResponse = await regraded;
    expect(regradeResponse.status(), await regradeResponse.text()).toBe(200);
    await expect(panel.getByText(new RegExp(`Regraded from draft ${ids.draft}\\. Updated \\d+ sections across 2 attempts scanned\\.`))).toBeVisible();
    await expect.poll(readingResults).toEqual([
      expect.objectContaining({ acceptedAnswers: ['28 June', '28th June'] }),
      expect.objectContaining({ acceptedAnswers: ['28 June', '28th June'] }),
    ]);
    const source = await queryDb<{ source: string; version_id: string }>(
      'SELECT source, version_id FROM grading_schedule_objective_grading_source WHERE schedule_id = ?', [ids.schedule]);
    expect(source).toEqual([{ source: 'draft_version', version_id: ids.draft }]);
  });
});

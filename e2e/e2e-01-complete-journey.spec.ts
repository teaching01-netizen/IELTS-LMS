import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { readBackendE2EManifest } from './support/backendE2e';
import {
  completePreCheckIfPresent,
  deterministicWcode,
  openStudentSessionWithRetry,
  startLobbyIfPresent,
  studentCheckIn,
  stubScreenDetails,
} from './support/studentUi';
import { closeDb, queryDb, type SqlParam } from './support/db';
import {
  newAdminControlContext,
  proctorEndSection,
  proctorStartExam,
} from './support/proctorControls';

/**
 * E2E-01 — Complete successful exam journey with database verification.
 *
 * Check in → briefing → persist pre-check → waiting room → proctor starts exam
 * → answer every question type → submit section → proctor advances → complete
 * final section → backend confirms submission → post-exam screen.
 *
 * Mechanics discovered (verified empirically, see report):
 * - The seeded schedule's runtime is started by global-setup's seed, so
 *   "proctor starts exam" is idempotent (`start_runtime` tolerates 409).
 * - The runtime-backed student route renders NO manual submit control
 *   (`showSubmitControls={false}`): there is no "Finish" button. Section
 *   submission is proctor-driven: `POST /api/v1/proctor/sessions/:id/control/
 *   end-section-now` completes the active section and makes the next one live
 *   (last section completes the runtime and auto-submits the attempt).
 * - The student's answers are persisted continuously via `mutations:batch`;
 *   the backend auto-submit snapshots `student_attempts.final_submission`
 *   with the persisted answers, and a ~5s grading projection syncs
 *   `student_submissions` / `section_submissions` / `writing_task_submissions`.
 *
 * Environment gap (recorded, NOT fixed — production untouched): the playwright
 * webServer starts only `ielts-backend-api`. In the default
 * `background_runtime_mode=continuous` the API server does NOT run the grading
 * projection job (api/src/lib.rs spawns the activity-driven background runtime
 * only when `BACKGROUND_RUNTIME_MODE=activity_driven`); that job lives in the
 * `ielts-backend-worker` binary, which the webServer never starts. Verified:
 * `shared_cache_entries` has no `grading_projection_state_v1` row even after
 * submitted attempts exist, and `student_submissions` stays empty. This spec
 * therefore starts the real worker binary itself (test-only code) so the
 * grading-input DB assertions can verify real production behavior. Controller
 * decision needed: add the worker to playwright.config.ts webServer (it has no
 * HTTP health endpoint, so it needs a probe URL or a wrapper), or set
 * BACKGROUND_RUNTIME_MODE=activity_driven for e2e.
 *
 * DB verification (the load-bearing part): exact typed values must appear in
 * the submission snapshot JSON and in the grading input rows, scoped to this
 * run's schedule_id + unique student email.
 *
 * Honesty notes:
 * - The briefing screen was removed upstream; `completePreCheckIfPresent`
 *   settles on the resulting state rather than clicking/asserting a briefing
 *   UI, so the "briefing" step is exercised by state transition only.
 * - "Persist pre-check" is verified by attempt-row existence for this run's
 *   (schedule_id, email); the pre-check payload values themselves are not
 *   re-asserted from the DB.
 * - The student email is made unique per run (Date.now() suffix). Within one
 *   playwright invocation a CI retry reuses the same seeded schedule, so a
 *   deterministic email could otherwise collide with the failed run's attempt
 *   row; across invocations the seed creates a fresh schedule id and cascades
 *   old fixtures away, which is the second layer of isolation.
 */

// ---------------------------------------------------------------------------
// Grading projection worker lifecycle (see environment gap note above).
// ---------------------------------------------------------------------------

const backendDir = path.resolve(process.cwd(), 'backend');
const workerBinary = path.join(backendDir, 'target', 'debug', 'ielts-backend-worker');
let workerProcess: ChildProcess | null = null;
let workerLog = '';

/** Parse backend/.env the same way the playwright webServer sources it. */
function parseEnvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2) {
      const first = value[0];
      if ((first === '"' || first === "'") && value.endsWith(first)) {
        value = value.slice(1, -1);
      }
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * Ensure the worker binary exists and is current. Always run cargo build (it
 * is a no-op when up to date) instead of skipping on existsSync so a stale
 * cached binary from an earlier checkout cannot silently serve the spec.
 * The webServer already built the api crate, warming the shared target dir.
 */
async function buildWorkerIfNeeded(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(
      'cargo',
      ['build', '-p', 'ielts-backend-worker'],
      { cwd: backendDir, timeout: 600_000, maxBuffer: 32 * 1024 * 1024 },
      (error) => (error ? reject(error) : resolve()),
    );
  });
}

function startWorker(): void {
  // backend/.env values win over the inherited shell env, exactly like the
  // playwright webServer's `set -a && . ./.env && set +a` for the API server.
  const backendEnv = parseEnvFile(path.join(backendDir, '.env'));
  workerLog = '';
  workerProcess = spawn(workerBinary, [], {
    cwd: backendDir,
    env: {
      ...process.env,
      ...backendEnv,
      // Keep the spawned worker a pure grading-projection engine for this
      // journey: push the maintenance loops (retention/media cleanup) far out
      // so they cannot mutate shared test-DB rows mid-assertion.
      WORKER_MAINTENANCE_INTERVAL_SECS: '86400',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const capture = (chunk: Buffer) => {
    workerLog = (workerLog + chunk.toString()).slice(-16_000);
  };
  workerProcess.stdout?.on('data', capture);
  workerProcess.stderr?.on('data', capture);
}

async function stopWorker(): Promise<void> {
  const worker = workerProcess;
  workerProcess = null;
  if (!worker || worker.exitCode !== null) return;
  worker.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => worker.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (worker.exitCode === null) worker.kill('SIGKILL');
}

function workerAliveCheck(): null | string {
  const worker = workerProcess;
  if (!worker || worker.exitCode === null) return null;
  return `grading projection worker exited (code ${worker.exitCode}):\n${workerLog}`;
}

interface AttemptRow {
  id: string;
  phase: string;
  submitted_at: string | null;
  answers: string;
  writing_answers: string;
  final_submission: string | null;
  created_at: string;
  revision: number;
}

interface SectionSubmissionRow {
  section: string;
  answers: string;
  auto_grading_results: string | null;
  grading_status: string;
}

function parseJson<T>(raw: unknown): T {
  // mysql2 parses MySQL JSON columns into objects automatically; strings are
  // handled for robustness across driver/typeCast configurations.
  if (typeof raw === 'string') {
    return JSON.parse(raw) as T;
  }
  return raw as T;
}

/** Poll a DB query until `predicate` returns true (or timeout). */
async function pollDb<T extends object>(
  sql: string,
  params: SqlParam[],
  predicate: (rows: T[]) => boolean,
  description: string,
  timeoutMs = 90_000,
): Promise<T[]> {
  let lastRows: T[] = [];
  await expect
    .poll(
      async () => {
        try {
          lastRows = await queryDb<T>(sql, params);
          return predicate(lastRows);
        } catch {
          return false;
        }
      },
      { timeout: timeoutMs, message: description },
    )
    .toBe(true);
  return lastRows;
}

/** Wait for the student's autosave banner to report "Saved". */
async function waitForSavedBanner(page: Page) {
  await expect
    .poll(
      async () => {
        const banner = page.getByRole('banner');
        return banner.getByText('Saved').isVisible().catch(() => false);
      },
      { timeout: 30_000, message: 'autosave banner shows Saved' },
    )
    .toBe(true);
}

/** Wait for the currently rendered exam section marker (prompt text). */
async function waitForSectionMarker(page: Page, marker: RegExp | string, label: string) {
  await expect(page.getByText(marker).first(), label).toBeVisible({ timeout: 60_000 });
}

test.describe('E2E-01 Complete successful exam journey (DB-verified)', () => {
  test.describe.configure({ timeout: 300_000 });

  test.beforeAll(async () => {
    // The grading-input sync lives in ielts-backend-worker, which the
    // playwright webServer does not start (see header note). Start the real
    // binary here so the DB verification below exercises production behavior.
    // Hook timeout is 30s by default; a cold `cargo build` needs more.
    test.setTimeout(600_000);
    await buildWorkerIfNeeded();
    startWorker();
    // Give the worker a moment to boot; a premature exit is a hard failure.
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    const problem = workerAliveCheck();
    if (problem) throw new Error(problem);
  });

  test.afterAll(async () => {
    await stopWorker();
    await closeDb();
  });

  test('check in, answer all rendered question types across sections, proctor advances, backend confirms submission', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const scheduleId = manifest.student.scheduleId;
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    const email = `e2e01+${wcode.toLowerCase()}-${Date.now()}@example.com`;
    const fullName = `E2E01 Candidate ${wcode}`;

    // Unique sentinels: exact strings the DB snapshot must contain verbatim.
    const listeningAnswer = `e2e01-listening-${wcode.toLowerCase()}`;
    const readingAnswer = `e2e01-reading-${wcode.toLowerCase()}`;
    const writingTask1Text = `e2e01-task1-${wcode.toLowerCase()}`;
    const writingTask2Text = `e2e01-task2-${wcode.toLowerCase()}`;

    const adminContext = await newAdminControlContext(browser);
    const studentContext = await browser.newContext();
    await stubScreenDetails(studentContext);
    const studentPage = await studentContext.newPage();

    // ---- 1. Check in ----
    await studentCheckIn(studentPage, scheduleId, {
      wcode,
      email,
      fullName,
    });

    // ---- 2+3. Briefing / persist pre-check / waiting room ----
    await openStudentSessionWithRetry(studentPage, scheduleId, wcode);
    await completePreCheckIfPresent(studentPage);

    // The attempt row must exist for this run's unique email.
    const attemptCreated = await pollDb<{ id: string; phase: string }>(
      'SELECT id, phase FROM student_attempts WHERE schedule_id = ? AND candidate_email = ?',
      [scheduleId, email],
      (rows) => rows.length === 1,
      'student attempt row created for this run',
    );
    const attemptId = attemptCreated[0].id;

    // ---- 4. Proctor starts exam (seed pre-starts the runtime; 409 tolerated) ----
    await proctorStartExam(adminContext, scheduleId);
    await startLobbyIfPresent(studentPage);
    await openStudentSessionWithRetry(studentPage, scheduleId, wcode);

    // The seeded exam renders: listening SHORT_ANSWER → reading SHORT_ANSWER →
    // writing tasks. (allowedQuestionTypes also lists TFNG/CLOZE/MATCHING/MAP/
    // MULTI_MCQ but the seeded content contains no such blocks.)
    await waitForSectionMarker(
      studentPage,
      'What is the seeded listening answer?',
      'listening section prompt',
    );
    await expect(studentPage.getByLabel('Answer for question 1')).toBeVisible({ timeout: 30_000 });

    // ---- 5. Answer listening (SHORT_ANSWER) ----
    await studentPage.getByLabel('Answer for question 1').fill(listeningAnswer);
    await waitForSavedBanner(studentPage);
    await pollDb<{ answers: string }>(
      'SELECT answers FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => {
        const answers = parseJson<Record<string, unknown>>(rows[0].answers);
        return answers['listening-q1'] === listeningAnswer;
      },
      'listening answer persisted to student_attempts.answers',
    );

    // ---- 6+7. Submit section (proctor-driven) + proctor advances listening → reading ----
    await proctorEndSection(adminContext, scheduleId, 'listening', 'advance listening to reading');
    await waitForSectionMarker(
      studentPage,
      'Write the missing word from the passage.',
      'reading section prompt after proctor advance',
    );

    // ---- 8. Answer reading (SHORT_ANSWER) ----
    await expect(studentPage.getByLabel('Answer for question 1')).toBeVisible({ timeout: 30_000 });
    await studentPage.getByLabel('Answer for question 1').fill(readingAnswer);
    await waitForSavedBanner(studentPage);
    await pollDb<{ answers: string }>(
      'SELECT answers FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => {
        const answers = parseJson<Record<string, unknown>>(rows[0].answers);
        return (
          answers['listening-q1'] === listeningAnswer && answers['reading-q1'] === readingAnswer
        );
      },
      'listening + reading answers persisted to student_attempts.answers',
    );

    // ---- 9. Proctor advances reading → writing ----
    await proctorEndSection(adminContext, scheduleId, 'reading', 'advance reading to writing');
    await waitForSectionMarker(studentPage, /Task 1: Summarise/, 'writing section prompt');

    // ---- 10. Answer writing tasks (task1 + task2) ----
    const writingEditor = studentPage.getByLabel('Writing response');
    await expect(writingEditor).toBeVisible({ timeout: 30_000 });
    await writingEditor.fill(writingTask1Text);
    await studentPage.getByRole('button', { name: 'Task 2', exact: true }).click();
    await writingEditor.fill(writingTask2Text);
    // Switch back so task2's draft commits; then blur so the editor flushes.
    await studentPage.getByRole('button', { name: 'Task 1', exact: true }).click();
    await writingEditor.blur();
    await waitForSavedBanner(studentPage);
    await pollDb<{ writing_answers: string }>(
      'SELECT writing_answers FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => {
        const writing = parseJson<Record<string, unknown>>(rows[0].writing_answers);
        return (
          writing['task1'] === writingTask1Text && writing['task2'] === writingTask2Text
        );
      },
      'writing answers persisted to student_attempts.writing_answers',
    );

    // ---- 11. Proctor ends the final section (writing): runtime completes + backend auto-submits ----
    await proctorEndSection(adminContext, scheduleId, 'writing', 'complete final section');

    // ---- 12. Backend confirms submission: snapshot row + submitted_at ----
    const attempt = await pollDb<AttemptRow>(
      `SELECT id, phase, submitted_at, answers, writing_answers, final_submission, created_at, revision
       FROM student_attempts
       WHERE id = ?`,
      [attemptId],
      (rows) =>
        rows.length === 1 &&
        rows[0].phase === 'post-exam' &&
        rows[0].submitted_at !== null &&
        rows[0].final_submission !== null,
      'student_attempts final_submission snapshot persisted',
    );
    const snapshotRow = attempt[0];

    // ---- 13. Post-exam screen ----
    await expect(
      studentPage.getByRole('heading', { name: /Examination Complete!/i }),
      'post-exam screen',
    ).toBeVisible({ timeout: 60_000 });

    // ================= DB VERIFICATION =================

    // 13a. Submission snapshot: exact typed values, not just row existence.
    expect(snapshotRow.submitted_at).not.toBeNull();
    expect(snapshotRow.final_submission).not.toBeNull();
    const persistedAnswers = parseJson<Record<string, unknown>>(snapshotRow.answers);
    expect(persistedAnswers).toEqual({
      'listening-q1': listeningAnswer,
      'reading-q1': readingAnswer,
    });
    const persistedWriting = parseJson<Record<string, unknown>>(snapshotRow.writing_answers);
    expect(persistedWriting).toEqual({
      task1: writingTask1Text,
      task2: writingTask2Text,
    });
    const snapshot = parseJson<Record<string, unknown>>(snapshotRow.final_submission as string);
    expect(snapshot['submissionId']).toBeTruthy();
    expect(Number.isNaN(Date.parse(String(snapshot['submittedAt'])))).toBe(false);
    expect(snapshot['answers']).toEqual({
      'listening-q1': listeningAnswer,
      'reading-q1': readingAnswer,
    });
    expect(snapshot['writingAnswers']).toEqual({
      task1: writingTask1Text,
      task2: writingTask2Text,
    });
    // Structural: the snapshot was taken either by the backend auto-submit
    // (proctor ends last section) or the student final-flush pipeline.
    const autoSubmission = snapshot['autoSubmission'] === true;
    const finalFlush = snapshot['finalFlush'] != null;
    expect(autoSubmission || finalFlush, 'snapshot carries autoSubmission or finalFlush').toBe(true);
    // Timestamps sane: submitted_at after created_at, revision advanced.
    expect(new Date(snapshotRow.submitted_at as string).getTime()).toBeGreaterThanOrEqual(
      new Date(snapshotRow.created_at).getTime(),
    );
    expect(snapshotRow.revision).toBeGreaterThanOrEqual(1);

    // 13b. Grading input: student_submissions row (synced by the ~5s projection).
    const submissionRows = await pollDb<{ id: string; grading_status: string; student_email: string | null; section_statuses: string }>(
      'SELECT id, grading_status, student_email, section_statuses FROM student_submissions WHERE attempt_id = ?',
      [attemptId],
      (rows) =>
        rows.length === 1 &&
        rows[0].grading_status === 'submitted' &&
        rows[0].student_email === email,
      'student_submissions grading input row synced',
    );
    const submission = submissionRows[0];
    const sectionStatuses = parseJson<Record<string, unknown>>(submission.section_statuses);
    expect(sectionStatuses).toMatchObject({
      listening: 'auto_graded',
      reading: 'auto_graded',
      writing: 'needs_review',
    });

    // 13c. Grading input: per-section rows with the exact per-question values.
    // The projection inserts student_submissions first and the section rows a
    // moment later within the same cycle, so poll until all sections exist.
    const sectionRows = await pollDb<SectionSubmissionRow>(
      `SELECT section, answers, auto_grading_results, grading_status
       FROM section_submissions
       WHERE submission_id = ?
       ORDER BY section`,
      [submission.id],
      (rows) => {
        const keys = rows.map((row) => row.section).sort();
        return (
          keys.length === 4 &&
          keys[0] === 'listening' &&
          keys[1] === 'reading' &&
          keys[2] === 'speaking' &&
          keys[3] === 'writing'
        );
      },
      'all four section_submissions rows synced by the grading projection',
    );
    const bySection = new Map(sectionRows.map((row) => [row.section, row]));
    expect([...bySection.keys()].sort()).toEqual(['listening', 'reading', 'speaking', 'writing']);

    const listeningSection = bySection.get('listening') as SectionSubmissionRow;
    expect(listeningSection.grading_status).toBe('auto_graded');
    expect(parseJson(listeningSection.answers)).toEqual({
      type: 'listening',
      answers: { 'listening-q1': listeningAnswer },
    });
    const listeningResults = parseJson<{ percentage?: unknown; questionResults?: Array<Record<string, unknown>> }>(
      listeningSection.auto_grading_results as string,
    );
    expect(typeof listeningResults.percentage).toBe('number');
    expect(listeningResults.questionResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ questionId: 'listening-q1', studentAnswer: listeningAnswer }),
      ]),
    );

    const readingSection = bySection.get('reading') as SectionSubmissionRow;
    expect(readingSection.grading_status).toBe('auto_graded');
    expect(parseJson(readingSection.answers)).toEqual({
      type: 'reading',
      answers: { 'reading-q1': readingAnswer },
    });
    const readingResults = parseJson<{ questionResults?: Array<Record<string, unknown>> }>(
      readingSection.auto_grading_results as string,
    );
    expect(readingResults.questionResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ questionId: 'reading-q1', studentAnswer: readingAnswer }),
      ]),
    );

    const writingSection = bySection.get('writing') as SectionSubmissionRow;
    expect(writingSection.grading_status).toBe('needs_review');
    const writingPayload = parseJson<{ type: string; tasks?: Array<{ taskId: string; text: string; wordCount: number }> }>(
      writingSection.answers,
    );
    expect(writingPayload.type).toBe('writing');
    expect((writingPayload.tasks ?? []).map((task) => task.taskId).sort()).toEqual(['task1', 'task2']);
    const task1 = (writingPayload.tasks ?? []).find((task) => task.taskId === 'task1');
    const task2 = (writingPayload.tasks ?? []).find((task) => task.taskId === 'task2');
    expect(task1?.text).toBe(writingTask1Text);
    expect(task2?.text).toBe(writingTask2Text);

    // 13d. Grading input: writing task rows with the exact student text.
    // Also created by the projection in the same cycle; poll for both tasks.
    const writingTaskRows = await pollDb<{ task_id: string; student_text: string; word_count: number; grading_status: string }>(
      `SELECT task_id, student_text, word_count, grading_status
       FROM writing_task_submissions
       WHERE submission_id = ?
       ORDER BY task_id`,
      [submission.id],
      (rows) => rows.length === 2 && rows[0].task_id === 'task1' && rows[1].task_id === 'task2',
      'writing_task_submissions rows synced by the grading projection',
    );
    expect(writingTaskRows.map((row) => row.task_id)).toEqual(['task1', 'task2']);
    expect(writingTaskRows[0].student_text).toBe(writingTask1Text);
    expect(writingTaskRows[1].student_text).toBe(writingTask2Text);
    expect(Number(writingTaskRows[0].word_count)).toBeGreaterThan(0);
    expect(Number(writingTaskRows[1].word_count)).toBeGreaterThan(0);
    expect(writingTaskRows.every((row) => row.grading_status === 'needs_review')).toBe(true);

    // 13e. Grading session exists for the schedule with the submission counted.
    const gradingSessions = await pollDb<{ id: string; status: string; submitted_count: number }>(
      'SELECT id, status, submitted_count FROM grading_sessions WHERE schedule_id = ?',
      [scheduleId],
      (rows) => rows.length >= 1 && Number(rows[0].submitted_count) >= 1,
      'grading_sessions row reflects the submission',
    );
    expect(gradingSessions[0].status).toBe('completed');

    // Exactly one attempt row for this run's (schedule, email) — no duplicates.
    const attemptCount = await queryDb<{ count: number }>(
      'SELECT COUNT(*) AS count FROM student_attempts WHERE schedule_id = ? AND candidate_email = ?',
      [scheduleId, email],
    );
    expect(Number(attemptCount[0].count)).toBe(1);

    // The grading projection worker must have stayed alive for the whole run.
    const workerProblem = workerAliveCheck();
    if (workerProblem) throw new Error(workerProblem);

    await studentContext.close();
    await adminContext.close();
  });
});

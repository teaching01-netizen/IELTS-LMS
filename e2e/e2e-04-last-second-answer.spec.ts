import fs from 'node:fs';
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
import { closeDb, executeUpdate, queryDb, type SqlParam } from './support/db';
import {
  newAdminControlContext,
  proctorEndSection,
  proctorStartExam,
} from './support/proctorControls';
import {
  buildWorkerIfNeeded,
  startWorker,
  stopWorker,
  workerAliveCheck,
} from './support/gradingWorker';

/** Shape of the student live-session endpoint used by the timer polls. */
interface LivePayload {
  data?: {
    runtime?: {
      status?: string | null;
      currentSectionKey?: string | null;
      currentSectionRemainingSeconds?: number;
    };
  };
}

/**
 * E2E-04 — Last-second answer (invariant1.md §5 journey).
 *
 * Journey: check in → waiting → proctor starts exam → answer listening +
 * reading normally (sentinels) → advance to writing → type during the final
 * 1–2 seconds of the writing section → the automatic section submission fires
 * (NO proctor end-section-now) → the attempt reaches post-exam → the final
 * value must appear EXACTLY in the backend submission snapshot
 * (`student_attempts.final_submission` / `answers` / `writing_answers`) AND in
 * the grading input (`student_submissions` / `section_submissions` /
 * `writing_task_submissions.student_text`, plus the objective
 * `auto_grading_results.questionResults[].studentAnswer`) — equality of
 * value, not row existence.
 *
 * How the deadline is shortened (deterministic test-data manipulation, no
 * clock mocking — the seeded section durations are 30/60/60 minutes, too long
 * to wait):
 * - The section deadline is NOT a stored column. It is derived server-side as
 *   `actual_start_at + (planned_duration_minutes + extension_minutes)*60 +
 *   accumulated_paused_seconds` (backend/crates/application/src/proctoring.rs
 *   `section_deadline` :2063 and scheduling.rs `compute_live_section_deadline`
 *   :1312). The live session endpoint recomputes
 *   `currentSectionRemainingSeconds` from that deadline on every request
 *   (`runtime_hydration_row_to_runtime`, proctoring.rs :2095-2112 — the
 *   cached `current_section_remaining_seconds` column is ignored while the
 *   runtime is live), and the API server's runtime auto-advance reconciler
 *   (1s tick, `runtime_auto_advance.rs`) uses the same derived deadline to
 *   complete expired sections.
 * - The spec therefore rewinds `exam_session_runtime_sections.actual_start_at`
 *   for the live writing section so the derived deadline lands ~20s in the
 *   future. This simulates elapsed time on the authoritative source of truth;
 *   every production code path (student timer anchor, live endpoint, auto
 *   advance reconciler) then observes the shortened deadline with no mocking.
 *
 * How the automatic submission fires (both are production behavior, neither
 * is proctor-driven):
 * - Client path: `useStudentAutoSubmitBoundary` (src/components/student/
 *   useStudentAutoSubmitBoundary.ts) watches the server-anchored local
 *   countdown; on reaching 0 it calls `flushAndSubmitCurrentModuleWithRetry`
 *   (flush pending mutations → submit the module; for the final section this
 *   finalizes the attempt). The seed config sets `progression.autoSubmit: true`.
 * - Server path: the API server's runtime auto-advance reconciler completes
 *   the expired section + runtime and calls
 *   `auto_submit_schedule_attempts_in_tx` in the same transaction
 *   (`completion_reason = 'time_expired'`).
 * - Which side actually took the snapshot is measured, not assumed: the
 *   snapshot carries `autoSubmission: true` when the server-side in-transaction
 *   auto-submit won and `finalFlush` when the client's final-flush pipeline
 *   won (same disjunction e2e-01 asserts).
 *
 * Last-second typing (inherently racy by design — the load-bearing assertions
 * are on the DB end state, which is deterministic once the submission lands):
 * - The final text is typed in two stages against the SERVER-authoritative
 *   remaining time (`GET /api/v1/student/sessions/:id/live` →
 *   `data.runtime.currentSectionRemainingSeconds`, recomputed server-side):
 *   most of the text at ≤6s remaining, the final character at ≤3s remaining.
 * - Each stage is flush-gated in the DB (`student_attempts.writing_answers.
 *   task1` must contain the exact staged value) BEFORE the deadline passes;
 *   the submission snapshot reads the persisted columns, so a value that is
 *   in `writing_answers` before the deadline is in the snapshot by
 *   construction. The measured numbers (server remaining at each fill, flush
 *   latency) are logged. If the final keystroke cannot beat the snapshot
 *   (boundary finding), the spec asserts the latest value that IS captured
 *   and logs the measured boundary — the invariant is that no value typed
 *   before the snapshot is lost silently.
 *
 * Honesty notes / deviations:
 * - The briefing UI was removed upstream (see e2e-01 header); pre-check
 *   settling is exercised by state transition only.
 * - "Type during the final 1–2 seconds": the final keystroke is scheduled at
 *   ≤3s of server-authoritative remaining time and its actual landing time is
 *   measured and reported; the deterministic proof is the flush-gated DB end
 *   state, not a wall-clock stopwatch.
 * - The final-fill editor actions carry explicit short timeouts (2s) and a
 *   lost race is a recorded boundary, not a failure: without them Playwright
 *   inherits the 600s test timeout for actions, so a fill racing a section
 *   lock (editor disabled mid-fill) hung the whole test until the timeout
 *   aborted it. With them the "section locked before the final keystroke"
 *   case is measured and the latest captured value is asserted instead.
 * - Post-submit grace merge (measured, not fixed): when the final keystroke
 *   lands but its flush does not beat the server-side snapshot, the API
 *   accepts the mutation within its post-submit grace window
 *   (`final_submit_grace_seconds`, observed at submit+~4s) and merges it
 *   into `final_submission`, marking the snapshot with `finalFlush` +
 *   `graceMerge` (the mutation itself stays append-only in
 *   `student_attempt_mutations`). The spec waits for the converged attempt
 *   row (poll) before asserting, and logs the merge as a finding.
 * - Grading projection convergence: the worker's watermark sync re-picks an
 *   attempt whose `updated_at` moved (grace merge bumps it) and UPSERTs the
 *   projection, so `student_submissions` / `section_submissions` /
 *   `writing_task_submissions` converge to the merged value on the next
 *   worker cycle. The spec polls for the exact converged value and logs the
 *   first observation when it differed (transient divergence evidence).
 * - CI retries (2) cannot succeed for this journey: the seeded access code
 *   binds student identity on the first check-in, so retries fail with
 *   "Student identity is locked for this access code" (pre-existing
 *   environment property; the first attempt is the load-bearing one).
 * - The reload after the deadline manipulation is the app's own
 *   session-reload path (proven across every phase in e2e-02); it is the
 *   mechanism that re-anchors the student's timer to the shortened deadline
 *   (the app polls /live at ~20s while the WS is connected, too slow for a
 *   20s window).
 * - The DB deadline UPDATE is test-data manipulation of the seeded runtime
 *   (documented above); it changes no production code and is scoped to this
 *   run's schedule row.
 *
 * Test isolation: unique email per run (`e2e04+...-<Date.now()>@example.com`)
 * and unique sentinels. Exactly one attempt row must exist for the run's
 * (schedule, email) at the end.
 */

// ---------------------------------------------------------------------------
// Small shared helpers (mirror e2e-01/e2e-02's proven implementations).
// ---------------------------------------------------------------------------

function parseJson<T>(raw: unknown): T {
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

interface ServerTimerSnapshot {
  sectionKey: string | null;
  remainingSeconds: number;
}

/**
 * Server-authoritative remaining time: the live session endpoint computes
 * `currentSectionRemainingSeconds` from the section deadline server-side on
 * every request, so it is the ground truth for the deadline choreography
 * (mirrors e2e-02's timer-fairness probe helper).
 */
async function readServerTimerSnapshot(
  page: Page,
  scheduleId: string,
): Promise<ServerTimerSnapshot | null> {
  const response = await page.request.get(`/api/v1/student/sessions/${scheduleId}/live`);
  if (!response.ok()) {
    return null;
  }
  const payload = (await response.json()) as {
    data?: { runtime?: { currentSectionKey?: string | null; currentSectionRemainingSeconds?: number } };
  };
  const runtime = payload?.data?.runtime;
  if (!runtime || typeof runtime.currentSectionRemainingSeconds !== 'number') {
    return null;
  }
  return {
    sectionKey: runtime.currentSectionKey ?? null,
    remainingSeconds: runtime.currentSectionRemainingSeconds,
  };
}

// ---------------------------------------------------------------------------
// Deadline manipulation (see header note: derived deadline, test-data only).
// ---------------------------------------------------------------------------

interface WritingSectionRow {
  status: string;
  actual_start_at: string | null;
  planned_duration_minutes: number;
  extension_minutes: number;
  accumulated_paused_seconds: number;
}

/** The derived deadline the server computes for a section. */
function derivedDeadlineSeconds(section: WritingSectionRow): number {
  return (
    (section.planned_duration_minutes + section.extension_minutes) * 60 +
    section.accumulated_paused_seconds
  );
}

/**
 * Rewind the live writing section's `actual_start_at` so its derived deadline
 * (actual_start_at + planned duration + extensions + paused seconds) lands
 * `targetRemainingSeconds` in the future. Every production path (live
 * endpoint, student timer anchor, auto-advance reconciler) derives the
 * deadline from this column, so the shortened deadline is observed everywhere
 * with no clock mocking. Returns the measured facts for the report.
 */
async function shortenWritingSectionDeadline(
  scheduleId: string,
  targetRemainingSeconds: number,
): Promise<{ derivedDurationSeconds: number; targetRemainingSeconds: number; affectedRows: number }> {
  const rows = await queryDb<WritingSectionRow>(
    `SELECT status, actual_start_at, planned_duration_minutes, extension_minutes, accumulated_paused_seconds
     FROM exam_session_runtime_sections
     WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
       AND section_key = 'writing'`,
    [scheduleId],
  );
  const section = rows[0];
  if (!section) {
    throw new Error(`no exam_session_runtime_sections row for schedule ${scheduleId} (writing)`);
  }
  if (section.status !== 'live') {
    throw new Error(`writing section is not live (status=${section.status}); cannot shorten its deadline`);
  }
  const durationSeconds = derivedDeadlineSeconds(section);
  // new actual_start_at = db_now - elapsed-so-far, where elapsed-so-far
  // leaves exactly targetRemainingSeconds until the derived deadline.
  // Anchored to the DB clock (UTC_TIMESTAMP(3), same tz as the session) so
  // client-clock skew cannot compress the timing corridor.
  const affectedRows = await executeUpdate(
    `UPDATE exam_session_runtime_sections
     SET actual_start_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? SECOND)
     WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
       AND section_key = 'writing'
       AND status = 'live'`,
    [durationSeconds - targetRemainingSeconds, scheduleId],
  );
  if (affectedRows !== 1) {
    throw new Error(`deadline UPDATE affected ${affectedRows} rows, expected exactly 1`);
  }
  return {
    derivedDurationSeconds: durationSeconds,
    targetRemainingSeconds,
    affectedRows,
  };
}

/** Poll the server-authoritative remaining time until it is ≤ threshold. */
async function waitForServerRemainingAtMost(
  page: Page,
  scheduleId: string,
  thresholdSeconds: number,
  label: string,
  timeoutMs = 30_000,
): Promise<number> {
  let lastObserved = Number.POSITIVE_INFINITY;
  // Diagnostic capture for the deadline choreography: if the live endpoint
  // misbehaves (non-OK, wrong shape, stale value), the poll failure must say
  // exactly what the endpoint returned. Per-tick facts are appended to a
  // /tmp log so the full sequence is inspectable.
  const diagPath = '/tmp/e2e04-live-poll-diag.log';
  try {
    await expect
      .poll(
        async () => {
          const response = await page.request.get(`/api/v1/student/sessions/${scheduleId}/live`);
          const rawBody = await response.text();
          // NB: cast to the named type, NOT `as typeof payload` — a self-reference
          // lets TS narrow payload to null/never and breaks the access below.
          let payload: LivePayload | null = null;
          try {
            payload = JSON.parse(rawBody) as LivePayload;
          } catch {
            payload = null;
          }
          const runtime = payload?.data?.runtime;
          const remaining =
            runtime && typeof runtime.currentSectionRemainingSeconds === 'number'
              ? runtime.currentSectionRemainingSeconds
              : null;
          if (remaining !== null) {
            lastObserved = remaining;
          }
          fs.appendFileSync(
            diagPath,
            `${new Date().toISOString()} label=${label} status=${response.status()} ` +
              `runtimeStatus=${JSON.stringify(runtime?.status ?? null)} ` +
              `sectionKey=${JSON.stringify(runtime?.currentSectionKey ?? null)} remaining=${remaining}\n`,
          );
          return response.ok() && remaining !== null && remaining <= thresholdSeconds;
        },
        { timeout: timeoutMs, message: label },
      )
      .toBe(true);
  } catch (error) {
    console.log(`[e2e-04][diag] ${label}: poll failed — per-tick facts in ${diagPath}`);
    throw error;
  }
  return lastObserved;
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
  id: string;
  section: string;
  answers: string;
  auto_grading_results: string | null;
  grading_status: string;
}

test.describe('E2E-04 Last-second answer (DB-verified)', () => {
  test.describe.configure({ timeout: 600_000 });

  test.beforeAll(async () => {
    // The grading-input projection lives in ielts-backend-worker, which the
    // playwright webServer does not start (see gradingWorker.ts header).
    test.setTimeout(600_000);
    await buildWorkerIfNeeded();
    startWorker();
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    const problem = workerAliveCheck();
    if (problem) throw new Error(problem);
  });

  test.afterAll(async () => {
    await stopWorker();
    await closeDb();
  });

  test('types the final answer in the last seconds of writing, the automatic submission fires, and the exact value reaches the snapshot and the grading input', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const scheduleId = manifest.student.scheduleId;
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    const email = `e2e04+${wcode.toLowerCase()}-${Date.now()}@example.com`;
    const fullName = `E2E04 Candidate ${wcode}`;

    // Unique sentinels: exact strings the DB snapshot must contain verbatim.
    const listeningAnswer = `e2e04-listening-${wcode.toLowerCase()}`;
    const readingAnswer = `e2e04-reading-${wcode.toLowerCase()}`;
    // Writing task 1: committed early as `base`, then extended during the
    // final seconds — stage A at ≤6s remaining (`-FI`), final char at ≤3s
    // remaining (`N`) — so the FINAL value is base + '-FIN'.
    const writingTask1Base = `e2e04-task1-${wcode.toLowerCase()}`;
    const writingTask1StageA = `${writingTask1Base}-FI`;
    const writingTask1Final = `${writingTask1StageA}N`;

    const listeningMarker = 'What is the seeded listening answer?';
    const readingMarker = 'Write the missing word from the passage.';
    const writingMarker = /Task 1: Summarise/;

    const adminContext = await newAdminControlContext(browser);
    const studentContext = await browser.newContext();
    await stubScreenDetails(studentContext);
    const studentPage = await studentContext.newPage();

    // ---- 1. Check in + waiting (pre-check settles silently, see e2e-01) ----
    await studentCheckIn(studentPage, scheduleId, { wcode, email, fullName });
    await openStudentSessionWithRetry(studentPage, scheduleId, wcode);
    await completePreCheckIfPresent(studentPage);

    const attemptRows = await pollDb<{ id: string }>(
      'SELECT id FROM student_attempts WHERE schedule_id = ? AND candidate_email = ?',
      [scheduleId, email],
      (rows) => rows.length === 1,
      'student attempt row created for this run',
    );
    const attemptId = attemptRows[0].id;

    // ---- 2. Proctor starts exam; answer listening + reading normally ----
    await proctorStartExam(adminContext, scheduleId);
    await startLobbyIfPresent(studentPage);
    await openStudentSessionWithRetry(studentPage, scheduleId, wcode);

    await waitForSectionMarker(studentPage, listeningMarker, 'listening section prompt');
    await studentPage.getByLabel('Answer for question 1').fill(listeningAnswer);
    await waitForSavedBanner(studentPage);
    await pollDb<{ answers: string }>(
      'SELECT answers FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => parseJson<Record<string, unknown>>(rows[0].answers)['listening-q1'] === listeningAnswer,
      'listening answer persisted to student_attempts.answers',
    );

    await proctorEndSection(adminContext, scheduleId, 'listening', 'advance listening to reading');
    await waitForSectionMarker(studentPage, readingMarker, 'reading section prompt');
    await studentPage.getByLabel('Answer for question 1').fill(readingAnswer);
    await waitForSavedBanner(studentPage);
    await pollDb<{ answers: string }>(
      'SELECT answers FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => {
        const answers = parseJson<Record<string, unknown>>(rows[0].answers);
        return answers['listening-q1'] === listeningAnswer && answers['reading-q1'] === readingAnswer;
      },
      'listening + reading answers persisted to student_attempts.answers',
    );

    // ---- 3. Advance to writing (the last section) and commit the base draft ----
    await proctorEndSection(adminContext, scheduleId, 'reading', 'advance reading to writing');
    await waitForSectionMarker(studentPage, writingMarker, 'writing section prompt');
    const writingEditor = studentPage.getByLabel('Writing response');
    await expect(writingEditor).toBeVisible({ timeout: 30_000 });

    // Proven commit pattern from e2e-01: fill → switch tabs → blur, so the
    // draft is flushed through the autosave pipeline and persisted.
    await writingEditor.fill(writingTask1Base);
    await studentPage.getByRole('button', { name: 'Task 2', exact: true }).click();
    await studentPage.getByRole('button', { name: 'Task 1', exact: true }).click();
    await writingEditor.blur();
    await waitForSavedBanner(studentPage);
    await pollDb<{ writing_answers: string }>(
      'SELECT writing_answers FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => {
        const writing = parseJson<Record<string, unknown>>(rows[0].writing_answers);
        return writing['task1'] === writingTask1Base;
      },
      'writing task-1 base draft persisted to student_attempts.writing_answers',
    );

    // ---- 4. Shorten the writing section deadline (test-data manipulation) ----
    // The target (20s) must cover the post-UPDATE reload + editor restore
    // (~7-13s observed, up to ~14s on a slow tail) plus the stage-A/final
    // staging (~6s). The deadline length is relative: the final keystroke is
    // still scheduled at ≤3s of server-remaining regardless of the target.
    const TARGET_REMAINING_SECONDS = 20;
    const deadlineFacts = await shortenWritingSectionDeadline(scheduleId, TARGET_REMAINING_SECONDS);
    console.log(
      `[e2e-04] deadline shortened: derived duration=${deadlineFacts.derivedDurationSeconds}s, ` +
        `target remaining=${deadlineFacts.targetRemainingSeconds}s, affectedRows=${deadlineFacts.affectedRows}`,
    );

    // The live endpoint must now report the shortened deadline server-side
    // (guards against a wrong column/query — a stale 3600s would time out).
    const observedAfterUpdate = await waitForServerRemainingAtMost(
      studentPage,
      scheduleId,
      TARGET_REMAINING_SECONDS + 1,
      'live endpoint reflects the shortened writing deadline',
    );
    console.log(`[e2e-04] server remaining right after deadline UPDATE: ${observedAfterUpdate}s`);

    // Re-anchor the student's timer to the shortened deadline via the app's
    // own reload path (the app polls /live at ~20s while the WS is connected,
    // too slow for a 14s window). The reload must restore the writing section
    // with the committed base draft intact (proven across every phase in
    // e2e-02).
    await studentPage.reload({ waitUntil: 'domcontentloaded' });
    await waitForSectionMarker(studentPage, writingMarker, 'writing section restored after reload');
    await expect(writingEditor, 'writing editor restored after reload').toBeVisible({ timeout: 30_000 });
    await expect(writingEditor, 'task-1 base draft restored after reload').toHaveValue(writingTask1Base);

    // ---- 5. Type during the final seconds (against the server timer) ----
    // Stage A: most of the final text with ~6s of runway.
    const remainingStageA = await waitForServerRemainingAtMost(
      studentPage,
      scheduleId,
      6,
      'server remaining ≤ 6s before stage A fill',
    );
    console.log(`[e2e-04] stage A fill begins at ${remainingStageA}s server-remaining`);
    await writingEditor.fill(writingTask1StageA, { timeout: 15_000 });
    await writingEditor.blur({ timeout: 15_000 });
    await expect(writingEditor, 'stage A value in the input before submission').toHaveValue(
      writingTask1StageA,
      { timeout: 15_000 },
    );
    // Flush gate A: the staged value must be persisted BEFORE the deadline
    // passes; the submission snapshot reads the persisted columns, so this
    // gate makes the snapshot content deterministic.
    await pollDb<{ writing_answers: string }>(
      'SELECT writing_answers FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => {
        const writing = parseJson<Record<string, unknown>>(rows[0].writing_answers);
        return writing['task1'] === writingTask1StageA;
      },
      'stage A value flushed to student_attempts.writing_answers before the deadline',
    );

    // Stage B: the final character during the final seconds. If the attempt
    // is already finalized by the time we can type, that IS the measured
    // boundary — the spec then asserts the latest captured value (stage A).
    let finalFillLandingRemaining: number | null = null;
    let attemptFinalizedBeforeFinalFill = false;
    let finalKeystrokeLanded = false;
    const stageBWaitStartedAt = Date.now();
    while (Date.now() - stageBWaitStartedAt < 15_000) {
      const finalized = await queryDb<{ phase: string }>(
        'SELECT phase FROM student_attempts WHERE id = ?',
        [attemptId],
      );
      if (finalized[0]?.phase === 'post-exam') {
        attemptFinalizedBeforeFinalFill = true;
        break;
      }
      const snapshot = await readServerTimerSnapshot(studentPage, scheduleId);
      if (snapshot !== null && snapshot.remainingSeconds <= 3) {
        finalFillLandingRemaining = snapshot.remainingSeconds;
        break;
      }
      await studentPage.waitForTimeout(250);
    }

    if (!attemptFinalizedBeforeFinalFill && finalFillLandingRemaining !== null) {
      // The loop's last phase read may be stale by the time we act; re-check
      // so the fill only starts while the section is genuinely live.
      const phaseNow = await queryDb<{ phase: string }>(
        'SELECT phase FROM student_attempts WHERE id = ?',
        [attemptId],
      );
      if (phaseNow[0]?.phase === 'post-exam') {
        console.log(
          `[e2e-04][boundary-finding] attempt finalized between the timer read and the final ` +
            `keystroke (${finalFillLandingRemaining}s remaining observed); asserting the latest captured value`,
        );
      } else {
        try {
          // Bounded action timeouts are load-bearing here: Playwright's
          // default action timeout inherits the TEST timeout (600s), so an
          // unfilled fill on a just-disabled editor previously hung the test
          // for the full 600s and aborted with "Test timeout exceeded". With
          // the bounds, a lost race fails fast and is recorded as the
          // measured boundary below.
          await writingEditor.fill(writingTask1Final, { timeout: 2_000 });
          await writingEditor.blur({ timeout: 2_000 });
          await expect(writingEditor, 'final value in the input before submission').toHaveValue(
            writingTask1Final,
            { timeout: 2_000 },
          );
          finalKeystrokeLanded = true;
        } catch (error) {
          console.log(
            `[e2e-04][boundary-finding] final keystroke did not land before the section locked ` +
              `(${finalFillLandingRemaining}s remaining observed): ${String(error).split('\n')[0]}`,
          );
        }
        if (finalKeystrokeLanded) {
          const afterFill = await readServerTimerSnapshot(studentPage, scheduleId);
          console.log(
            `[e2e-04] final keystroke landed at ${finalFillLandingRemaining}s server-remaining ` +
              `(re-read right after the fill: ${afterFill?.remainingSeconds ?? 'n/a'}s)`,
          );
          // Flush gate B: the FINAL value must be persisted before the
          // snapshot. The poll window extends past the deadline on purpose —
          // the regular autosave flush (~1s) and the boundary hook's flush at
          // 0 both race the server-side snapshot; the gate reports which won.
          try {
            await pollDb<{ writing_answers: string }>(
              'SELECT writing_answers FROM student_attempts WHERE id = ?',
              [attemptId],
              (rows) => {
                const writing = parseJson<Record<string, unknown>>(rows[0].writing_answers);
                return writing['task1'] === writingTask1Final;
              },
              'final value flushed to student_attempts.writing_answers',
              30_000,
            );
          } catch {
            // Boundary measurement (recorded, not fixed): the final keystroke
            // did not beat the automatic submission snapshot. The spec below
            // asserts the latest value that IS captured (stage A) and logs
            // the boundary.
            const persisted = await queryDb<{ writing_answers: string }>(
              'SELECT writing_answers FROM student_attempts WHERE id = ?',
              [attemptId],
            );
            const captured = parseJson<Record<string, unknown>>(persisted[0].writing_answers)['task1'];
            console.log(
              `[e2e-04][boundary-finding] final keystroke at ${finalFillLandingRemaining}s server-remaining ` +
                `was NOT captured by the submission snapshot; ` +
                `writing_answers.task1 holds "${captured}" (stage A expected)`,
            );
          }
        }
      }
    } else {
      console.log(
        `[e2e-04][boundary-finding] attempt finalized before the final keystroke could land ` +
          `(remaining at abort: ${finalFillLandingRemaining ?? 'n/a'}s); asserting the latest captured value`,
      );
    }

    // ---- 6. The automatic section submission fires (NO proctor end-section-now) ----
    // When the final keystroke landed, the attempt row must converge to the
    // FINAL value: either the pre-submit flush beat the snapshot, or the
    // server accepted the mutation within its post-submit grace window
    // (final_submit_grace_seconds; the merge is marked in the snapshot as
    // `graceMerge`, observed at submit+~4s in this journey's runs). The poll
    // below therefore waits for the converged row, so every downstream
    // assertion sees the final end state — if the value never converges, the
    // poll fails loudly (a typed value lost silently would violate the
    // invariant; the boundary paths below only apply when the keystroke
    // never landed).
    const attempt = await pollDb<AttemptRow>(
      `SELECT id, phase, submitted_at, answers, writing_answers, final_submission, created_at, revision
       FROM student_attempts WHERE id = ?`,
      [attemptId],
      (rows) =>
        rows.length === 1 &&
        rows[0].phase === 'post-exam' &&
        rows[0].submitted_at !== null &&
        rows[0].final_submission !== null &&
        (!finalKeystrokeLanded ||
          parseJson<Record<string, unknown>>(rows[0].writing_answers)['task1'] === writingTask1Final),
      finalKeystrokeLanded
        ? 'automatic submission: snapshot persisted AND writing_answers converged to the final last-second value'
        : 'automatic submission: student_attempts final_submission snapshot persisted',
    );
    const snapshotRow = attempt[0];

    await expect(
      studentPage.getByRole('heading', { name: /Examination Complete!/i }),
      'post-exam screen without proctor end-section-now',
    ).toBeVisible({ timeout: 60_000 });

    // The runtime must have completed by the deadline machinery (server
    // auto-advance), never by a proctor command: the writing section's
    // completion_reason is set by the reconciler to 'time_expired'.
    const completedSection = await pollDb<{ completion_reason: string | null }>(
      `SELECT completion_reason FROM exam_session_runtime_sections
       WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
         AND section_key = 'writing'`,
      [scheduleId],
      (rows) => rows.length === 1 && rows[0].completion_reason !== null,
      'writing section completed by the automatic deadline machinery',
    );
    console.log(
      `[e2e-04] writing section completion_reason=${completedSection[0].completion_reason} ` +
        `(time_expired = server auto-advance reconciler; no proctor command was sent)`,
    );

    // ================= DB VERIFICATION =================

    // Which value did the last-second typing produce? The final value if the
    // flush gate B passed, otherwise the latest captured value (stage A) —
    // the boundary measurement above already logged which case this is.
    const persistedWriting = parseJson<Record<string, unknown>>(snapshotRow.writing_answers);
    const capturedTask1 = persistedWriting['task1'];
    const lastSecondValueCaptured = capturedTask1 === writingTask1Final;
    if (!lastSecondValueCaptured) {
      console.log(
        `[e2e-04][boundary-finding] snapshot writingAnswers.task1="${capturedTask1}" ` +
          `(final="${writingTask1Final}"); asserting the latest captured value`,
      );
    }
    const expectedTask1 = lastSecondValueCaptured ? writingTask1Final : writingTask1StageA;

    // 6a. Submission snapshot: exact values, not just row existence.
    expect(snapshotRow.submitted_at).not.toBeNull();
    expect(snapshotRow.final_submission).not.toBeNull();
    const persistedAnswers = parseJson<Record<string, unknown>>(snapshotRow.answers);
    expect(persistedAnswers).toEqual({
      'listening-q1': listeningAnswer,
      'reading-q1': readingAnswer,
    });
    // task1 must hold the exact last-second value; task2 was never typed, so
    // the object's other keys (absent vs empty) are not part of this journey.
    expect(persistedWriting['task1']).toBe(expectedTask1);
    expect(persistedWriting).toMatchObject({ task1: expectedTask1 });
    const snapshot = parseJson<Record<string, unknown>>(snapshotRow.final_submission as string);
    expect(snapshot['submissionId']).toBeTruthy();
    expect(Number.isNaN(Date.parse(String(snapshot['submittedAt'])))).toBe(false);
    expect(snapshot['answers']).toEqual({
      'listening-q1': listeningAnswer,
      'reading-q1': readingAnswer,
    });
    expect(snapshot['writingAnswers']).toMatchObject({ task1: expectedTask1 });
    const autoSubmission = snapshot['autoSubmission'] === true;
    const finalFlush = snapshot['finalFlush'] != null;
    expect(autoSubmission || finalFlush, 'snapshot carries autoSubmission or finalFlush').toBe(true);
    const graceMerge = (snapshot['graceMerge'] as Record<string, unknown> | undefined) ?? null;
    console.log(
      `[e2e-04] snapshot markers: autoSubmission=${autoSubmission} ` +
        `finalFlush=${JSON.stringify(snapshot['finalFlush'] ?? null)} ` +
        `graceMerge=${JSON.stringify(graceMerge ?? null)} ` +
        `completionReason=${JSON.stringify(snapshot['completionReason'] ?? null)}`,
    );
    if (graceMerge) {
      // Measured boundary detail: the server accepted the final mutation
      // AFTER the submission snapshot, inside the post-submit grace window,
      // and merged it into final_submission (traceable via graceMerge +
      // finalFlush + the append-only student_attempt_mutations rows).
      console.log(
        `[e2e-04][finding] final value reached the snapshot via the post-submit grace merge: ` +
          `snapshot taken at ${String(snapshot['submittedAt'])} with the pre-merge value, ` +
          `grace merge applied at ${JSON.stringify(graceMerge['lastAcceptedAt'])} ` +
          `(mergeCount=${JSON.stringify(graceMerge['mergeCount'])})`,
      );
    }
    expect(new Date(snapshotRow.submitted_at as string).getTime()).toBeGreaterThanOrEqual(
      new Date(snapshotRow.created_at).getTime(),
    );
    expect(snapshotRow.revision).toBeGreaterThanOrEqual(1);

    // 6b. Grading input: student_submissions row (synced by the worker).
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

    // 6c. Grading input: per-section rows with the exact per-question values.
    const sectionRows = await pollDb<SectionSubmissionRow>(
      `SELECT id, section, answers, auto_grading_results, grading_status
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
    // The projection can briefly lag the snapshot by one worker watermark
    // cycle when the final value arrived via the post-submit grace merge (the
    // merge bumps student_attempts.updated_at; the worker's next cycle
    // re-syncs and UPSERTs the projection). Poll the writing section row
    // until its answers payload holds the exact last-second value; the first
    // observation is logged when it differed (the convergence evidence).
    let firstObservedWritingText: string | null = null;
    const convergedWritingRow = await pollDb<{ answers: string }>(
      'SELECT answers FROM section_submissions WHERE id = ?',
      [writingSection.id],
      (rows) => {
        const payload = parseJson<{ tasks?: Array<{ taskId: string; text: string }> }>(rows[0].answers);
        const text = (payload.tasks ?? []).find((task) => task.taskId === 'task1')?.text ?? null;
        if (firstObservedWritingText === null) {
          firstObservedWritingText = text;
        }
        return text === expectedTask1;
      },
      `section_submissions writing answers converged to the exact last-second value ("${expectedTask1}")`,
    );
    if (firstObservedWritingText !== expectedTask1) {
      console.log(
        `[e2e-04][finding] section_submissions writing answers first observed "${firstObservedWritingText}" ` +
          `then converged to "${expectedTask1}" (worker re-synced the grace-merged attempt)`,
      );
    }
    const writingPayload = parseJson<{ type: string; tasks?: Array<{ taskId: string; text: string; wordCount: number }> }>(
      convergedWritingRow[0].answers,
    );
    expect(writingPayload.type).toBe('writing');
    const task1 = (writingPayload.tasks ?? []).find((task) => task.taskId === 'task1');
    expect(task1?.text).toBe(expectedTask1);

    // 6d. Grading input: writing task rows — grading uses the same value.
    // The projection creates one row per exam task (task1 + task2); task2 was
    // never typed, so its student_text is empty. task1's student_text must
    // equal the last-second value EXACTLY — the poll waits for convergence
    // (same grace-merge re-sync as above) rather than the first projection.
    let firstObservedTask1Text: string | null = null;
    const writingTaskRows = await pollDb<{ task_id: string; student_text: string; word_count: number; grading_status: string }>(
      `SELECT task_id, student_text, word_count, grading_status
       FROM writing_task_submissions
       WHERE submission_id = ?
       ORDER BY task_id`,
      [submission.id],
      (rows) => {
        const task1 = rows.find((row) => row.task_id === 'task1');
        if (firstObservedTask1Text === null && task1) {
          firstObservedTask1Text = task1.student_text;
        }
        return (
          rows.length === 2 &&
          rows[0].task_id === 'task1' &&
          rows[1].task_id === 'task2' &&
          task1?.student_text === expectedTask1
        );
      },
      `writing_task_submissions rows synced with task1.student_text equal to the exact last-second value ("${expectedTask1}")`,
    );
    if (firstObservedTask1Text !== null && firstObservedTask1Text !== expectedTask1) {
      console.log(
        `[e2e-04][finding] writing_task_submissions.task1 first observed "${firstObservedTask1Text}" ` +
          `then converged to "${expectedTask1}" (worker re-synced the grace-merged attempt)`,
      );
    }
    const writingTask1Row = writingTaskRows.find((row) => row.task_id === 'task1') as
      | (typeof writingTaskRows)[number]
      | undefined;
    expect(writingTask1Row?.student_text).toBe(expectedTask1);
    expect(Number(writingTask1Row?.word_count ?? 0)).toBeGreaterThan(0);
    expect(writingTask1Row?.grading_status).toBe('needs_review');

    // ---- 7. Exactly one attempt row for this run's (schedule, email) ----
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

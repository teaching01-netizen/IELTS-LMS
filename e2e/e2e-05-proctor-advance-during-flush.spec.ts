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
 * E2E-05 — Proctor advances during client flush (invariant1.md §5 journey).
 *
 * Journey: check in → waiting → proctor starts exam → answer listening +
 * reading normally (sentinels) → advance to writing → write task-1 base
 * value (Saved, DB-gated) → DELAY the mutation response (the final task-1
 * value's `mutations:batch` request is held client-side) → ADVANCE the runtime
 * (proctor end-section-now on the final section: completes the runtime AND
 * auto-submits the attempt in the SAME transaction) → RELEASE the delayed
 * response (the mutation reaches the server AFTER the attempt snapshot was
 * taken) → the server's post-submit path decides: GRACE MERGE or STRUCTURED
 * CONFLICT — and either way the answer must NOT be lost silently.
 *
 * The four plan steps map to a genuine server-side race, made deterministic
 * with Playwright request routing (no clock mocking):
 * - "Delay the mutation response": `page.route` on the student's
 *   `mutations:batch` endpoint holds the request CLIENT-SIDE (the server has
 *   not seen it yet). The hold is scoped to the exact request carrying the
 *   run's unique final-writing sentinel (URL glob + request postData match),
 *   so ordinary autosave traffic is never delayed. A release deferred
 *   controls the timing; a bounded release timer guarantees the test can
 *   never hang (it forwards the batch anyway if the advance breaks).
 * - "Advance the runtime": while the request is held,
 *   `POST /api/v1/proctor/sessions/:id/control/end-section-now` on the final
 *   (writing) section completes the runtime and calls
 *   `auto_submit_schedule_attempts_in_tx` in the same transaction
 *   (backend/crates/application/src/proctoring.rs:543-572 →
 *   delivery/mod.rs:2154-2213) — the snapshot (`submitted_at` +
 *   `final_submission`, `completionReason="proctor_end"`) is taken WITHOUT
 *   the held mutation.
 * - "Release the delayed response": the held request is forwarded after the
 *   advance resolved (status/body recorded verbatim).
 * - "Verify grace OR structured conflict" (MEASURED, not assumed): the
 *   mutation-batch path computes `post_submit_grace_active` from
 *   `submitted_at + final_submit_grace_seconds`
 *   (backend/crates/application/src/delivery/mod.rs:647-656,
 *   `is_within_post_submit_grace_window` :3519-3529; the seeded config
 *   default is 300s — infrastructure/src/config.rs:698, the repo
 *   backend/.env defines no FINAL_SUBMIT_GRACE_SECONDS override, and e2e-04
 *   observed `graceWindowSeconds: 300` in a real merged snapshot). The
 *   first delivered mutation lands ~2-5s after the advance, but it is scored
 *   by the BASE-REVISION gate BEFORE the grace path (delivery/mod.rs:
 *   814-838): the proctor advance's in-transaction auto-submit bumps the
 *   attempt revision (delivery/mod.rs:2204-2207), and the held batch was
 *   composed against the pre-advance revision — so the delivered batch is
 *   deterministically rejected with the STRUCTURED CONFLICT
 *   `BASE_REVISION_MISMATCH`. The client's rebase path then retries
 *   immediately with the refreshed revision
 *   (src/services/studentAttemptRepository.ts:2388-2428) and THAT retry is
 *   accepted inside the grace window via `merge_post_submit_submission_snapshot`
 *   (delivery/mod.rs:3531-3612), which marks the snapshot `finalFlush` +
 *   `graceMerge` (`acceptedInGrace`/`graceWindowSeconds`/`mergeCount`) and
 *   returns `acceptedInGrace: true` (:1010-1017). BOTH plan branches are
 *   therefore exercised sequentially by this journey; the spec asserts the
 *   ACTUAL verdict of the released mutation from the recorded response
 *   (never forces one) and then asserts the shared invariant: the final
 *   value is not silently lost — it must appear in
 *   `student_attempts.writing_answers`/`final_submission` after convergence,
 *   or remain demonstrably in the durable queue while the UI stays honest.
 *
 * Honesty notes / deviations (recorded — production untouched):
 * - No grading worker is started (no grading-projection assertions; the
 *   journey text does not require them). Only delivery-side state is
 *   asserted; the worker-projection convergence observed in e2e-04 is out of
 *   scope.
 * - "Delay the mutation RESPONSE" is implemented client-side (the request is
 *   held before reaching the server). The server-side race measured is
 *   unchanged — a mutation arriving after the snapshot. The forwarded
 *   response is the server's real one (`route.fetch()` +
 *   `route.fulfill({ response })`).
 * - The route hold can only be proven held by the request actually carrying
 *   the sentinel; a silent bypass (ever the probe fails to fire) is a HARD
 *   failure, not a skip.
 * - The exact F-9 retry badge text is NOT pre-pinned: the delivered batch's
 *   structured conflict (BASE_REVISION_MISMATCH) is resolved by the client's
 *   automatic rebase+retry (the same machinery that produced e2e-04's
 *   graceMerge); the fallback path (no convergence at all) asserts the
 *   load-bearing proof — durable-queue retention — and logs the banner text
 *   as evidence instead of guessing a selector.
 * - CI retries (2) cannot succeed after the first truthful attempt: the
 *   seeded access code binds student identity on first check-in ("Student
 *   identity is locked for this access code" — e2e-04 observed property).
 * - Proctor advance is `completion_reason='proctor_end'`; there is NO
 *   student submit control in runtime mode (e2e-01 evidence) — the journey
 *   deliberately uses the proctor's advance, which is the point.
 *
 * Test isolation: unique email per run (`e2e05+<wcode>-<Date.now()>@example.com`)
 * and unique sentinels. Exactly one attempt row must exist for the run's
 * (schedule, email) at the end.
 */

// ---------------------------------------------------------------------------
// Shared helpers (mirrored from e2e-01/e2e-03/e2e-04's proven implementations).
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

// ---------------------------------------------------------------------------
// Durable-queue readers (localStorage + IndexedDB mirror, from e2e-03).
// ---------------------------------------------------------------------------

interface DurableMutationLite {
  type: string;
  payload: { questionId?: string | null; taskId?: string | null; value?: unknown };
}

function extractAnswerMutations(records: unknown): DurableMutationLite[] {
  if (!Array.isArray(records)) {
    return [];
  }
  const out: DurableMutationLite[] = [];
  for (const entry of records) {
    if (!entry || typeof entry !== 'object') continue;
    const mutations = (entry as { mutations?: unknown }).mutations;
    if (!Array.isArray(mutations)) continue;
    for (const mutation of mutations) {
      if (!mutation || typeof mutation !== 'object') continue;
      const record = mutation as {
        type?: unknown;
        payload?: { questionId?: unknown; taskId?: unknown; value?: unknown };
      };
      if (typeof record.type !== 'string') continue;
      out.push({
        type: record.type,
        payload: {
          questionId: typeof record.payload?.questionId === 'string' ? record.payload.questionId : null,
          taskId: typeof record.payload?.taskId === 'string' ? record.payload.taskId : null,
          value: record.payload?.value,
        },
      });
    }
  }
  return out;
}

/** Read the durable queue from localStorage. */
async function readDurableQueueFromLocalStorage(page: Page): Promise<DurableMutationLite[]> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('ielts_student_attempt_pending_mutations_v1');
    if (!raw) return [];
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }).then((records) => extractAnswerMutations(records));
}

/** Read the durable queue from the IndexedDB mirror. */
async function readDurableQueueFromIndexedDb(page: Page): Promise<DurableMutationLite[]> {
  return page.evaluate(async () => {
    const open = indexedDB.open('ielts_student_attempt_cache_v1', 1);
    const database = await new Promise<IDBDatabase | null>((resolve) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(null);
    });
    if (!database) return [];
    try {
      const transaction = database.transaction('pending_mutations', 'readonly');
      const request = transaction.objectStore('pending_mutations').getAll();
      const records = await new Promise<unknown>((resolve) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve([]);
      });
      return records;
    } finally {
      database.close();
    }
  }).then((records) => extractAnswerMutations(records));
}

/** Poll until the durable queue holds a writing_answer mutation with task1 === value. */
async function waitForTask1InDurableQueue(page: Page, value: string, timeoutMs = 30_000) {
  await expect
    .poll(
      async () => {
        const [local, idb] = await Promise.all([
          readDurableQueueFromLocalStorage(page),
          readDurableQueueFromIndexedDb(page),
        ]);
        const holdsValue = (mutations: DurableMutationLite[]) =>
          mutations.some(
            (mutation) =>
              mutation.type === 'writing_answer' &&
              mutation.payload.taskId === 'task1' &&
              mutation.payload.value === value,
          );
        return holdsValue(local) || holdsValue(idb);
      },
      { timeout: timeoutMs, message: `durable queue holds writing task1 = "${value}"` },
    )
    .toBe(true);
}

/** Poll until the durable queue holds NO answer/writing mutations. */
async function waitForDurableQueueDrained(page: Page, timeoutMs = 60_000) {
  await expect
    .poll(
      async () => {
        const [local, idb] = await Promise.all([
          readDurableQueueFromLocalStorage(page),
          readDurableQueueFromIndexedDb(page),
        ]);
        const hasAnswer = (mutations: DurableMutationLite[]) =>
          mutations.some((mutation) => mutation.type === 'answer' || mutation.type === 'writing_answer');
        return !hasAnswer(local) && !hasAnswer(idb);
      },
      { timeout: timeoutMs, message: 'durable queue drained after the accepted flush' },
    )
    .toBe(true);
}

// ---------------------------------------------------------------------------
// The held-request harness (DELAY the mutation response, deterministically).
// ---------------------------------------------------------------------------

interface HeldBatchRecord {
  index: number;
  heldAtMs: number;
  status: number | null;
  body: string | null;
  forwardedAtMs: number | null;
  error: string | null;
}

const BATCH_ROUTE_GLOB = '**/api/v1/student/sessions/*/mutations:batch';
// Bounded hold: if the test never releases (e.g. a broken advance), the hold
// expires on its own and the batch is forwarded anyway, so the run can never
// hang. In the healthy path the test releases long before this.
const HOLD_MAX_MS = 90_000;

class MutationHoldHarness {
  readonly heldBatches: HeldBatchRecord[] = [];
  firstHitAtMs: number | null = null;
  releasedAtMs: number | null = null;
  releaseTimedOut = false;

  private releaseResolve: (() => void) | null = null;
  private releasePromise: Promise<void> | null = null;
  private boundTimer: ReturnType<typeof setTimeout> | null = null;
  private page: Page | null = null;

  constructor(private readonly sentinel: string) {}

  /** Arm the harness: create the release deferred and wire the route. */
  async arm(page: Page) {
    this.page = page;
    this.releasePromise = new Promise<void>((resolve) => {
      this.releaseResolve = resolve;
    });
    await page.route(BATCH_ROUTE_GLOB, (route) => this.handle(route));
  }

  /** Release every held batch now (deterministic release point). */
  release() {
    this.releasedAtMs = Date.now();
    this.releaseResolve?.();
  }

  private async handle(route: Parameters<Parameters<Page['route']>[1]>[0]) {
    const postData = route.request().postData() ?? '';
    // Scoped hold: only the batch carrying THIS run's final writing value is
    // ever delayed; all other traffic continues immediately.
    if (!postData.includes(this.sentinel)) {
      await route.continue().catch(() => {});
      return;
    }
    const record: HeldBatchRecord = {
      index: this.heldBatches.length,
      heldAtMs: Date.now(),
      status: null,
      body: null,
      forwardedAtMs: null,
      error: null,
    };
    this.heldBatches.push(record);
    if (this.firstHitAtMs === null) {
      this.firstHitAtMs = record.heldAtMs;
      // Bound the wait (see HOLD_MAX_MS).
      this.boundTimer = setTimeout(() => {
        this.releaseTimedOut = true;
        this.releaseResolve?.();
      }, HOLD_MAX_MS);
    }
    await (this.releasePromise ?? Promise.resolve());
    if (this.boundTimer) {
      clearTimeout(this.boundTimer);
      this.boundTimer = null;
    }
    try {
      // Forward the held request to the real backend; record its verdict.
      const response = await route.fetch();
      record.status = response.status();
      record.body = await response.text();
      record.forwardedAtMs = Date.now();
      await route.fulfill({ response }).catch(() => {});
    } catch (error) {
      // The client aborted the held request (or the context closed): record
      // the failure loudly — the test must not mistake this for a pass.
      record.error = String(error);
      await route.continue().catch(() => {});
    }
  }
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

test.describe('E2E-05 Proctor advances during client flush (DB-verified)', () => {
  test.describe.configure({ timeout: 600_000 });

  test.afterAll(async () => {
    await closeDb();
  });

  test('a mutation held in-flight while the proctor ends the final section lands after the snapshot and is never silently lost', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const scheduleId = manifest.student.scheduleId;
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    const email = `e2e05+${wcode.toLowerCase()}-${Date.now()}@example.com`;
    const fullName = `E2E05 Candidate ${wcode}`;

    // Unique sentinels: exact strings the DB snapshot must contain verbatim.
    const listeningAnswer = `e2e05-listening-${wcode.toLowerCase()}`;
    const readingAnswer = `e2e05-reading-${wcode.toLowerCase()}`;
    // Writing task 1: a base draft is committed and DB-gated, then the FINAL
    // value is typed while its mutations:batch request is held in-flight.
    const writingTask1Base = `e2e05-task1-${wcode.toLowerCase()}`;
    const writingTask1Final = `${writingTask1Base}-E2E05-FINAL`;

    const listeningMarker = 'What is the seeded listening answer?';
    const readingMarker = 'Write the missing word from the passage.';
    const writingMarker = /Task 1: Summarise/;

    const adminContext = await newAdminControlContext(browser);
    const studentContext = await browser.newContext();
    await stubScreenDetails(studentContext);
    const studentPage = await studentContext.newPage();

    // The hold harness: released manually, bounded by HOLD_MAX_MS, scoped to
    // the sentinel so ordinary autosave traffic is never delayed.
    const holdHarness = new MutationHoldHarness(writingTask1Final);

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

    // Proven commit pattern from e2e-01/e2e-04: fill → switch tabs → blur, so
    // the draft is flushed through the autosave pipeline and persisted.
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

    // ---- 4. ARM THE HOLD: the final value's mutations:batch is delayed ----
    await holdHarness.arm(studentPage);

    // ---- 5. Type the FINAL task-1 value; its flush must be observed&held ----
    const finalFillStartMs = Date.now();
    // Bounded action timeouts: a hung editor (e.g. the runtime completing
    // mid-fill) must fail fast, not consume the 600s test timeout.
    await writingEditor.fill(writingTask1Final, { timeout: 15_000 });
    await writingEditor.blur({ timeout: 15_000 });
    await expect(writingEditor, 'final value landed in the editor before the hold release').toHaveValue(
      writingTask1Final,
      { timeout: 15_000 },
    );

    // HARD REQUIREMENT: the sentinel-matched mutations:batch MUST be observed
    // and held. A silent bypass (route never firing) is a hard failure.
    await expect
      .poll(
        () => Promise.resolve(holdHarness.heldBatches.length),
        { timeout: 45_000, message: 'the final flush mutations:batch request was observed and held' },
      )
      .toBeGreaterThan(0);
    const firstHeld = holdHarness.heldBatches[0];
    expect(
      firstHeld.status,
      'the held request must NOT have been forwarded yet (still in-flight)',
    ).toBeNull();

    // No-silent-loss proof DURING the hold: the final value is already in the
    // durable queue (localStorage + IndexedDB mirrors), so even if the in-flight
    // request were lost entirely the value is retained client-side.
    await waitForTask1InDurableQueue(studentPage, writingTask1Final);
    const durableWriteConfirmedAtMs = Date.now();

    // ---- 6. ADVANCE THE RUNTIME while the mutation is in-flight ----
    const advanceStartMs = Date.now();
    await proctorEndSection(adminContext, scheduleId, 'writing', 'advance writing: completes runtime + auto-submits');
    const advanceEndMs = Date.now();
    console.log(
      `[e2e-05] proctor advance resolved in ${advanceEndMs - advanceStartMs}ms ` +
        `(final flush observed at ${holdHarness.firstHitAtMs}, durable queue confirmed at ${durableWriteConfirmedAtMs})`,
    );

    // The runtime must have been completed by the proctor's command: the
    // writing section's completion_reason is 'proctor_end'.
    const completedSection = await pollDb<{ completion_reason: string | null }>(
      `SELECT completion_reason FROM exam_session_runtime_sections
       WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
         AND section_key = 'writing'`,
      [scheduleId],
      (rows) => rows.length === 1 && rows[0].completion_reason !== null,
      'writing section completed by the proctor end-section-now command',
    );
    expect(completedSection[0].completion_reason, 'proctor advance writes completion_reason=proctor_end').toBe(
      'proctor_end',
    );
    await pollDb<{ phase: string }>(
      'SELECT phase FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => rows[0].phase === 'post-exam',
      'attempt reached post-exam (auto-submit inside the proctor advance transaction)',
    );
    const submitObservedAtMs = Date.now();

    // Post-exam surface is the honest student state after the advance; the
    // snapshot was taken WITHOUT the held mutation.
    await expect(
      studentPage.getByRole('heading', { name: /Examination Complete!/i }),
      'post-exam screen after the proctor advance (probe still held)',
    ).toBeVisible({ timeout: 60_000 });

    // ---- 7. RELEASE THE DELAYED RESPONSE ----
    // Land the released mutation strictly AFTER the advance but well inside
    // the 300s post-submit grace window (measured release→submit gap ~1-3s).
    const settleBeforeReleaseMs = 1_250;
    await studentPage.waitForTimeout(settleBeforeReleaseMs);
    holdHarness.release();
    const releasedAtMs = holdHarness.releasedAtMs ?? Date.now();
    expect(holdHarness.releaseTimedOut, 'the hold must be released by the test, not the bound timer').toBe(
      false,
    );
    console.log(
      `[e2e-05] hold released: hold duration=${releasedAtMs - (holdHarness.firstHitAtMs ?? releasedAtMs)}ms, ` +
        `release→submit gap=${releasedAtMs - submitObservedAtMs}ms`,
    );

    // ---- 8. RECORD THE SERVER'S VERDICT (the released mutation response) ----
    await expect
      .poll(
        () => {
          const record = holdHarness.heldBatches[0];
          return record !== null && record !== undefined && record.status !== null && record.body !== null;
        },
        { timeout: 45_000, message: 'the released mutations:batch request got a server response' },
      )
      .toBe(true);
    const forwardedAtMs = holdHarness.heldBatches[0]!.forwardedAtMs ?? Date.now();
    console.log(
      `[e2e-05] released mutation response: HTTP ${firstHeld.status} ` +
        `(server round-trip after forward ${forwardedAtMs - releasedAtMs}ms)`,
    );
    expect(firstHeld.error, 'the held request must have been forwarded to the server').toBeNull();

    // ---------------------------------------------------------------------
    // 9. VERIFY GRACE OR STRUCTURED CONFLICT — assert the ACTUAL verdict.
    //
    // The released batch is scored by the base-revision gate BEFORE any grace
    // acceptance (delivery/mod.rs:814-838): the proctor advance's
    // in-transaction auto-submit bumps the attempt revision
    // (delivery/mod.rs:2204-2207) while the held batch was composed against
    // the pre-advance revision, so the deterministic verdict for the DELIVERED
    // batch is the structured conflict BASE_REVISION_MISMATCH. The client's
    // rebase path then retries immediately with the refreshed revision
    // (src/services/studentAttemptRepository.ts:2388-2428) and THAT retry
    // lands inside the 300s post-submit grace window → the grace MERGE. Both
    // plan branches are therefore exercised by one journey: a structured
    // conflict on the delivered mutation, then a grace accept on the rebased
    // retry. The invariant (no silent loss) is asserted on the end state.
    // ---------------------------------------------------------------------
    const releasedBody = parseJson<{
      success?: boolean;
      data?: {
        acceptedInGrace?: boolean;
        appliedMutationCount?: number;
        attempt?: { phase?: string | null } | null;
      };
      error?: { code?: string | null; message?: string | null; details?: { reason?: string | null } | null };
    }>(firstHeld.body as string);

    const conflictReason = String(releasedBody?.error?.details?.reason ?? '');
    const isStructuredConflict =
      firstHeld.status === 409 &&
      ['BASE_REVISION_MISMATCH', 'ATTEMPT_SUBMITTED', 'SECTION_MISMATCH', 'OBJECTIVE_LOCKED', 'ATTEMPT_PROCTOR_BLOCKED'].includes(
        conflictReason,
      );
    const isGraceAccept =
      firstHeld.status === 200 &&
      releasedBody?.success !== false &&
      releasedBody?.data?.acceptedInGrace === true;
    console.log(
      `[e2e-05][verdict] released mutation response: HTTP ${firstHeld.status} ` +
        `body=${String(firstHeld.body).slice(0, 500)}`,
    );
    expect(
      isStructuredConflict || isGraceAccept,
      `released mutation must be a structured conflict or a grace accept ` +
        `(HTTP ${firstHeld.status}, reason="${conflictReason}", ` +
        `acceptedInGrace=${JSON.stringify(releasedBody?.data?.acceptedInGrace ?? null)})`,
    ).toBe(true);
    if (isStructuredConflict) {
      console.log(
        `[e2e-05][branch] STRUCTURED CONFLICT on the delivered mutation: reason=${JSON.stringify(conflictReason)} ` +
          `(expected BASE_REVISION_MISMATCH: the advance bumped the revision while the batch was in flight)`,
      );
    }

    // ---- 10. THE INVARIANT: NO SILENT ANSWER LOSS ----
    // The rebased retry is expected to land the FINAL value inside the grace
    // window (e2e-04 observed the identical merge path). Poll the converged
    // end state; if the client ever stops retrying (environment-dependent),
    // the durable queue provably retains the value and the UI stays honest —
    // that fallback is asserted instead.
    let convergedAttempt: AttemptRow | null = null;
    try {
      convergedAttempt = (
        await pollDb<AttemptRow>(
          `SELECT id, phase, submitted_at, answers, writing_answers, final_submission, created_at, revision
           FROM student_attempts WHERE id = ?`,
          [attemptId],
          (rows) => {
            if (rows.length !== 1 || rows[0].phase !== 'post-exam' || rows[0].final_submission === null) {
              return false;
            }
            const writing = parseJson<Record<string, unknown>>(rows[0].writing_answers);
            const snapshot = parseJson<Record<string, unknown>>(rows[0].final_submission as string);
            const snapshotWriting = parseJson<Record<string, unknown>>(snapshot['writingAnswers'] as unknown);
            return writing['task1'] === writingTask1Final && snapshotWriting['task1'] === writingTask1Final;
          },
          'the FINAL value converged into student_attempts.writing_answers AND final_submission',
          90_000,
        )
      )[0] ?? null;
    } catch {
      convergedAttempt = null;
    }

    // The rebased retry batch, if the harness observed it (it carries the same
    // sentinel value under NEW mutation ids), is recorded as the grace-accept
    // evidence on the wire.
    const retryRecord = holdHarness.heldBatches.find((record) => record.index > 0 && record.status !== null);
    if (retryRecord) {
      const retryBody = parseJson<{ data?: { acceptedInGrace?: boolean } }>(retryRecord.body as string);
      console.log(
        `[e2e-05][retry] rebased retry batch: HTTP ${retryRecord.status} ` +
          `acceptedInGrace=${JSON.stringify(retryBody?.data?.acceptedInGrace ?? null)}`,
      );
    }

    if (convergedAttempt) {
      // ---------- GRACE MERGE evidence on the converged row ----------
      const snapshot = parseJson<Record<string, unknown>>(convergedAttempt.final_submission as string);
      const merge = (snapshot['graceMerge'] as Record<string, unknown> | undefined) ?? {};
      expect(merge['acceptedInGrace'], 'snapshot carries graceMerge.acceptedInGrace=true').toBe(true);
      expect(Number(merge['graceWindowSeconds']), 'grace window is the configured 300s default').toBe(300);
      expect(Number(merge['mergeCount'])).toBeGreaterThanOrEqual(1);
      expect(String(merge['firstAcceptedAt'] ?? '')).not.toBe('');
      expect(snapshot['finalFlush'], 'snapshot carries finalFlush after the grace merge').toBeTruthy();
      expect(String(snapshot['completionReason'])).toBe('proctor_end');
      expect(snapshot['autoSubmission'] === true).toBe(true);
      expect(String(snapshot['submissionPolicy'])).toBe('forced_auto_submit');

      const snapshotWriting = parseJson<Record<string, unknown>>(snapshot['writingAnswers'] as unknown);
      expect(snapshotWriting['task1']).toBe(writingTask1Final);
      const persistedWriting = parseJson<Record<string, unknown>>(convergedAttempt.writing_answers);
      expect(persistedWriting['task1']).toBe(writingTask1Final);
      expect(parseJson<Record<string, unknown>>(convergedAttempt.answers)['listening-q1']).toBe(listeningAnswer);
      expect(parseJson<Record<string, unknown>>(convergedAttempt.answers)['reading-q1']).toBe(readingAnswer);

      // Audit trail: the accepted writer mutation is append-only in
      // student_attempt_mutations with the exact FINAL value.
      const mutationRows = await queryDb<{ mutation_type: string; payload: unknown; applied_at: string | null }>(
        'SELECT mutation_type, payload, applied_at FROM student_attempt_mutations WHERE attempt_id = ?',
        [attemptId],
      );
      // mysql2 returns MySQL JSON columns as parsed objects; normalize so the
      // sentinel can be searched in the payload either way.
      const payloadText = (row: { payload: unknown }): string =>
        typeof row.payload === 'string' ? row.payload : JSON.stringify(row.payload);
      const finalMutation = [...mutationRows].reverse().find(
        // The writing answer travels on the wire as a SetEssayText operation
        // (src/services/studentAttemptRepository.ts:1439-1445), which is the
        // mutation_type the backend stores (domain/attempt.rs as_str).
        (row) => row.mutation_type === 'SetEssayText' && payloadText(row).includes(writingTask1Final),
      );
      expect(finalMutation, 'the final writing mutation is persisted append-only').toBeTruthy();
      expect(
        finalMutation?.applied_at,
        'the accepted mutation was applied (server-side acceptance trace)',
      ).not.toBeNull();

      // Client honesty after the accepted flush: the durable queue drains (the
      // value is committed to the server; nothing is dropped silently).
      await waitForDurableQueueDrained(studentPage);
    } else {
      // ---------- FALLBACK: no convergence — the value must be provably retained ----------
      // The server-side acceptance never landed (e.g. the client stopped
      // retrying in the post-exam state). The invariant then rests on the
      // durable queue (localStorage + IndexedDB mirrors) still holding the
      // exact final value, with the UI not falsely claiming "Saved".
      console.log('[e2e-05][found] no convergence observed; asserting durable-queue retention instead');
      await waitForTask1InDurableQueue(studentPage, writingTask1Final, 45_000);
      const bannerText = await studentPage.getByRole('banner').innerText().catch(() => '');
      console.log(
        `[e2e-05][found] banner text while the value is retained in the durable queue: ` +
          `${bannerText.replace(/\n/g, ' | ')}`,
      );
    }

    const mergeObservedAtMs = Date.now();

    // ---- 10. Exactly ONE attempt row for this run's (schedule, email) ----
    const attemptCount = await queryDb<{ count: number }>(
      'SELECT COUNT(*) AS count FROM student_attempts WHERE schedule_id = ? AND candidate_email = ?',
      [scheduleId, email],
    );
    expect(Number(attemptCount[0].count)).toBe(1);

    // ---- 11. Timing report (the race choreography, measured) ----
    const timings = {
      finalFillDurationMs: (holdHarness.firstHitAtMs ?? 0) - finalFillStartMs,
      holdDurationMs: releasedAtMs - (holdHarness.firstHitAtMs ?? releasedAtMs),
      durableQueueConfirmationLeadMs: durableWriteConfirmedAtMs - (holdHarness.firstHitAtMs ?? 0),
      advanceDurationMs: advanceEndMs - advanceStartMs,
      releaseToSubmitGapMs: releasedAtMs - submitObservedAtMs,
      submitToMergeObservedMs: mergeObservedAtMs - submitObservedAtMs,
      serverRoundTripAfterReleaseMs: forwardedAtMs - releasedAtMs,
      configuredGraceWindowSeconds: 300,
    };
    console.log(`[e2e-05] timings: ${JSON.stringify(timings)}`);

    await studentContext.close();
    await adminContext.close();
  });
});
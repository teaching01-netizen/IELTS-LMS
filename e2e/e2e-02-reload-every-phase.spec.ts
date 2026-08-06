import { expect, test, type Page } from '@playwright/test';
import { readBackendE2EManifest } from './support/backendE2e';
import {
  deterministicWcode,
  studentCheckIn,
  stubScreenDetails,
} from './support/studentUi';
import { closeDb, queryDb, type SqlParam } from './support/db';
import {
  newAdminControlContext,
  postProctorApi,
  proctorEndSection,
  proctorStartExam,
} from './support/proctorControls';

/**
 * E2E-02 — Reload during every phase (timer-fairness matrix).
 *
 * Journey: check in → briefing/pre-check → waiting → listening → reading →
 * writing → final submission → confirmed post-exam, with a hard reload
 * (`page.reload()`) at each of the 8 phases from the test plan plus the
 * journey's first active section. After every reload the spec asserts the
 * session continues correctly: same phase, answers typed before the reload
 * are intact (UI + `student_attempts` via the DB helper), no data loss, no
 * error screen.
 *
 * The timer-fairness invariant ("Timer fairness must not be bypassed by
 * reload/refresh") is asserted on two active phases (listening, the journey's
 * first live section, and reading): the student-visible remaining time is
 * captured before the reload and compared after it (small tolerance for
 * elapsed wall time), AND the server-authoritative remaining seconds
 * (`GET /api/v1/student/sessions/:id/live` → `data.runtime.
 * currentSectionRemainingSeconds`, computed server-side from the section
 * deadline) are compared before/after — the server value must never increase
 * across a reload.
 *
 * Phase deviations (recorded, NOT fixed — production untouched):
 * - "Briefing": the briefing screen was removed upstream (see e2e-01 header);
 *   the closest real state is the pre-check card rendered right after
 *   check-in ("Waiting for the exam to start" + "Preparing your connection…").
 *   The briefing reload fires immediately after check-in navigation, before
 *   the pre-check has persisted; after the reload the pre-check must re-run
 *   and re-persist idempotently (verified against `student_attempts.integrity`).
 * - "Waiting": the seeded runtime is already started by global-setup's seed
 *   (start_runtime is idempotent, 409 tolerated), so the waiting room is the
 *   pre-check/lobby card. The waiting reload fires as soon as the pre-check
 *   has persisted (the admission boundary — from then on the student is
 *   "waiting for the proctor"/live). Post-reload the app correctly skips
 *   straight to the live exam because the pre-check is persisted server-side.
 *   The load-bearing waiting assertions: no error surface, the attempt id is
 *   unchanged, and the runtime row (status, actual_start_at, section keys,
 *   revision) is byte-identical across the reload — a reload while waiting
 *   must neither start nor restart the exam timer.
 * - "Proctor pause": the brief's cohort command (`pause_runtime`) is rejected
 *   by exam policy on the seeded schedule — `progression.allowPause=false` in
 *   the seed config, and `SchedulingService::pause_runtime` refuses with
 *   `Validation("Cohort pause is disabled by exam policy.")` → HTTP 422. The
 *   spec probes this endpoint to record the exact response (deviation note),
 *   then drives the pause phase through the per-attempt proctor pause
 *   (`POST /api/v1/proctor/sessions/:scheduleId/attempts/:attemptId/pause`),
 *   which is the same blocking-overlay machinery the plan's pause phase
 *   targets ("Individual session paused").
 *
 *   CONTRACT FINDING → FIXED (this batch): the pause could not be rendered
 *   by the student UI at all. The server side was correct — the live
 *   endpoint advertises `attempt.proctorStatus: "paused"` to the student
 *   session and a WS "attempt" event is published — but
 *   `mapBackendStudentAttempt` (src/services/studentAttemptRepository.ts)
 *   hardcoded `proctorStatus: 'active'` / `proctorNote: null` /
 *   `proctorUpdatedAt: null` and no code path read `payload.proctorStatus`.
 *   Empirically: ~90s of continuous `/live` polling (1.5s→20s cadence, WS
 *   connected) with every response carrying `proctorStatus:"paused"` produced
 *   zero DOM change — no overlay, workspace stays enabled; the reload path
 *   used the same mapper, so the pause was not restored after reload either.
 *   The mapper now passes the server proctor state through (defaulting to
 *   the historical 'active'/null values when the payload omits the fields),
 *   so the blocking overlay renders in-page and is restored after reload.
 *   The pause section asserts the positive contract: overlay visible, answer
 *   field disabled, overlay restored across the reload, server pause
 *   persistence (proctor_status stays "paused" in `student_attempts`), no
 *   attempt duplication, no error surface, typed answers intact.
 *   Server-side integrity during the pause is separately enforced: answer
 *   mutations are gated with `DeliveryConflictReason::AttemptProctorBlocked`
 *   while the attempt is paused, so the persistence layer honors the pause.
 * - "Section transition": `end-section-now` advances the runtime atomically
 *   in one transaction (next section live in the same commit; the last
 *   section completes the runtime and auto-submits the attempt in-transaction
 *   — `auto_submit_schedule_attempts_in_tx`, no worker needed). There is no
 *   server-side gap window (`gap_after_minutes=0`, `waiting_for_next_section`
 *   stays false), so reloading mid-transition must land directly on the next
 *   section; the reload is fired immediately after the advance POST resolves
 *   (the client may not have applied the live update yet).
 * - "Final submission": reload fires immediately after the final
 *   `end-section-now`; the attempt is already submitted server-side, so the
 *   reload must land on the post-exam surface (never a stuck/error state)
 *   with the full answer set in `final_submission`.
 * - "Active reading" is exercised on the reading section; the journey's first
 *   active section is listening (seeded content order listening → reading →
 *   writing), so listening gets its own fairness reload as a documented extra
 *   beyond the plan's 8 phases.
 * - "Active writing" reload: the writing workspace is restored, but the active
 *   task tab follows the attempt's last server-persisted `currentQuestionId`
 *   (observed "Task 2" after answering both tasks), so the task-1 prompt is
 *   not necessarily visible after the reload. The spec therefore switches
 *   tabs explicitly and asserts each task's draft text verbatim
 *   (`toHaveValue` on the "Writing response" textarea), which is
 *   deterministic regardless of the restored tab.
 *
 * Test isolation: unique student email per run (`Date.now()` suffix — a CI
 * retry reuses the same seeded schedule, so a plain deterministic email would
 * collide with the failed run's attempt row) and unique answer sentinels per
 * run. Exactly one attempt row must exist for the run's (schedule, email) at
 * the end — reloads must never duplicate the attempt.
 */

// ---------------------------------------------------------------------------
// Small shared helpers (mirror e2e-01's proven implementations).
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
async function waitForSectionMarker(
  page: Page,
  marker: RegExp | string,
  label: string,
  timeoutMs = 60_000,
) {
  await expect(page.getByText(marker).first(), label).toBeVisible({ timeout: timeoutMs });
}

const ERROR_SURFACE_HEADINGS = ['Loading Error', 'Session expired', 'Wcode invalid', 'Exam Not Found'];

/** Coherent student surfaces, in check order (overlays before the exam they cover). */
const COHERENT_STATE_CHECKS: ReadonlyArray<readonly [string, (page: Page) => Promise<boolean>]> = [
  ['waiting', async (page) => page.getByRole('heading', { name: 'Waiting for the exam to start' }).isVisible().catch(() => false)],
  ['post-exam', async (page) => page.getByRole('heading', { name: /Examination Complete!/i }).isVisible().catch(() => false)],
  ['paused', async (page) => page.getByRole('heading', { name: 'Individual session paused' }).isVisible().catch(() => false)],
  ['cohort-paused', async (page) => page.getByRole('heading', { name: 'Cohort paused' }).isVisible().catch(() => false)],
  ['waiting-advance', async (page) => page.getByRole('heading', { name: 'Waiting for cohort advance' }).isVisible().catch(() => false)],
  ['waiting-runtime', async (page) => page.getByRole('heading', { name: 'Waiting for runtime' }).isVisible().catch(() => false)],
  ['exam', async (page) => page.getByLabel('Answer for question 1').first().isVisible().catch(() => false)],
  ['writing', async (page) => page.getByLabel('Writing response').first().isVisible().catch(() => false)],
];

/**
 * After a reload, wait until the student app settles on a coherent state.
 * Any error surface is a hard failure, not a state.
 */
async function waitForCoherentStudentState(page: Page, label: string, timeoutMs = 60_000): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const [name, check] of COHERENT_STATE_CHECKS) {
      if (await check(page)) {
        return name;
      }
    }
    for (const heading of ERROR_SURFACE_HEADINGS) {
      if (await page.getByRole('heading', { name: heading }).isVisible().catch(() => false)) {
        const bodyText = (await page.locator('body').innerText().catch(() => '')) || heading;
        throw new Error(`${label}: error surface rendered after reload: ${bodyText.slice(0, 300)}`);
      }
    }
    await page.waitForTimeout(250);
  }
  // Diagnostic dump: which surfaces are actually present (no trace needed).
  const dump = await page
    .evaluate(() => {
      const heads = Array.from(document.querySelectorAll('h1,h2,h3')).map((h) => (h as HTMLElement).innerText);
      return {
        heads,
        bodyText: (document.body.innerText || '').slice(0, 600).replace(/\n+/g, ' | '),
      };
    })
    .catch(() => null);
  console.log(`[e2e-02][coherent-diag ${label}] heads=${JSON.stringify(dump?.heads ?? null)}`);
  console.log(`[e2e-02][coherent-diag ${label}] body=${dump?.bodyText ?? 'n/a'}`);
  throw new Error(`${label}: no coherent student state within ${timeoutMs}ms (url=${page.url()})`);
}

/** The route must not render any error surface shortly after a reload. */
async function assertNoErrorSurface(page: Page, label: string) {
  await page.waitForTimeout(500);
  for (const heading of ERROR_SURFACE_HEADINGS) {
    await expect(page.getByRole('heading', { name: heading }), `${label}: no "${heading}" surface`).toHaveCount(0);
  }
}

/** Student-visible countdown (mm:ss) as seconds, from the header chip. */
async function readUiRemainingSeconds(page: Page): Promise<number | null> {
  return page
    .waitForFunction(() => {
      const el = document.querySelector('[data-testid="student-time-remaining"]');
      const raw = el?.textContent ?? null;
      if (!raw) return null;
      const parts = raw.trim().split(':');
      if (parts.length !== 2) return null;
      const minutes = Number(parts[0]);
      const seconds = Number(parts[1]);
      if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
      return minutes * 60 + seconds;
    }, undefined, { timeout: 10_000 })
    .then((handle) => handle.jsonValue() as Promise<number | null>);
}

interface ServerTimerSnapshot {
  sectionKey: string | null;
  remainingSeconds: number;
  proctorStatus?: string | null;
}

/**
 * Server-authoritative remaining time: the live session endpoint computes
 * `currentSectionRemainingSeconds` from the section deadline server-side, so
 * it is the ground truth for the timer-fairness invariant.
 */
async function readServerTimerSnapshot(page: Page, scheduleId: string): Promise<ServerTimerSnapshot | null> {
  const response = await page.request.get(`/api/v1/student/sessions/${scheduleId}/live`);
  if (!response.ok()) {
    return null;
  }
  const payload = (await response.json()) as {
    data?: {
      runtime?: { currentSectionKey?: string | null; currentSectionRemainingSeconds?: number };
      attempt?: { proctorStatus?: string | null };
    };
  };
  const runtime = payload?.data?.runtime;
  if (!runtime || typeof runtime.currentSectionRemainingSeconds !== 'number') {
    return null;
  }
  return {
    sectionKey: runtime.currentSectionKey ?? null,
    remainingSeconds: runtime.currentSectionRemainingSeconds,
    proctorStatus: payload?.data?.attempt?.proctorStatus ?? null,
  };
}

/**
 * Timer-fairness reload: capture UI + server remaining time, hard reload,
 * assert the same section is restored and the remaining time did not
 * reset/increase (tolerance only for wall time elapsed between reads).
 */
async function assertTimerFairnessAcrossReload(
  page: Page,
  scheduleId: string,
  opts: { label: string; sectionMarker: RegExp | string; answerLabel: string },
): Promise<void> {
  const uiBefore = await readUiRemainingSeconds(page);
  const serverBefore = await readServerTimerSnapshot(page, scheduleId);
  if (!serverBefore) {
    throw new Error(`${opts.label}: could not read server-authoritative remaining time before reload`);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });

  // The reload must land back on the same active section with the answer
  // surface restored.
  await waitForSectionMarker(page, opts.sectionMarker, `${opts.label}: section restored after reload`, 90_000);
  await expect(page.getByLabel(opts.answerLabel), `${opts.label}: answer surface restored`).toBeVisible({ timeout: 30_000 });

  const uiAfter = await readUiRemainingSeconds(page);
  const serverAfter = await readServerTimerSnapshot(page, scheduleId);
  if (!serverAfter) {
    throw new Error(`${opts.label}: could not read server-authoritative remaining time after reload`);
  }

  // Server-authoritative: the remaining time is derived from the section
  // deadline, so a reload cannot increase it.
  expect(serverAfter.sectionKey, `${opts.label}: same section per server snapshot`).toBe(
    serverBefore.sectionKey,
  );
  expect(
    serverAfter.remainingSeconds,
    `${opts.label}: server remaining time did not increase after reload`,
  ).toBeLessThanOrEqual(serverBefore.remainingSeconds);

  // Student-visible countdown: allow a small tolerance for the wall time that
  // elapsed between the two reads and for sub-second rounding. A timer reset
  // would jump by minutes and fail far beyond this tolerance.
  if (uiBefore !== null && uiAfter !== null) {
    expect(
      uiAfter,
      `${opts.label}: student-visible countdown did not reset/increase after reload`,
    ).toBeLessThanOrEqual(uiBefore + 2);
  }
}

interface RuntimeRow {
  status: string;
  actual_start_at: string | null;
  active_section_key: string | null;
  current_section_key: string | null;
  revision: number;
}

async function readRuntimeRow(scheduleId: string): Promise<RuntimeRow> {
  const rows = await queryDb<RuntimeRow>(
    `SELECT status, actual_start_at, active_section_key, current_section_key, revision
     FROM exam_session_runtimes WHERE schedule_id = ?`,
    [scheduleId],
  );
  if (rows.length !== 1) {
    throw new Error(`expected exactly one runtime row for schedule ${scheduleId}, got ${rows.length}`);
  }
  return rows[0];
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

test.describe('E2E-02 Reload during every phase (timer-fairness matrix)', () => {
  test.describe.configure({ timeout: 600_000 });

  test.afterAll(async () => {
    await closeDb();
  });

  test('hard-reloads at briefing, waiting, active sections, proctor pause, section transition, final submission, and post-exam', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const scheduleId = manifest.student.scheduleId;
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    const email = `e2e02+${wcode.toLowerCase()}-${Date.now()}@example.com`;
    const fullName = `E2E02 Candidate ${wcode}`;

    // Unique sentinels: exact strings the DB snapshot must contain verbatim.
    const listeningAnswer = `e2e02-listening-${wcode.toLowerCase()}`;
    const readingAnswer = `e2e02-reading-${wcode.toLowerCase()}`;
    const writingTask1Text = `e2e02-task1-${wcode.toLowerCase()}`;
    const writingTask2Text = `e2e02-task2-${wcode.toLowerCase()}`;

    const adminContext = await newAdminControlContext(browser);
    const studentContext = await browser.newContext();
    await stubScreenDetails(studentContext);
    const studentPage = await studentContext.newPage();

    const listeningMarker = 'What is the seeded listening answer?';
    const readingMarker = 'Write the missing word from the passage.';
    const writingMarker = /Task 1: Summarise/;
    const answerField = studentPage.getByLabel('Answer for question 1');
    const postExamHeading = studentPage.getByRole('heading', { name: /Examination Complete!/i });
    const pausedHeading = studentPage.getByRole('heading', { name: 'Individual session paused' });

    // ---- 1. Check in ----
    await studentCheckIn(studentPage, scheduleId, { wcode, email, fullName });

    // ---- 2. RELOAD during "briefing" (deviated: briefing UI removed
    // upstream; the pre-check card right after check-in is the closest real
    // pre-exam state). The pre-check has not persisted yet at this point, so
    // after the reload it must re-run and re-persist idempotently. ----
    await studentPage.reload({ waitUntil: 'domcontentloaded' });
    await assertNoErrorSurface(studentPage, 'after briefing reload');
    const stateAfterBriefing = await waitForCoherentStudentState(studentPage, 'after briefing reload', 45_000);
    console.log(`[e2e-02] briefing reload landed on: ${stateAfterBriefing}`);

    // The attempt row must exist for this run's unique email (created
    // server-side on the first session fetch). Capture its id — every later
    // reload must keep the same attempt, never a duplicate.
    const attemptRows = await pollDb<{ id: string }>(
      'SELECT id FROM student_attempts WHERE schedule_id = ? AND candidate_email = ?',
      [scheduleId, email],
      (rows) => rows.length === 1,
      'student attempt row created for this run',
    );
    const attemptId = attemptRows[0].id;

    // ---- 3. RELOAD during "waiting": the pre-check persistence is the
    // admission boundary; reload as soon as it has persisted (DB-truth, not
    // the network). The reload must not restart or advance the runtime, must
    // not duplicate the attempt, and must not show an error surface. ----
    await pollDb<{ integrity: string }>(
      'SELECT integrity FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => {
        const integrity = parseJson<{ preCheck?: { completedAt?: string | null } }>(rows[0].integrity);
        return Boolean(integrity.preCheck?.completedAt);
      },
      'pre-check persisted on the attempt',
    );
    const runtimeBeforeWaiting = await readRuntimeRow(scheduleId);
    await studentPage.reload({ waitUntil: 'domcontentloaded' });
    await assertNoErrorSurface(studentPage, 'after waiting reload');
    const stateAfterWaiting = await waitForCoherentStudentState(studentPage, 'after waiting reload', 45_000);
    console.log(`[e2e-02] waiting reload landed on: ${stateAfterWaiting}`);

    const runtimeAfterWaiting = await readRuntimeRow(scheduleId);
    expect(runtimeAfterWaiting, 'runtime untouched by the waiting reload (no timer start/restart)').toEqual(
      runtimeBeforeWaiting,
    );
    const attemptAfterWaiting = await queryDb<{ id: string }>(
      'SELECT id FROM student_attempts WHERE schedule_id = ? AND candidate_email = ?',
      [scheduleId, email],
    );
    expect(attemptAfterWaiting.map((row) => row.id), 'waiting reload must not duplicate the attempt').toEqual([
      attemptId,
    ]);

    // ---- 4. Enter the live exam (seed pre-started the runtime; idempotent). ----
    await proctorStartExam(adminContext, scheduleId);
    await waitForSectionMarker(studentPage, listeningMarker, 'listening section prompt', 90_000);
    await expect(answerField).toBeVisible({ timeout: 30_000 });

    // ---- 5. Answer listening; RELOAD during active listening (extra phase:
    // the journey's first active section) with the timer-fairness assertion.
    // The section marker must be restored, the typed answer intact (UI + DB),
    // and the remaining time must not have reset. ----
    await answerField.fill(listeningAnswer);
    await waitForSavedBanner(studentPage);
    await pollDb<{ answers: string }>(
      'SELECT answers FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => parseJson<Record<string, unknown>>(rows[0].answers)['listening-q1'] === listeningAnswer,
      'listening answer persisted to student_attempts.answers',
    );

    await assertTimerFairnessAcrossReload(studentPage, scheduleId, {
      label: 'active listening',
      sectionMarker: listeningMarker,
      answerLabel: 'Answer for question 1',
    });
    await expect(answerField).toHaveValue(listeningAnswer);
    await pollDb<{ answers: string }>(
      'SELECT answers FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => parseJson<Record<string, unknown>>(rows[0].answers)['listening-q1'] === listeningAnswer,
      'listening answer still persisted after the reload',
    );

    // ---- 6. Proctor pause. The cohort `pause_runtime` command is rejected
    // by the seeded exam policy (allowPause=false) — probe and record the
    // exact response (deviation note in the header), then drive the pause
    // phase through the per-attempt pause endpoint. ----
    const cohortPauseProbe = await postProctorApi(adminContext, `/api/v1/schedules/${scheduleId}/runtime/commands`, {
      action: 'pause_runtime',
      reason: 'e2e-02 cohort pause probe',
    });
    expect(cohortPauseProbe.status, `pause_runtime probe: ${cohortPauseProbe.body}`).toBe(422);
    expect(cohortPauseProbe.body).toContain('disabled by exam policy');

    const pauseResponse = await postProctorApi(
      adminContext,
      `/api/v1/proctor/sessions/${scheduleId}/attempts/${attemptId}/pause`,
      { reason: 'e2e-02 proctor pause for reload matrix' },
    );
    expect(pauseResponse.status, `pause_attempt: ${pauseResponse.body}`).toBe(200);
    await pollDb<{ proctor_status: string }>(
      'SELECT proctor_status FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => rows[0].proctor_status === 'paused',
      'attempt proctor_status is paused',
    );
    // CONTRACT FIX (this batch): `mapBackendStudentAttempt` previously
    // hardcoded proctorStatus:'active' (src/services/studentAttemptRepository
    // .ts) and NO code path read payload.proctorStatus, so the server's
    // per-attempt pause (advertised via the live endpoint and a WS "attempt"
    // event) never reached the UI — the blocking overlay machinery existed
    // but could never fire. The mapper now passes the server proctor state
    // through, so the pause overlay must render in-page. These are the
    // assertions the recorded characterization pins were meant to flip to.
    const pausedLiveProbe = await readServerTimerSnapshot(studentPage, scheduleId);
    console.log(`[e2e-02] live attempt.proctorStatus during pause probe: ${pausedLiveProbe.proctorStatus}`);
    expect(pausedLiveProbe?.proctorStatus, 'server advertises paused to the student session').toBe('paused');
    await expect(pausedHeading, 'pause overlay rendered while paused').toBeVisible({ timeout: 15_000 });
    await expect(answerField, 'answer field disabled while paused').toBeDisabled();

    // RELOAD during the proctor pause: the server-side pause is real and
    // persisted (proctor_status="paused", mutations gate blocked server-side,
    // DeliveryConflictReason::AttemptProctorBlocked), so the reload must
    // keep the attempt paused in the DB AND restore the blocking overlay in
    // the UI (the reload path uses the same mapper), must not duplicate or
    // corrupt the attempt, and must not show an error surface.
    await studentPage.reload({ waitUntil: 'domcontentloaded' });
    await assertNoErrorSurface(studentPage, 'after pause reload');
    const stateAfterPauseReload = await waitForCoherentStudentState(studentPage, 'after pause reload', 45_000);
    console.log(`[e2e-02] pause reload landed on: ${stateAfterPauseReload}`);
    await pollDb<{ proctor_status: string }>(
      'SELECT proctor_status FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => rows[0].proctor_status === 'paused',
      'attempt still paused after the reload',
    );
    const attemptAfterPauseReload = await queryDb<{ id: string }>(
      'SELECT id FROM student_attempts WHERE schedule_id = ? AND candidate_email = ?',
      [scheduleId, email],
    );
    expect(attemptAfterPauseReload.map((row) => row.id), 'pause reload must not duplicate the attempt').toEqual([
      attemptId,
    ]);
    // The pause overlay must be restored after the reload, and the workspace
    // stays blocked until the proctor resumes.
    await expect(pausedHeading, 'pause overlay restored after reload').toBeVisible({ timeout: 15_000 });
    await expect(answerField, 'answer field still disabled after reload').toBeDisabled();
    await expect(answerField, 'typed answer intact across the pause reload').toHaveValue(listeningAnswer);

    // Resume: the pause clears server-side and the exam continues with the
    // typed answer intact.
    const resumeResponse = await postProctorApi(
      adminContext,
      `/api/v1/proctor/sessions/${scheduleId}/attempts/${attemptId}/resume`,
      { reason: 'e2e-02 resume after pause reload' },
    );
    expect(resumeResponse.status, `resume_attempt: ${resumeResponse.body}`).toBe(200);
    await pollDb<{ proctor_status: string }>(
      'SELECT proctor_status FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => rows[0].proctor_status === 'active',
      'attempt proctor_status is active after resume',
    );
    await expect(answerField, 'answer field usable after resume').toBeEnabled();
    await expect(answerField).toHaveValue(listeningAnswer);

    // ---- 7. Section transition: advance listening → reading and reload
    // mid-transition (the client may not have applied the live update yet).
    // The runtime advances atomically server-side, so the reload must land
    // directly on the reading section — never a stuck or error state. ----
    await proctorEndSection(adminContext, scheduleId, 'listening', 'advance listening to reading');
    await studentPage.reload({ waitUntil: 'domcontentloaded' });
    await assertNoErrorSurface(studentPage, 'after transition reload');
    await waitForSectionMarker(studentPage, readingMarker, 'reading section prompt after transition reload', 90_000);
    await pollDb<{ current_section_key: string | null }>(
      'SELECT current_section_key FROM exam_session_runtimes WHERE schedule_id = ?',
      [scheduleId],
      (rows) => rows[0].current_section_key === 'reading',
      'runtime current_section_key is reading after the transition reload',
    );
    await pollDb<{ answers: string }>(
      'SELECT answers FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => parseJson<Record<string, unknown>>(rows[0].answers)['listening-q1'] === listeningAnswer,
      'listening answer still persisted across the transition reload',
    );

    // ---- 8. Answer reading; RELOAD during active reading (the plan's named
    // phase) with the same timer-fairness assertion. ----
    await expect(answerField).toBeVisible({ timeout: 30_000 });
    await answerField.fill(readingAnswer);
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

    await assertTimerFairnessAcrossReload(studentPage, scheduleId, {
      label: 'active reading',
      sectionMarker: readingMarker,
      answerLabel: 'Answer for question 1',
    });
    await expect(answerField).toHaveValue(readingAnswer);
    await pollDb<{ answers: string }>(
      'SELECT answers FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => {
        const answers = parseJson<Record<string, unknown>>(rows[0].answers);
        return answers['listening-q1'] === listeningAnswer && answers['reading-q1'] === readingAnswer;
      },
      'reading answer still persisted after the reload',
    );

    // ---- 9. Advance reading → writing; answer both tasks; RELOAD during
    // active writing: the writing section must be restored with the task-1
    // draft intact (UI + DB). ----
    await proctorEndSection(adminContext, scheduleId, 'reading', 'advance reading to writing');
    await waitForSectionMarker(studentPage, writingMarker, 'writing section prompt', 90_000);
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
        return writing['task1'] === writingTask1Text && writing['task2'] === writingTask2Text;
      },
      'writing answers persisted to student_attempts.writing_answers',
    );

    await studentPage.reload({ waitUntil: 'domcontentloaded' });
    await assertNoErrorSurface(studentPage, 'after active writing reload');
    const stateAfterWritingReload = await waitForCoherentStudentState(studentPage, 'after active writing reload', 60_000);
    console.log(`[e2e-02] active writing reload landed on: ${stateAfterWritingReload}`);
    await expect(writingEditor, 'writing editor restored after reload').toBeVisible({ timeout: 30_000 });
    // The restored writing tab follows the attempt's last server-persisted
    // currentQuestionId (observed: "Task 2" after answering both tasks), so
    // the task-1 prompt is not the marker to wait for after a reload. Switch
    // tabs explicitly — this is deterministic regardless of the restored tab.
    await studentPage.getByRole('button', { name: 'Task 1', exact: true }).click();
    await waitForSectionMarker(studentPage, writingMarker, 'task-1 prompt after writing reload', 60_000);
    await expect(writingEditor, 'task-1 draft restored after reload').toHaveValue(writingTask1Text);
    await studentPage.getByRole('button', { name: 'Task 2', exact: true }).click();
    await expect(writingEditor, 'task-2 draft restored after reload').toHaveValue(writingTask2Text);
    // Back to task 1 so the next section advance starts from a committed state.
    await studentPage.getByRole('button', { name: 'Task 1', exact: true }).click();
    await pollDb<{ writing_answers: string }>(
      'SELECT writing_answers FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => {
        const writing = parseJson<Record<string, unknown>>(rows[0].writing_answers);
        return writing['task1'] === writingTask1Text && writing['task2'] === writingTask2Text;
      },
      'writing answers still persisted after the reload',
    );

    // ---- 10. Final submission: the proctor ends the final section; the
    // runtime completes and the backend auto-submits in the same transaction.
    // RELOAD during the final-submission window: must land on the post-exam
    // surface (never a stuck/error state), with the full answer set in
    // `final_submission`. ----
    await proctorEndSection(adminContext, scheduleId, 'writing', 'complete final section');
    await studentPage.reload({ waitUntil: 'domcontentloaded' });
    await assertNoErrorSurface(studentPage, 'after final-submission reload');
    await expect(postExamHeading, 'post-exam screen after final-submission reload').toBeVisible({ timeout: 90_000 });

    const attempt = await pollDb<AttemptRow>(
      `SELECT id, phase, submitted_at, answers, writing_answers, final_submission, created_at, revision
       FROM student_attempts WHERE id = ?`,
      [attemptId],
      (rows) =>
        rows.length === 1 &&
        rows[0].phase === 'post-exam' &&
        rows[0].submitted_at !== null &&
        rows[0].final_submission !== null,
      'student_attempts final_submission snapshot persisted',
    );
    const snapshotRow = attempt[0];
    expect(snapshotRow.id, 'attempt id unchanged across every reload').toBe(attemptId);

    // Submission snapshot: exact typed values, not just row existence.
    const persistedAnswers = parseJson<Record<string, unknown>>(snapshotRow.answers);
    expect(persistedAnswers).toEqual({
      'listening-q1': listeningAnswer,
      'reading-q1': readingAnswer,
    });
    const persistedWriting = parseJson<Record<string, unknown>>(snapshotRow.writing_answers);
    expect(persistedWriting).toEqual({ task1: writingTask1Text, task2: writingTask2Text });
    const snapshot = parseJson<Record<string, unknown>>(snapshotRow.final_submission as string);
    expect(snapshot['submissionId']).toBeTruthy();
    expect(Number.isNaN(Date.parse(String(snapshot['submittedAt'])))).toBe(false);
    expect(snapshot['answers']).toEqual({
      'listening-q1': listeningAnswer,
      'reading-q1': readingAnswer,
    });
    expect(snapshot['writingAnswers']).toEqual({ task1: writingTask1Text, task2: writingTask2Text });
    const autoSubmission = snapshot['autoSubmission'] === true;
    const finalFlush = snapshot['finalFlush'] != null;
    expect(autoSubmission || finalFlush, 'snapshot carries autoSubmission or finalFlush').toBe(true);
    expect(new Date(snapshotRow.submitted_at as string).getTime()).toBeGreaterThanOrEqual(
      new Date(snapshotRow.created_at).getTime(),
    );
    expect(snapshotRow.revision).toBeGreaterThanOrEqual(1);

    // ---- 11. RELOAD during the confirmed post-exam phase: the terminal
    // state must be stable — same post-exam screen, same snapshot, still
    // exactly one attempt row. ----
    await studentPage.reload({ waitUntil: 'domcontentloaded' });
    await assertNoErrorSurface(studentPage, 'after confirmed post-exam reload');
    await expect(postExamHeading, 'post-exam screen stable after reload').toBeVisible({ timeout: 60_000 });

    const attemptAfterPostExamReload = await queryDb<{ id: string; submitted_at: string | null; final_submission: string | null }>(
      'SELECT id, submitted_at, final_submission FROM student_attempts WHERE schedule_id = ? AND candidate_email = ?',
      [scheduleId, email],
    );
    expect(attemptAfterPostExamReload.length, 'exactly one attempt row after every reload').toBe(1);
    expect(attemptAfterPostExamReload[0].id).toBe(attemptId);
    expect(attemptAfterPostExamReload[0].submitted_at).toBe(snapshotRow.submitted_at);
    expect(parseJson<Record<string, unknown>>(attemptAfterPostExamReload[0].final_submission as string)).toEqual(
      parseJson<Record<string, unknown>>(snapshotRow.final_submission as string),
    );

    await studentContext.close();
    await adminContext.close();
  });
});

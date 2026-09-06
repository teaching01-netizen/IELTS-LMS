import { expect, test, type Page } from "@playwright/test";
import { readBackendE2EManifest } from "./support/backendE2e";
import {
  completePreCheckIfPresent,
  deterministicWcode,
  openStudentSessionWithRetry,
  startLobbyIfPresent,
  studentCheckIn,
  stubScreenDetails,
} from "./support/studentUi";
import { closeDb, queryDb, type SqlParam } from "./support/db";
import {
  newAdminControlContext,
  proctorEndSection,
  proctorStartExam,
} from "./support/proctorControls";

/**
 * E2E-05 — Proctor advances during client flush (invariant1.md §5 journey).
 *
 * Journey: check in → waiting → proctor starts exam → answer listening +
 * reading normally (sentinels) → advance to writing → write task-1 base
 * value (Saved, DB-gated) → DELAY the mutation response (the final task-1
 * value's V2 `responses:batch` request is held client-side) → ADVANCE the runtime
 * (proctor end-section-now on the final section: completes the runtime AND
 * queues durable auto-submit after the proctor transaction commits) → RELEASE
 * the delayed request. Because Playwright held the request before it reached
 * the server,
 * this is a genuine post-submit arrival and MUST be rejected as
 * `ATTEMPT_SUBMITTED`. The late value must never be merged into authoritative
 * exam state, and it must never be lost silently from the client's durable
 * recovery queue.
 *
 * The four plan steps map to a genuine server-side race, made deterministic
 * with Playwright request routing (no clock mocking):
 * - "Delay the mutation response": `page.route` on the student's V2
 *   `responses:batch` endpoint holds the request CLIENT-SIDE (the server has
 *   not seen it yet). The hold is scoped to the exact request carrying the
 *   run's unique final-writing sentinel (URL glob + request postData match),
 *   so ordinary autosave traffic is never delayed. A release deferred
 *   controls the timing; a bounded release timer guarantees the test can
 *   never hang (it forwards the batch anyway if the advance breaks).
 * - "Advance the runtime": while the request is held,
 *   `POST /api/v1/proctor/sessions/:id/control/end-section-now` on the final
 *   (writing) section completes the runtime and calls
 *   `auto_submit_schedule_attempts_in_tx` after the runtime transaction
 *   commits — the worker then seals the snapshot (`submitted_at` +
 *   `final_submission`, `completionReason="proctor_end"`) WITHOUT the held
 *   mutation.
 * - "Release the delayed response": the held request is forwarded after the
 *   advance resolved (status/body recorded verbatim).
 * - "Verify strict post-submit rejection": once the proctor transaction has
 *   sealed the attempt, `apply_mutation_batch` admits only exact duplicate
 *   mutation ids that were already persisted. A brand-new mutation arriving
 *   afterward returns the structured terminal conflict; there is
 *   no post-submit grace merge. The outbox then loads the canonical sealed
 *   attempt. Because this held sentinel is absent from that submission, it
 *   keeps the mutation pending with an error sync state instead of clearing
 *   it. The test therefore proves both sides of the boundary: server truth is
 *   immutable after submit, while client recovery evidence is retained.
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
 * - The exact error banner text is not pre-pinned. The load-bearing evidence
 *   is stronger: the server returns a terminal conflict, the sealed snapshot
 *   excludes the held sentinel, and the browser's durable queue still holds
 *   that exact value. Banner text is logged only as human-facing evidence.
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
  if (typeof raw === "string") {
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
  timeoutMs = 90_000
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
      { timeout: timeoutMs, message: description }
    )
    .toBe(true);
  return lastRows;
}

/** Wait for the student's autosave banner to report "Saved". */
async function waitForSavedBanner(page: Page) {
  let lastBannerText = "";
  try {
    await expect
      .poll(
        async () => {
          const banner = page.getByRole("banner");
          lastBannerText = await banner.innerText().catch(() => "");
          return banner
            .getByText("Saved")
            .isVisible()
            .catch(() => false);
        },
        { timeout: 30_000, message: "autosave banner shows Saved" }
      )
      .toBe(true);
  } catch (error) {
    console.log(`[e2e-05] autosave banner before timeout: ${lastBannerText.replace(/\n/g, " | ")}`);
    throw error;
  }
}

/** Wait for the currently rendered exam section marker (prompt text). */
async function waitForSectionMarker(page: Page, marker: RegExp | string, label: string) {
  await expect(page.getByText(marker).first(), label).toBeVisible({ timeout: 60_000 });
}

// ---------------------------------------------------------------------------
// V2 durable-draft reader.
// ---------------------------------------------------------------------------

/**
 * Poll until the V2 durability stores hold the writing task value. V2 keeps
 * a synchronous response checkpoint plus the shared durable-draft IndexedDB
 * record; it no longer uses the V1 mutation-mirror database.
 */
async function waitForTask1InDurableQueue(page: Page, value: string, timeoutMs = 30_000) {
  await expect
    .poll(
      async () => {
        return page.evaluate(async (expected) => {
          // IndexedDB requests are not cancellable, and a blocked connection
          // can otherwise leave one expect.poll iteration pending forever.
          // Keep each inspection bounded so the outer Playwright timeout is
          // meaningful even when an interrupted browser context left a stale
          // connection behind.
          const bounded = async <T>(promise: Promise<T>, fallback: T, ms = 750): Promise<T> => {
            let timer: number | null = null;
            const timeout = new Promise<T>((resolve) => {
              timer = window.setTimeout(() => resolve(fallback), ms);
            });
            try {
              return await Promise.race([promise, timeout]);
            } finally {
              if (timer !== null) window.clearTimeout(timer);
            }
          };

          const hasExpectedAnswer = (candidate: unknown): boolean => {
            if (!candidate || typeof candidate !== "object") return false;
            const value = (candidate as { value?: unknown }).value ?? candidate;
            if (!value || typeof value !== "object") return false;
            const payload = (value as { payload?: unknown }).payload;
            return Boolean(
              payload &&
              typeof payload === "object" &&
              (payload as { answer?: unknown }).answer === expected
            );
          };

          for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (
              !key ||
              (!key.startsWith("response-checkpoint:v2:") &&
                !key.startsWith("warwick_durable_draft_v1:"))
            )
              continue;
            try {
              const record = JSON.parse(localStorage.getItem(key) ?? "null");
              if (key.endsWith(":task1") && hasExpectedAnswer(record)) return true;
              if (key.includes("v2_quarantine:") && hasExpectedAnswer(record)) return true;
            } catch {
              // Continue checking the IndexedDB mirror.
            }
          }

          let open: IDBOpenDBRequest;
          try {
            open = indexedDB.open("warwick_durable_drafts_v1", 1);
          } catch {
            return false;
          }
          let openSettled = false;
          const database = await bounded(
            new Promise<IDBDatabase | null>((resolve) => {
              const finish = (value: IDBDatabase | null) => {
                if (openSettled) return;
                openSettled = true;
                resolve(value);
              };
              open.onsuccess = () => {
                const result = open.result;
                if (openSettled) {
                  result.close();
                  return;
                }
                finish(result);
              };
              open.onerror = () => finish(null);
              open.onblocked = () => finish(null);
            }),
            null
          );
          if (!database || !database.objectStoreNames.contains("drafts")) {
            database?.close();
            return false;
          }
          try {
            let request: IDBRequest<unknown[]>;
            try {
              request = database.transaction("drafts", "readonly").objectStore("drafts").getAll();
            } catch {
              return false;
            }
            const records = await bounded(
              new Promise<unknown[]>((resolve) => {
                request.onsuccess = () => resolve(request.result as unknown[]);
                request.onerror = () => resolve([]);
                request.onabort = () => resolve([]);
              }),
              []
            );
            return records.some((record) => {
              if (!record || typeof record !== "object") return false;
              const key = (record as { key?: unknown }).key;
              return (
                typeof key === "string" &&
                ((key.endsWith("_task1") && hasExpectedAnswer(record)) ||
                  (key.includes("v2_quarantine:") && hasExpectedAnswer(record)))
              );
            });
          } finally {
            database.close();
          }
        }, value);
      },
      { timeout: timeoutMs, message: `durable queue holds writing task1 = "${value}"` }
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

const BATCH_ROUTE_GLOB = "**/api/v2/student/attempts/*/responses:batch";
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

  private async handle(route: Parameters<Parameters<Page["route"]>[1]>[0]) {
    const postData = route.request().postData() ?? "";
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

test.describe("E2E-05 Proctor advances during client flush (DB-verified)", () => {
  test.describe.configure({ timeout: 600_000 });

  test.afterAll(async () => {
    await closeDb();
  });

  test("a mutation held before server ingress while the proctor ends the final section is rejected after submit and retained durably", async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const scheduleId = manifest.student.flushScheduleId;
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

    const listeningMarker = "What is the seeded listening answer?";
    const readingMarker = "Write the missing word from the passage.";
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
      "SELECT id FROM student_attempts WHERE schedule_id = ? AND candidate_email = ?",
      [scheduleId, email],
      (rows) => rows.length === 1,
      "student attempt row created for this run"
    );
    const attemptId = attemptRows[0].id;

    // ---- 2. Proctor starts exam; answer listening + reading normally ----
    await proctorStartExam(adminContext, scheduleId);
    await startLobbyIfPresent(studentPage);
    await openStudentSessionWithRetry(studentPage, scheduleId, wcode);

    await waitForSectionMarker(studentPage, listeningMarker, "listening section prompt");
    await studentPage.getByLabel("Answer for question 1").fill(listeningAnswer);
    await waitForSavedBanner(studentPage);
    await pollDb<{ answers: string }>(
      "SELECT answers FROM student_attempts WHERE id = ?",
      [attemptId],
      (rows) =>
        parseJson<Record<string, unknown>>(rows[0].answers)["listening-q1"] === listeningAnswer,
      "listening answer persisted to student_attempts.answers"
    );

    await proctorEndSection(adminContext, scheduleId, "listening", "advance listening to reading");
    await waitForSectionMarker(studentPage, readingMarker, "reading section prompt");
    await studentPage.getByLabel("Answer for question 1").fill(readingAnswer);
    await waitForSavedBanner(studentPage);
    await pollDb<{ answers: string }>(
      "SELECT answers FROM student_attempts WHERE id = ?",
      [attemptId],
      (rows) => {
        const answers = parseJson<Record<string, unknown>>(rows[0].answers);
        return (
          answers["listening-q1"] === listeningAnswer && answers["reading-q1"] === readingAnswer
        );
      },
      "listening + reading answers persisted to student_attempts.answers"
    );

    // ---- 3. Advance to writing (the last section) and commit the base draft ----
    await proctorEndSection(adminContext, scheduleId, "reading", "advance reading to writing");
    await waitForSectionMarker(studentPage, writingMarker, "writing section prompt");
    const writingEditor = studentPage.getByLabel("Writing response");
    await expect(writingEditor).toBeVisible({ timeout: 30_000 });

    // Proven commit pattern from e2e-01/e2e-04: fill → switch tabs → blur, so
    // the draft is flushed through the autosave pipeline and persisted.
    await writingEditor.fill(writingTask1Base);
    await studentPage.getByRole("button", { name: "Task 2", exact: true }).click();
    await studentPage.getByRole("button", { name: "Task 1", exact: true }).click();
    await writingEditor.blur();
    await waitForSavedBanner(studentPage);
    await pollDb<{ writing_answers: string }>(
      "SELECT writing_answers FROM student_attempts WHERE id = ?",
      [attemptId],
      (rows) => {
        const writing = parseJson<Record<string, unknown>>(rows[0].writing_answers);
        return writing["task1"] === writingTask1Base;
      },
      "writing task-1 base draft persisted to student_attempts.writing_answers"
    );

    // ---- 4. ARM THE HOLD: the final value's V2 responses:batch is delayed ----
    await holdHarness.arm(studentPage);

    // ---- 5. Type the FINAL task-1 value; its flush must be observed&held ----
    const finalFillStartMs = Date.now();
    // Bounded action timeouts: a hung editor (e.g. the runtime completing
    // mid-fill) must fail fast, not consume the 600s test timeout.
    await writingEditor.fill(writingTask1Final, { timeout: 15_000 });
    await writingEditor.blur({ timeout: 15_000 });
    await expect(
      writingEditor,
      "final value landed in the editor before the hold release"
    ).toHaveValue(writingTask1Final, { timeout: 15_000 });

    // HARD REQUIREMENT: the sentinel-matched V2 responses:batch MUST be observed
    // and held. A silent bypass (route never firing) is a hard failure.
    await expect
      .poll(() => Promise.resolve(holdHarness.heldBatches.length), {
        timeout: 45_000,
        message: "the final flush responses:batch request was observed and held",
      })
      .toBeGreaterThan(0);
    const firstHeld = holdHarness.heldBatches[0];
    expect(
      firstHeld.status,
      "the held request must NOT have been forwarded yet (still in-flight)"
    ).toBeNull();

    // No-silent-loss proof DURING the hold: the final value is already in the
    // durable queue (localStorage + IndexedDB mirrors), so even if the in-flight
    // request were lost entirely the value is retained client-side.
    await waitForTask1InDurableQueue(studentPage, writingTask1Final);
    const durableWriteConfirmedAtMs = Date.now();

    // ---- 6. ADVANCE THE RUNTIME while the mutation is in-flight ----
    const advanceStartMs = Date.now();
    await proctorEndSection(
      adminContext,
      scheduleId,
      "writing",
      "advance writing: completes runtime + auto-submits"
    );
    const advanceEndMs = Date.now();
    console.log(
      `[e2e-05] proctor advance resolved in ${advanceEndMs - advanceStartMs}ms ` +
        `(final flush observed at ${holdHarness.firstHitAtMs}, durable queue confirmed at ${durableWriteConfirmedAtMs})`
    );

    // The runtime must have been completed by the proctor's command: the
    // writing section's completion_reason is 'proctor_end'.
    const completedSection = await pollDb<{ completion_reason: string | null }>(
      `SELECT completion_reason FROM exam_session_runtime_sections
       WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
         AND section_key = 'writing'`,
      [scheduleId],
      (rows) => rows.length === 1 && rows[0].completion_reason !== null,
      "writing section completed by the proctor end-section-now command"
    );
    expect(
      completedSection[0].completion_reason,
      "proctor advance writes completion_reason=proctor_end"
    ).toBe("proctor_end");
    await pollDb<{ phase: string }>(
      "SELECT phase FROM student_attempts WHERE id = ?",
      [attemptId],
      (rows) => rows[0].phase === "post-exam",
      "attempt reached post-exam after the queued auto-submit worker ran"
    );
    const submitObservedAtMs = Date.now();

    // Post-exam surface is the honest student state after the advance; the
    // snapshot was taken WITHOUT the held mutation.
    await expect(
      studentPage.getByRole("heading", { name: /Examination Complete!/i }),
      "post-exam screen after the proctor advance (probe still held)"
    ).toBeVisible({ timeout: 60_000 });

    // ---- 7. RELEASE THE DELAYED REQUEST ----
    // Forward only after the proctor transaction has sealed the attempt. Since
    // the request has not reached the server yet, this is intentionally a
    // true post-submit arrival, not an in-flight pre-deadline server request.
    const settleBeforeReleaseMs = 1_250;
    await studentPage.waitForTimeout(settleBeforeReleaseMs);
    holdHarness.release();
    const releasedAtMs = holdHarness.releasedAtMs ?? Date.now();
    expect(
      holdHarness.releaseTimedOut,
      "the hold must be released by the test, not the bound timer"
    ).toBe(false);
    console.log(
      `[e2e-05] hold released: hold duration=${releasedAtMs - (holdHarness.firstHitAtMs ?? releasedAtMs)}ms, ` +
        `release→submit gap=${releasedAtMs - submitObservedAtMs}ms`
    );

    // ---- 8. RECORD THE SERVER'S VERDICT (the released mutation response) ----
    await expect
      .poll(
        () => {
          const record = holdHarness.heldBatches[0];
          return (
            record !== null &&
            record !== undefined &&
            record.status !== null &&
            record.body !== null
          );
        },
        { timeout: 45_000, message: "the released responses:batch request got a server response" }
      )
      .toBe(true);
    const forwardedAtMs = holdHarness.heldBatches[0]!.forwardedAtMs ?? Date.now();
    console.log(
      `[e2e-05] released mutation response: HTTP ${firstHeld.status} ` +
        `(server round-trip after forward ${forwardedAtMs - releasedAtMs}ms)`
    );
    expect(firstHeld.error, "the held request must have been forwarded to the server").toBeNull();

    // ---------------------------------------------------------------------
    // 9. VERIFY STRICT POST-SUBMIT REJECTION.
    //
    // This request was held before server ingress. Once the proctor transaction
    // seals the attempt, a new mutation id cannot alter authoritative state.
    // Exact duplicates that were already persisted remain idempotent, but this
    // sentinel is intentionally new and must return a terminal conflict.
    // ---------------------------------------------------------------------
    const releasedBody = parseJson<{
      code?: string | null;
      message?: string | null;
      details?: { reason?: string | null } | null;
      error?: {
        code?: string | null;
        message?: string | null;
        details?: { reason?: string | null } | null;
      };
    }>(firstHeld.body as string);

    const conflictCode = String(
      releasedBody?.code ?? releasedBody?.error?.code ?? releasedBody?.details?.reason ?? ""
    );
    console.log(
      `[e2e-05][verdict] released response: HTTP ${firstHeld.status} ` +
        `body=${String(firstHeld.body).slice(0, 500)}`
    );
    expect([409, 422], "a new mutation arriving after submit must conflict").toContain(
      firstHeld.status
    );
    expect(
      ["ATTEMPT_SUBMITTED", "ATTEMPT_NOT_WRITABLE", "CONTROL_EPOCH_STALE"],
      "post-submit mutation has a stable machine-readable terminal conflict"
    ).toContain(conflictCode);

    // ---- 10. THE INVARIANT: SEALED SERVER TRUTH + RETAINED RECOVERY INTENT ----
    // The final sentinel was never server-admitted, so it must not appear in
    // the sealed attempt, final submission, or append-only mutation log. The
    // browser must retain it in the durable queue instead of pretending it was
    // saved or silently discarding it.
    const sealedRows = await queryDb<AttemptRow>(
      `SELECT id, phase, submitted_at, answers, writing_answers, final_submission, created_at, revision
       FROM student_attempts WHERE id = ?`,
      [attemptId]
    );
    expect(sealedRows).toHaveLength(1);
    const sealedAttempt = sealedRows[0]!;
    expect(sealedAttempt.phase).toBe("post-exam");
    expect(sealedAttempt.submitted_at).not.toBeNull();
    expect(sealedAttempt.final_submission).not.toBeNull();

    const persistedWriting = parseJson<Record<string, unknown>>(sealedAttempt.writing_answers);
    const snapshot = parseJson<Record<string, unknown>>(sealedAttempt.final_submission as string);
    const snapshotWriting = parseJson<Record<string, unknown>>(
      snapshot["writingAnswers"] as unknown
    );
    expect(
      persistedWriting["task1"],
      "authoritative writing stays at the last admitted value"
    ).toBe(writingTask1Base);
    expect(snapshotWriting["task1"], "sealed submission excludes the post-submit sentinel").toBe(
      writingTask1Base
    );
    expect(snapshot["graceMerge"], "post-submit grace merge must not exist").toBeUndefined();
    expect(String(snapshot["completionReason"])).toBe("proctor_end");
    expect(snapshot["autoSubmission"] === true).toBe(true);
    expect(String(snapshot["submissionPolicy"])).toBe("forced_auto_submit");
    expect(parseJson<Record<string, unknown>>(sealedAttempt.answers)["listening-q1"]).toBe(
      listeningAnswer
    );
    expect(parseJson<Record<string, unknown>>(sealedAttempt.answers)["reading-q1"]).toBe(
      readingAnswer
    );

    const mutationRows = await queryDb<{
      mutation_type: string;
      payload: unknown;
      applied_at: string | null;
    }>(
      "SELECT mutation_type, payload, applied_at FROM student_attempt_mutations WHERE attempt_id = ?",
      [attemptId]
    );
    const payloadText = (row: { payload: unknown }): string =>
      typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload);
    const forbiddenLateMutation = mutationRows.find(
      (row) => row.mutation_type === "SetEssayText" && payloadText(row).includes(writingTask1Final)
    );
    expect(
      forbiddenLateMutation,
      "post-submit sentinel must never enter the accepted mutation log"
    ).toBeUndefined();

    await waitForTask1InDurableQueue(studentPage, writingTask1Final, 45_000);
    const banner = studentPage.getByRole("banner");
    const bannerText =
      (await banner.count()) > 0
        ? await banner
            .first()
            .innerText({ timeout: 1_000 })
            .catch(() => "")
        : "";
    console.log(
      `[e2e-05][retained] post-submit value remains in durable recovery queue; banner=` +
        `${bannerText.replace(/\n/g, " | ")}`
    );
    const recoveryObservedAtMs = Date.now();

    // ---- 10. Exactly ONE attempt row for this run's (schedule, email) ----
    const attemptCount = await queryDb<{ count: number }>(
      "SELECT COUNT(*) AS count FROM student_attempts WHERE schedule_id = ? AND candidate_email = ?",
      [scheduleId, email]
    );
    expect(Number(attemptCount[0].count)).toBe(1);

    // ---- 11. Timing report (the race choreography, measured) ----
    const timings = {
      finalFillDurationMs: (holdHarness.firstHitAtMs ?? 0) - finalFillStartMs,
      holdDurationMs: releasedAtMs - (holdHarness.firstHitAtMs ?? releasedAtMs),
      durableQueueConfirmationLeadMs: durableWriteConfirmedAtMs - (holdHarness.firstHitAtMs ?? 0),
      advanceDurationMs: advanceEndMs - advanceStartMs,
      releaseToSubmitGapMs: releasedAtMs - submitObservedAtMs,
      submitToRecoveryObservedMs: recoveryObservedAtMs - submitObservedAtMs,
      serverRoundTripAfterReleaseMs: forwardedAtMs - releasedAtMs,
    };
    console.log(`[e2e-05] timings: ${JSON.stringify(timings)}`);

    // The deliberate terminal conflict leaves the student UI in a
    // "recovery required" state, whose production beforeunload guard asks
    // for confirmation. Close the page explicitly without running unload
    // handlers before closing the context so the E2E cleanup cannot hang on
    // that user-facing prompt.
    await studentPage.close({ runBeforeUnload: false });
    await studentContext.close();
    await adminContext.close();
  });
});

import { expect, test, type Page } from '@playwright/test';
import { readBackendE2EManifest } from './support/backendE2e';
import {
  completePreCheckIfPresent,
  deterministicWcode,
  openStudentSessionWithRetry,
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
 * E2E-03 — Offline typing and reconnect (invariant1.md §5 journey).
 *
 * Journey: check in → waiting → proctor starts exam → listening answer typed
 * ONLINE (sentinel #1) → advance to reading → go offline → type the reading
 * answer OFFLINE (sentinel #2, the load-bearing offline value) → assert the
 * offline surface + durable queue → reload while offline → reconnect →
 * restore from durable queue → backend receives the exact offline value →
 * advance to writing → go offline again → type BOTH writing task drafts
 * OFFLINE → reconnect → backend receives the exact drafts → proctor completes
 * the final section → post-exam screen → final_submission snapshot contains
 * the exact offline-typed values → exactly one attempt row.
 *
 * Mechanics discovered (verified empirically with probe runs, see report):
 * - Playwright `context.setOffline(true)` fires the browser 'offline' event;
 *   StudentNetworkProvider.handleOffline sets attemptSyncState='offline'
 *   (src/components/student/providers/StudentNetworkProvider.tsx:76-84),
 *   which StudentApp maps one-way to the header autoSaveStatus badge
 *   (src/components/student/StudentApp.tsx:72-82): `<span
 *   className="text-amber-700">Offline</span>` in the banner
 *   (src/components/student/StudentHeader.tsx:402-405). During normal offline
 *   typing the blocking machine stays disengaged (FEX-032), so the badge is
 *   the ONLY visible offline surface (the "Connection lost" overlay does NOT
 *   engage on this path — verified in the probe).
 * - Offline typing goes to RAM immediately and to the durable queue via a
 *   100ms debounced write (ANSWER_DURABLE_WRITE_DEBOUNCE_MS); the queue is
 *   dual-written to localStorage key `ielts_student_attempt_pending_mutations_v1`
 *   and IndexedDB database `ielts_student_attempt_cache_v1`, object store
 *   `pending_mutations` (src/services/studentAttemptRepository.ts:38-45,
 *   :1840-1865). Records are `[{attemptId, mutations: [...]}]` with answer
 *   mutations carrying `payload.value` = the exact typed string. The attempt
 *   snapshot key `ielts_student_attempts_v1` does NOT contain the offline
 *   value until the flush succeeds — the durable queue is the source of truth
 *   for unflushed mutations.
 * - FULL RELOAD WHILE OFFLINE CANNOT LOAD THE APP: there is no service worker
 *   / offline-first shell, so `page.reload()` rejects with
 *   net::ERR_INTERNET_DISCONNECTED and the page lands on
 *   chrome-error://chromewebdata/ (the app's "Loading Error + Retry" surface
 *   is only reachable when the JS bundle loads but the data fetch fails,
 *   which cannot happen on a full reload with no network). localStorage is
 *   NOT accessible from the chrome error page (SecurityError). This is
 *   recorded as a deviation from the brief's anticipated "error surface with
 *   retry path" (see honesty notes) — NOT fixed.
 * - Recovery is proven end-to-end instead: the durable queue survives in the
 *   context's storage; after reconnect + reload, the app hydrates the pending
 *   mutations from the durable queue (the input shows the offline value
 *   immediately), the reconnect recovery flushes the queue
 *   (flushPending → mutations:batch), the banner returns to "Saved", and
 *   `student_attempts.answers` contains the exact offline value.
 * - The writing section is a SECOND offline episode: sections advance
 *   server-side via the proctor and the offline client cannot observe the
 *   advance, so "a writing task draft" typed while offline happens once the
 *   writing section is live. Both task drafts are typed while offline.
 * - No grading-projection worker is needed: the final `end-section-now`
 *   completes the runtime and auto-submits in-transaction, writing
 *   `final_submission` directly (verified in e2e-01).
 *
 * Honesty notes (deviations from the brief, recorded — production untouched):
 * - "Reload while offline": the brief anticipated the app's "Loading Error"
 *   surface with a Retry path; the honest behavior is a browser-level network
 *   error page (net::ERR_INTERNET_DISCONNECTED, chrome-error://chromewebdata/)
 *   because the app has no offline-first shell. The exact surface is
 *   engine-specific (chromium chrome-error://, firefox about:neterror, webkit
 *   its own page), so the spec's load-bearing assertions are browser-agnostic
 *   (no usable exam workspace after the offline reload) and the
 *   chromium-specific details are pinned behind a project guard. The spec
 *   asserts that the durable queue cannot be read from the error page
 *   (SecurityError — recorded as a finding, chromium), and then proves the
 *   queue survived via the reconnect + restore + DB-verify steps. The retry
 *   path is exercised in spirit: reconnecting + reloading recovers the
 *   session.
 * - "Reading answers + a writing task draft while offline": reading answers
 *   are typed offline in episode A; the writing task drafts are typed offline
 *   in episode B (the writing section is not reachable while offline, since
 *   section advancement requires the proctor command + live sync).
 * - The pre-check/waiting steps use the same settling helpers as e2e-01/e2e-02
 *   (briefing UI removed upstream).
 *
 * Timing assumptions (from probe measurements): the offline badge appears
 * within ~2s of setOffline(true); the durable queue write lands within ~1.5s
 * of typing; reconnect flush completes within ~10s; DB polls use 90s timeouts.
 *
 * Test isolation: unique email per run (`Date.now()` suffix — a CI retry
 * reuses the same seeded schedule, so a deterministic email would collide
 * with the failed run's attempt row) and unique sentinels. Exactly one
 * attempt row must exist for the run's (schedule, email) at the end.
 */

// ---------------------------------------------------------------------------
// Shared helpers (mirrored from e2e-01/e2e-02; deliberately not extracted yet).
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
async function waitForSavedBanner(page: Page, timeoutMs = 60_000) {
  await expect
    .poll(
      async () => {
        const banner = page.getByRole('banner');
        return banner.getByText('Saved').isVisible().catch(() => false);
      },
      { timeout: timeoutMs, message: 'autosave banner shows Saved' },
    )
    .toBe(true);
}

/** Wait for the currently rendered exam section marker (prompt text). */
async function waitForSectionMarker(page: Page, marker: RegExp | string, label: string) {
  await expect(page.getByText(marker).first(), label).toBeVisible({ timeout: 90_000 });
}

/** Wait until the header autoSaveStatus badge reports the offline state. */
async function waitForOfflineBadge(page: Page) {
  await expect
    .poll(
      async () => {
        const banner = page.getByRole('banner');
        return banner.getByText('Offline').isVisible().catch(() => false);
      },
      { timeout: 30_000, message: 'header autoSaveStatus badge shows Offline' },
    )
    .toBe(true);
}

// ---------------------------------------------------------------------------
// Durable-queue readers (localStorage + IndexedDB mirror, see header notes).
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

/**
 * Poll the durable queue (localStorage + IndexedDB mirrors) until a mutation
 * of `type` carries payload field `field` === `value` in EITHER mirror (both
 * mirrors are written in the same savePendingMutations call; IndexedDB may
 * lag the localStorage write by a moment).
 */
async function waitForDurableMutation(
  page: Page,
  opts: {
    type: 'answer' | 'writing_answer';
    field: 'questionId' | 'taskId';
    fieldValue: string;
    value: string;
    label: string;
  },
) {
  await expect
    .poll(
      async () => {
        const [local, idb] = await Promise.all([
          readDurableQueueFromLocalStorage(page),
          readDurableQueueFromIndexedDb(page),
        ]);
        const matches = (mutations: DurableMutationLite[]) =>
          mutations.some(
            (mutation) =>
              mutation.type === opts.type &&
              mutation.payload[opts.field] === opts.fieldValue &&
              mutation.payload.value === opts.value,
          );
        return matches(local) || matches(idb);
      },
      { timeout: 30_000, message: opts.label },
    )
    .toBe(true);
}

/** Poll until the durable queue holds NO answer/writing mutations. */
async function waitForDurableQueueDrained(page: Page) {
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
      { timeout: 60_000, message: 'durable queue drained after reconnect flush' },
    )
    .toBe(true);
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

test.describe('E2E-03 Offline typing and reconnect (DB-verified)', () => {
  test.describe.configure({ timeout: 600_000 });

  test.afterAll(async () => {
    await closeDb();
  });

  test('types answers offline, reloads while offline, restores from the durable queue, reconnects, and completes submission', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const scheduleId = manifest.student.scheduleId;
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    const email = `e2e03+${wcode.toLowerCase()}-${Date.now()}@example.com`;
    const fullName = `E2E03 Candidate ${wcode}`;

    // Unique sentinels: exact strings the DB snapshot must contain verbatim.
    // listeningAnswer is typed ONLINE; everything else is typed OFFLINE.
    const listeningAnswer = `e2e03-listening-${wcode.toLowerCase()}`;
    const readingAnswer = `e2e03-reading-${wcode.toLowerCase()}-offline`;
    const writingTask1Text = `e2e03-task1-${wcode.toLowerCase()}-offline`;
    const writingTask2Text = `e2e03-task2-${wcode.toLowerCase()}-offline`;

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

    // Capture the attempt id (created server-side on the first session fetch).
    const attemptRows = await pollDb<{ id: string }>(
      'SELECT id FROM student_attempts WHERE schedule_id = ? AND candidate_email = ?',
      [scheduleId, email],
      (rows) => rows.length === 1,
      'student attempt row created for this run',
    );
    const attemptId = attemptRows[0].id;

    // ---- 2. Proctor starts the exam (seed pre-starts the runtime; 409 tolerated) ----
    await proctorStartExam(adminContext, scheduleId);
    await waitForSectionMarker(studentPage, listeningMarker, 'listening section prompt');
    const listeningField = studentPage.getByLabel('Answer for question 1');
    await expect(listeningField).toBeVisible({ timeout: 30_000 });

    // ---- 3. Type the first sentinel answer ONLINE ----
    await listeningField.fill(listeningAnswer);
    await waitForSavedBanner(studentPage);
    await pollDb<{ answers: string }>(
      'SELECT answers FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => parseJson<Record<string, unknown>>(rows[0].answers)['listening-q1'] === listeningAnswer,
      'online-typed listening answer persisted to student_attempts.answers',
    );

    // ---- 4. Advance to reading (online), then go OFFLINE ----
    await proctorEndSection(adminContext, scheduleId, 'listening', 'advance listening to reading');
    await waitForSectionMarker(studentPage, readingMarker, 'reading section prompt');
    const readingField = studentPage.getByLabel('Answer for question 1');
    await expect(readingField).toBeVisible({ timeout: 30_000 });

    await studentContext.setOffline(true);
    await waitForOfflineBadge(studentPage);

    // ---- 5. Type the reading answer while OFFLINE ----
    await readingField.fill(readingAnswer);
    // The typed value must be preserved in the input control while offline.
    await expect(readingField).toHaveValue(readingAnswer);

    // ---- 6. Restore-from-durable-queue proof: the exact offline value is in
    // the durable queue (localStorage + IndexedDB mirrors) while still offline ----
    await waitForDurableMutation(studentPage, {
      type: 'answer',
      field: 'questionId',
      fieldValue: 'reading-q1',
      value: readingAnswer,
      label: 'offline-typed reading answer in the durable queue',
    });

    // ---- 7. RELOAD while still offline. Honest behavior (verified in
    // probes): the app has no offline-first shell (no service worker), so
    // the reload cannot load the document — it fails and lands on the
    // browser's network error page. That is a recoverable end state: the
    // durable queue lives in the context's storage and survives.
    // The exact error surface is engine-specific (chromium:
    // chrome-error:// + ERR_INTERNET_DISCONNECTED + localStorage
    // SecurityError; firefox: about:neterror + NS_ERROR_OFFLINE; webkit:
    // its own error page), so the load-bearing assertions are
    // browser-agnostic: the reload cannot yield a usable exam surface, and
    // the app origin URL is left (or, on engines that keep the URL, the
    // document is an error page either way). The chromium-specific details
    // are pinned behind a project guard. ----
    await studentPage.reload({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {
      // Navigation failure (e.g. ERR_INTERNET_DISCONNECTED) is expected.
    });
    // Browser-agnostic contract: no usable exam workspace after an offline
    // reload (holds on every engine's error page, and would also hold on a
    // cache-served bundle that fails its data fetches and shows the route
    // "Loading Error" surface — no answer field in either case).
    await studentPage
      .reload({ waitUntil: 'domcontentloaded', timeout: 15_000 })
      .catch(() => {
        // Navigation failure while offline (see chromium characterization
        // below) is expected.
      });
    await expect(
      studentPage.getByLabel('Answer for question 1'),
      'no usable exam workspace after reload while offline',
    ).not.toBeVisible({ timeout: 15_000 });

    if (testInfo.project.name === 'chromium') {
      // Recorded finding (chromium characterization): the reload cannot
      // load the document, the page lands on chrome-error://, and the app
      // origin's storage is unreachable from there — the app shell cannot
      // run offline at all. The reload promise may reject with
      // ERR_INTERNET_DISCONNECTED or a protocol-level "Not attached to an
      // active page" (the target detaches while navigating to the error
      // page) — or resolve if the navigation itself is what fails — so the
      // URL + storage pins below carry the characterization, not the
      // rejection message.
      await expect
        .poll(() => studentPage.url(), { timeout: 15_000, message: 'chromium: page lands on the chrome error page' })
        .toContain('chrome-error://');
      const storageProbe = await studentPage
        .evaluate(() => {
          try {
            localStorage.getItem('ielts_student_attempt_pending_mutations_v1');
            return null;
          } catch (error) {
            return String(error);
          }
        })
        .catch(() => 'evaluate failed');
      expect(storageProbe, 'chromium: localStorage inaccessible from the chrome error page (no offline shell)').toContain(
        'SecurityError',
      );
    }

    // ---- 8. RECONNECT: come back online, reload, restore from the durable
    // queue. The app must recover to the reading section with the offline
    // value restored in the input, the banner back to Saved, and the queue
    // drained (flushed to the backend). ----
    await studentContext.setOffline(false);
    await studentPage.reload({ waitUntil: 'domcontentloaded' });
    await waitForSectionMarker(studentPage, readingMarker, 'reading section restored after reconnect');
    await expect
      .poll(
        async () =>
          (await studentPage
            .getByLabel('Answer for question 1')
            .first()
            .inputValue()
            .catch(() => '<unavailable>')) === readingAnswer,
        { timeout: 90_000, message: 'offline-typed reading answer restored from the durable queue' },
      )
      .toBe(true);
    await waitForSavedBanner(studentPage);
    await waitForDurableQueueDrained(studentPage);

    // Backend verification: EXACT values, not just row existence — both the
    // online-typed listening answer and the offline-typed reading answer.
    await pollDb<{ answers: string }>(
      'SELECT answers FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => {
        const answers = parseJson<Record<string, unknown>>(rows[0].answers);
        return answers['listening-q1'] === listeningAnswer && answers['reading-q1'] === readingAnswer;
      },
      'listening + offline-typed reading answers persisted exactly to student_attempts.answers',
    );

    // ---- 9. Advance to writing (online), then go OFFLINE again to type the
    // writing task drafts (the brief's "writing task draft" typed offline) ----
    await proctorEndSection(adminContext, scheduleId, 'reading', 'advance reading to writing');
    await waitForSectionMarker(studentPage, writingMarker, 'writing section prompt');
    const writingEditor = studentPage.getByLabel('Writing response');
    await expect(writingEditor).toBeVisible({ timeout: 30_000 });

    await studentContext.setOffline(true);
    await waitForOfflineBadge(studentPage);

    // Type BOTH task drafts while offline (commit pattern from e2e-01: fill
    // task 1 → switch to task 2 → fill task 2 → switch back → blur).
    await writingEditor.fill(writingTask1Text);
    await studentPage.getByRole('button', { name: 'Task 2', exact: true }).click();
    await writingEditor.fill(writingTask2Text);
    await studentPage.getByRole('button', { name: 'Task 1', exact: true }).click();
    await writingEditor.blur();
    // The drafts must be preserved in the editor while offline.
    await expect(writingEditor).toHaveValue(writingTask1Text);
    await studentPage.getByRole('button', { name: 'Task 2', exact: true }).click();
    await expect(writingEditor).toHaveValue(writingTask2Text);
    await studentPage.getByRole('button', { name: 'Task 1', exact: true }).click();

    // Durable queue: both offline-typed drafts, exact values.
    await waitForDurableMutation(studentPage, {
      type: 'writing_answer',
      field: 'taskId',
      fieldValue: 'task1',
      value: writingTask1Text,
      label: 'offline-typed task1 draft in the durable queue',
    });
    await waitForDurableMutation(studentPage, {
      type: 'writing_answer',
      field: 'taskId',
      fieldValue: 'task2',
      value: writingTask2Text,
      label: 'offline-typed task2 draft in the durable queue',
    });

    // ---- 10. RECONNECT: flush the offline drafts ----
    await studentContext.setOffline(false);
    await waitForSavedBanner(studentPage, 90_000);
    await waitForDurableQueueDrained(studentPage);
    await pollDb<{ writing_answers: string }>(
      'SELECT writing_answers FROM student_attempts WHERE id = ?',
      [attemptId],
      (rows) => {
        const writing = parseJson<Record<string, unknown>>(rows[0].writing_answers);
        return (
          writing['task1'] === writingTask1Text && writing['task2'] === writingTask2Text
        );
      },
      'offline-typed writing drafts persisted exactly to student_attempts.writing_answers',
    );

    // ---- 11. Complete submission: proctor ends the final section; the
    // runtime completes and the backend auto-submits in-transaction ----
    await proctorEndSection(adminContext, scheduleId, 'writing', 'complete final section');
    await expect(
      studentPage.getByRole('heading', { name: /Examination Complete!/i }),
      'post-exam screen',
    ).toBeVisible({ timeout: 90_000 });

    // ---- 12. Backend verification: the final submission snapshot must
    // contain the exact offline-typed values (answers + writingAnswers) ----
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
    expect(snapshotRow.id, 'attempt id unchanged across the offline journey').toBe(attemptId);

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

    // Exactly one attempt row for this run's (schedule, email) — reloads and
    // reconnects must never duplicate the attempt.
    const attemptCount = await queryDb<{ count: number }>(
      'SELECT COUNT(*) AS count FROM student_attempts WHERE schedule_id = ? AND candidate_email = ?',
      [scheduleId, email],
    );
    expect(Number(attemptCount[0].count)).toBe(1);

    await studentContext.close();
    await adminContext.close();
  });
});

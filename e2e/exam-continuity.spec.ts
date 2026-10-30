import { createHash } from "node:crypto";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { closeDb, executeUpdate, queryDb } from "./support/db";
import { readBackendE2EManifest, STUDENT_STORAGE_STATE_PATH } from "./support/backendE2e";
import {
  completePreCheckIfPresent,
  openStudentSessionWithRetry,
  startLobbyIfPresent,
  studentCheckIn,
  stubScreenDetails,
} from "./support/studentUi";

// Sitting-grant scenarios from docs/plans/2026-10-29-exam-session-continuity.md
// (section 7). Each test owns one seeded IELTS personal schedule, so tests never
// share a submission or a grant. Every test starts from its own check-in.

const STUDENT_EMAIL = "e2e.student@example.com";
const SESSION_COOKIE = process.env["SESSION_COOKIE_NAME"] ?? "session";
const CSRF_COOKIE = process.env["CSRF_COOKIE_NAME"] ?? "csrf";
const CREDENTIAL_STORAGE_KEY = "ielts_student_attempt_credentials_v1";
const BACKEND_URL = process.env["VITE_BACKEND_API_URL"] ?? "http://127.0.0.1:4319";
const TABLET_SKIP_REASON =
  "Listening readiness needs a gesture on touch devices; qualify on a real iPad.";

interface SittingGrant {
  id: string;
  attempt_id: string;
  token_id: string;
}

function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function startSitting(browser: Browser, scheduleId: string, candidateId: string) {
  const context = await browser.newContext({ storageState: STUDENT_STORAGE_STATE_PATH });
  await stubScreenDetails(context);
  const page = await context.newPage();
  await studentCheckIn(page, scheduleId, { wcode: candidateId, email: STUDENT_EMAIL, fullName: "Alice Candidate" });
  await openStudentSessionWithRetry(page, scheduleId, candidateId);
  await completePreCheckIfPresent(page);
  await startLobbyIfPresent(page);
  await openStudentSessionWithRetry(page, scheduleId, candidateId);
  const answer = page.getByLabel("Answer for question 1");
  await expect(answer).toBeVisible({ timeout: 30_000 });
  return { context, page, answer };
}

async function sessionCookieValue(context: BrowserContext): Promise<string> {
  const cookie = (await context.cookies()).find((entry) => entry.name === SESSION_COOKIE);
  expect(cookie, "account session cookie").toBeDefined();
  return cookie!.value;
}

/** The live grant this browser established at check-in (bound to its account session). */
async function sittingGrantForSession(scheduleId: string, context: BrowserContext): Promise<SittingGrant> {
  const rows = await queryDb<SittingGrant>(
    `SELECT id, attempt_id, token_id FROM attempt_sessions
      WHERE schedule_id = ? AND credential_policy = 'sitting_v1' AND revoked_at IS NULL
        AND account_session_id = (SELECT id FROM user_sessions WHERE session_token_hash = ?)
        AND client_session_id = (SELECT active_client_session_id FROM student_attempts WHERE id = attempt_sessions.attempt_id)`,
    [scheduleId, tokenHash(await sessionCookieValue(context))]
  );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/** The attempt bearer this browser stored, read exactly as the client reads it. */
async function storedSittingBearer(page: Page, attemptId: string): Promise<string> {
  const bearer = await page.evaluate(
    ({ key, attemptId }) => {
      for (const storage of [window.localStorage, window.sessionStorage]) {
        const raw = storage.getItem(key);
        if (!raw) continue;
        const entries = JSON.parse(raw) as Array<{ attemptId?: string; attemptToken?: string }>;
        const token = entries.find((entry) => entry.attemptId === attemptId)?.attemptToken;
        if (token) return token;
      }
      return null;
    },
    { key: CREDENTIAL_STORAGE_KEY, attemptId }
  );
  expect(bearer, "sitting credential stored on this device").toEqual(expect.any(String));
  return bearer as string;
}

/** Calls an attempt-bearer route with only the bearer: no account cookie, no CSRF. */
async function callWithBearer(
  page: Page,
  method: "GET" | "POST",
  path: string,
  bearer: string
): Promise<{ status: number; code: string | null }> {
  const options = { headers: { Authorization: `Bearer ${bearer}` }, data: {} };
  const response =
    method === "GET"
      ? await page.request.get(`${BACKEND_URL}${path}`, { headers: options.headers })
      : await page.request.post(`${BACKEND_URL}${path}`, options);
  const body = (await response.json().catch(() => null)) as { code?: string } | null;
  return { status: response.status(), code: body?.code ?? null };
}

async function expectStoredAnswer(attemptId: string, questionId: string, answer: string) {
  await expect
    .poll(
      async () => {
        const rows = await queryDb<{ answer: string }>(
          "SELECT JSON_UNQUOTE(JSON_EXTRACT(response, '$.answer')) AS answer FROM attempt_responses_v2 WHERE attempt_id = ? AND question_id = ?",
          [attemptId, questionId]
        );
        return rows[0]?.answer;
      },
      { timeout: 30_000 }
    )
    .toBe(answer);
}

/** Section timeline state for one candidate, as the server persists it. */
async function timelineState(attemptId: string, sectionKey: string): Promise<string | null> {
  const rows = await queryDb<{ state: string }>(
    "SELECT state FROM ielts_attempt_section_timelines WHERE attempt_id = ? AND section_key = ?",
    [attemptId, sectionKey]
  );
  return rows[0]?.state ?? null;
}

async function expireSectionDeadline(attemptId: string, sectionKey: string) {
  await executeUpdate(
    "UPDATE ielts_attempt_section_timelines SET deadline_at = DATE_SUB(NOW(6), INTERVAL 1 SECOND) WHERE attempt_id = ? AND section_key = ?",
    [attemptId, sectionKey]
  );
}

/** Opens the next room section the way the personal-timing spec does. */
async function openRoomSection(scheduleId: string, sectionKey: "reading" | "writing") {
  const order = sectionKey === "reading" ? 1 : 2;
  await executeUpdate(
    `UPDATE exam_session_runtime_sections
     SET status = CASE WHEN section_order < ? THEN 'completed' WHEN section_order = ? THEN 'live' ELSE 'locked' END,
         actual_start_at = CASE WHEN section_order <= ? THEN COALESCE(actual_start_at, UTC_TIMESTAMP(6)) ELSE NULL END,
         actual_end_at = CASE WHEN section_order < ? THEN COALESCE(actual_end_at, UTC_TIMESTAMP(6)) ELSE NULL END
     WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)`,
    [order, order, order, order, scheduleId]
  );
  await executeUpdate(
    `UPDATE exam_session_runtimes
     SET active_section_key = ?, current_section_key = ?, current_section_remaining_seconds = 60,
         waiting_for_next_section = FALSE
     WHERE schedule_id = ? AND status = 'live'`,
    [sectionKey, sectionKey, scheduleId]
  );
}

test.describe("exam access continuity (sitting grant)", () => {
  test.describe.configure({ timeout: 180_000 });
  test.afterAll(closeDb);

  test("a sitting grant keeps saving after the browser drops its login cookies", async ({ browser }, testInfo) => {
    test.skip(process.env["EXAM_ACCESS_ENABLED"] !== "true", "Requires the isolated sitting-grant qualification profile.");
    test.skip(testInfo.project.name === "continuity-tablet", TABLET_SKIP_REASON);
    const manifest = readBackendE2EManifest();
    const questionId = manifest.student.questionId;
    const scheduleId = manifest.student.ieltsPersonalTimingScheduleId;
    const { context, page, answer } = await startSitting(browser, scheduleId, manifest.student.candidateId);
    try {
      await answer.fill("before-cookie-drop");
      await answer.blur();
      const grant = await sittingGrantForSession(scheduleId, context);
      await expectStoredAnswer(grant.attempt_id, questionId, "before-cookie-drop");

      await context.clearCookies();
      expect((await page.request.get("/api/v1/auth/session")).status()).toBe(401);

      await answer.fill("after-cookie-drop");
      await answer.blur();
      await expectStoredAnswer(grant.attempt_id, questionId, "after-cookie-drop");

      await page.reload();
      await expect(page.getByLabel("Answer for question 1")).toHaveValue("after-cookie-drop", { timeout: 30_000 });
      const after = await queryDb<{ token_id: string; revoked_at: string | null }>(
        "SELECT token_id, revoked_at FROM attempt_sessions WHERE id = ?",
        [grant.id]
      );
      expect(after[0]).toMatchObject({ token_id: grant.token_id, revoked_at: null });
    } finally {
      await context.close();
    }
  });

  test("logout-all revokes the sitting grant, refuses later writes, and keeps the unsent answer on screen", async ({
    browser,
  }, testInfo) => {
    test.skip(process.env["EXAM_ACCESS_ENABLED"] !== "true", "Requires the isolated sitting-grant qualification profile.");
    test.skip(testInfo.project.name === "continuity-tablet", TABLET_SKIP_REASON);
    const manifest = readBackendE2EManifest();
    const questionId = manifest.student.questionId;
    const scheduleId = manifest.student.ieltsPersonalRecoveryScheduleId;
    const { context, page, answer } = await startSitting(browser, scheduleId, manifest.student.candidateId);
    try {
      await answer.fill("before-logout-all");
      await answer.blur();
      const grant = await sittingGrantForSession(scheduleId, context);
      await expectStoredAnswer(grant.attempt_id, questionId, "before-logout-all");
      const bearer = await storedSittingBearer(page, grant.attempt_id);

      const csrf = (await context.cookies()).find((entry) => entry.name === CSRF_COOKIE)?.value;
      expect(csrf, "csrf cookie").toBeTruthy();
      const logout = await page.request.post("/api/v1/auth/logout-all", {
        headers: { "X-Csrf-Token": csrf!, Origin: new URL(page.url()).origin },
      });
      expect(logout.status()).toBe(200);

      await expect
        .poll(
          async () => {
            const rows = await queryDb<{ revoked: number; reason: string | null }>(
              "SELECT revoked_at IS NOT NULL AS revoked, revocation_reason AS reason FROM attempt_sessions WHERE id = ?",
              [grant.id]
            );
            return rows[0];
          },
          { timeout: 30_000 }
        )
        .toMatchObject({ revoked: 1, reason: "logout_all" });

      // The stale bearer is refused with a typed reason, and the probe itself mutates nothing.
      const probe = await callWithBearer(
        page,
        "GET",
        `/v2/student/attempts/${grant.attempt_id}/submission-receipt?submissionId=probe-after-logout`,
        bearer
      );
      expect(probe).toEqual({ status: 403, code: "EXAM_ACCESS_REVOKED" });

      const refusedWrite = page.waitForResponse(
        (response) => response.url().includes("/responses:batch") && response.status() === 403,
        { timeout: 45_000 }
      );
      await answer.fill("after-logout-all");
      await answer.blur();
      expect(await (await refusedWrite).json()).toMatchObject({ code: "EXAM_ACCESS_REVOKED" });
      await expect(answer).toHaveValue("after-logout-all");
      await expectStoredAnswer(grant.attempt_id, questionId, "before-logout-all");

      const revokedAfter = await queryDb<{ token_id: string; revoked: number }>(
        "SELECT token_id, revoked_at IS NOT NULL AS revoked FROM attempt_sessions WHERE id = ?",
        [grant.id]
      );
      expect(revokedAfter[0]).toMatchObject({ token_id: grant.token_id, revoked: 1 });
    } finally {
      await context.close();
    }
  });

  test("an automatic final submission whose response is lost completes exactly once after account expiry", async ({
    browser,
  }, testInfo) => {
    test.skip(process.env["EXAM_ACCESS_ENABLED"] !== "true", "Requires the isolated sitting-grant qualification profile.");
    test.skip(testInfo.project.name === "continuity-tablet", TABLET_SKIP_REASON);
    const manifest = readBackendE2EManifest();
    const questionId = manifest.student.questionId;
    const scheduleId = manifest.student.ieltsPersonalSubmissionScheduleId;
    test.setTimeout(300_000);
    const { context, page, answer } = await startSitting(browser, scheduleId, manifest.student.candidateId);
    try {
      await answer.fill("submitted-after-expiry");
      await answer.blur();
      const grant = await sittingGrantForSession(scheduleId, context);
      await expectStoredAnswer(grant.attempt_id, questionId, "submitted-after-expiry");

      await executeUpdate(
        "UPDATE user_sessions SET expires_at = TIMESTAMPADD(SECOND, -5, UTC_TIMESTAMP(6)) WHERE session_token_hash = ?",
        [tokenHash(await sessionCookieValue(context))]
      );
      expect((await page.request.get("/api/v1/auth/session")).status()).toBe(401);

      // The server commits the first final submission, then the candidate's
      // response is lost. Later submit requests pass through untouched.
      let submitRequests = 0;
      let droppedResponses = 0;
      await page.route("**/v2/student/attempts/*/submit", async (route) => {
        submitRequests += 1;
        if (droppedResponses > 0) {
          await route.continue();
          return;
        }
        droppedResponses += 1;
        await route.fetch();
        await route.abort("failed");
      });

      // Walk the sections as the personal-timing spec does: expire the candidate's
      // own deadline, let the room open the next section, reload into it. Writing's
      // expiry is the final personal deadline that makes the client submit.
      await expireSectionDeadline(grant.attempt_id, "listening");
      await openRoomSection(scheduleId, "reading");
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect
        .poll(() => timelineState(grant.attempt_id, "reading"), { timeout: 30_000 })
        .toBe("active");
      await expireSectionDeadline(grant.attempt_id, "reading");
      await openRoomSection(scheduleId, "writing");
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect
        .poll(() => timelineState(grant.attempt_id, "writing"), { timeout: 30_000 })
        .toBe("active");
      await expireSectionDeadline(grant.attempt_id, "writing");
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect.poll(() => droppedResponses, { timeout: 60_000 }).toBe(1);
      await expect
        .poll(
          async () => {
            const rows = await queryDb<{ count: number }>(
              "SELECT COUNT(*) AS count FROM attempt_submissions_v2 WHERE attempt_id = ?",
              [grant.attempt_id]
            );
            return Number(rows[0]?.count ?? 0);
          },
          { timeout: 30_000, message: "the server committed the final submission before the response was lost" }
        )
        .toBe(1);

      await page.unroute("**/v2/student/attempts/*/submit");
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "IELTS Examination Complete!" })).toBeVisible({
        timeout: 60_000,
      });

      const [sealed] = await queryDb<{
        delivery_status: string;
        submitted_at: string | null;
        final_submission: string | null;
        receipts: number;
      }>(
        `SELECT s.delivery_status, s.submitted_at, CAST(s.final_submission AS CHAR) AS final_submission,
                (SELECT COUNT(*) FROM attempt_submissions_v2 r WHERE r.attempt_id = s.id) AS receipts
           FROM student_attempts s WHERE s.id = ?`,
        [grant.attempt_id]
      );
      expect(sealed).toMatchObject({ delivery_status: "submitted", receipts: 1 });
      expect(sealed?.submitted_at).not.toBeNull();
      expect(sealed?.final_submission).toContain("submitted-after-expiry");
      expect(submitRequests).toBeGreaterThanOrEqual(1);
    } finally {
      await context.close();
    }
  });

  test("grant expiry mid-sitting refuses the write and keeps the unsent answer on screen", async ({
    browser,
  }, testInfo) => {
    test.skip(process.env["EXAM_ACCESS_ENABLED"] !== "true", "Requires the isolated sitting-grant qualification profile.");
    test.skip(testInfo.project.name === "continuity-tablet", TABLET_SKIP_REASON);
    const manifest = readBackendE2EManifest();
    const questionId = manifest.student.questionId;
    const scheduleId = manifest.student.ieltsPersonalControlsScheduleId;
    const { context, page, answer } = await startSitting(browser, scheduleId, manifest.student.candidateId);
    try {
      await answer.fill("before-grant-expiry");
      await answer.blur();
      const grant = await sittingGrantForSession(scheduleId, context);
      await expectStoredAnswer(grant.attempt_id, questionId, "before-grant-expiry");
      const bearer = await storedSittingBearer(page, grant.attempt_id);

      // Expire the grant horizon in the database; the signed token still
      // verifies, so only the authoritative row can refuse it.
      await executeUpdate(
        "UPDATE attempt_sessions SET expires_at = TIMESTAMPADD(SECOND, -5, UTC_TIMESTAMP(6)) WHERE id = ?",
        [grant.id]
      );
      const resume = await callWithBearer(page, "POST", `/v2/student/attempts/${grant.attempt_id}/access:resume`, bearer);
      expect(resume).toEqual({ status: 401, code: "EXAM_ACCESS_EXPIRED" });

      const refusedWrite = page.waitForResponse(
        (response) => response.url().includes("/responses:batch") && response.status() === 401,
        { timeout: 45_000 }
      );
      await answer.fill("after-grant-expiry");
      await answer.blur();
      expect(await (await refusedWrite).json()).toMatchObject({ code: "EXAM_ACCESS_EXPIRED" });
      await expect(answer).toHaveValue("after-grant-expiry");
      await expectStoredAnswer(grant.attempt_id, questionId, "before-grant-expiry");

      // Resume never renews an expired grant: same token, still expired.
      const expired = await queryDb<{ token_id: string; expired: number }>(
        "SELECT token_id, expires_at <= UTC_TIMESTAMP(6) AS expired FROM attempt_sessions WHERE id = ?",
        [grant.id]
      );
      expect(expired[0]).toMatchObject({ token_id: grant.token_id, expired: 1 });
    } finally {
      await context.close();
    }
  });
});

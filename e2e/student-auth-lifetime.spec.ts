import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { closeDb, executeUpdate, queryDb } from "./support/db";
import { readBackendE2EManifest, STUDENT_STORAGE_STATE_PATH } from "./support/backendE2e";
import {
  completePreCheckIfPresent,
  openStudentSessionWithRetry,
  startLobbyIfPresent,
  studentCheckIn,
  stubScreenDetails,
} from "./support/studentUi";

const STUDENT_EMAIL = "e2e.student@example.com";
const STUDENT_PASSWORD = "Password123!";
const STUDENT_SESSION_COOKIE = process.env["SESSION_COOKIE_NAME"] ?? "session";
const STUDENT_IDLE_SECONDS = Number(process.env["SESSION_IDLE_STUDENT_MINS"] ?? "60") * 60;
const ATTEMPT_TOKEN_TTL_SECONDS = Number(process.env["ATTEMPT_TOKEN_TTL_MINUTES"] ?? "15") * 60;

interface StudentLoginSession {
  id: string;
  remembered: number;
  idle_window_seconds: number | null;
  credential_authenticated_at: string | null;
  absolute_lifetime_seconds: number;
  idle_lifetime_seconds: number;
  cookie_expires_epoch: number;
}

interface AttemptSession {
  id: string;
  attempt_id: string;
  token_id: string;
  ttl_seconds: number;
}

interface AttemptBatchResponse {
  status: number;
  tokenId: string | null;
}

function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

test.describe("student authentication lifetimes", () => {
  test.describe.configure({ timeout: 120_000 });
  test.afterAll(closeDb);

  test("student sign-in keeps the 12-hour absolute and configured idle limits when remember-me is selected", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email Address").fill(STUDENT_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(STUDENT_PASSWORD);
    const remember = page.getByLabel("Keep me signed in on this device");
    await expect(remember).toBeChecked();
    await page.getByRole("button", { name: "Sign In" }).click();
    await expect(page.getByRole("heading", { name: "Student check-in" })).toBeVisible();

    const cookie = (await page.context().cookies()).find(
      (entry) => entry.name === STUDENT_SESSION_COOKIE
    );
    expect(cookie, "student session cookie").toBeDefined();
    expect(cookie!.httpOnly).toBe(true);

    const rows = await queryDb<StudentLoginSession>(
      `SELECT id, remembered, idle_window_seconds, credential_authenticated_at,
              TIMESTAMPDIFF(SECOND, issued_at, expires_at) AS absolute_lifetime_seconds,
              TIMESTAMPDIFF(SECOND, last_seen_at, idle_timeout_at) AS idle_lifetime_seconds,
              UNIX_TIMESTAMP(expires_at) AS cookie_expires_epoch
         FROM user_sessions
        WHERE session_token_hash = ?`,
      [tokenHash(cookie!.value)]
    );
    expect(rows).toHaveLength(1);
    const session = rows[0]!;
    expect(session.remembered).toBe(0);
    expect(session.idle_window_seconds).toBeNull();
    expect(session.credential_authenticated_at).toBeNull();
    expect(session.absolute_lifetime_seconds).toBe(12 * 60 * 60);
    expect(session.idle_lifetime_seconds).toBe(STUDENT_IDLE_SECONDS);
    expect(Math.abs(cookie!.expires - Number(session.cookie_expires_epoch))).toBeLessThanOrEqual(2);

    expect((await page.request.get("/api/v1/auth/session")).status()).toBe(200);

    // Advance only the hard deadline. The idle deadline and browser cookie stay
    // live, so the next real authenticated request must still be rejected.
    await executeUpdate(
      `UPDATE user_sessions
          SET expires_at = TIMESTAMPADD(SECOND, -5, UTC_TIMESTAMP(6)),
              idle_timeout_at = TIMESTAMPADD(MINUTE, 1, UTC_TIMESTAMP(6))
        WHERE id = ?`,
      [session.id]
    );
    expect((await page.request.get("/api/v1/auth/session")).status()).toBe(401);
  });

  test("a student answer saves after an expired 15-minute attempt credential is refreshed", async ({
    browser,
  }) => {
    test.skip(process.env["EXAM_ACCESS_ENABLED"] === "true", "Legacy rotation is qualified separately from sitting grants.");
    const manifest = readBackendE2EManifest();
    const scheduleId = manifest.student.scheduleId;
    const candidateId = manifest.student.candidateId;
    const context = await browser.newContext({ storageState: STUDENT_STORAGE_STATE_PATH });
    await stubScreenDetails(context);
    const page = await context.newPage();

    try {
      await studentCheckIn(page, scheduleId, {
        wcode: candidateId,
        email: STUDENT_EMAIL,
        fullName: "Alice Candidate",
      });
      await openStudentSessionWithRetry(page, scheduleId, candidateId);
      await completePreCheckIfPresent(page);
      await startLobbyIfPresent(page);
      await openStudentSessionWithRetry(page, scheduleId, candidateId);
      const answer = page.getByLabel("Answer for question 1");
      await expect(answer).toBeVisible({ timeout: 30_000 });

      const batchResponses: AttemptBatchResponse[] = [];
      page.on("response", (response) => {
        if (!response.url().includes("/responses:batch")) return;
        const authorization = response.request().headers()["authorization"];
        const encodedClaims = authorization?.match(/^Bearer ([^.]+)\./)?.[1];
        let tokenId: string | null = null;
        if (encodedClaims) {
          try {
            const claims = JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8")) as {
              token_id?: unknown;
            };
            if (typeof claims.token_id === "string") tokenId = claims.token_id;
          } catch {
            tokenId = null;
          }
        }
        batchResponses.push({ status: response.status(), tokenId });
      });

      const firstAnswer = `initial-attempt-token-${Date.now()}`;
      await answer.click();
      await answer.pressSequentially(firstAnswer, { delay: 5 });
      await answer.blur();
      await expect
        .poll(() => batchResponses.some((entry) => entry.status === 200 && entry.tokenId !== null), {
          timeout: 30_000,
          message: "student answer is accepted with its current attempt credential",
        })
        .toBe(true);

      const initialTokenId = batchResponses.find(
        (entry) => entry.status === 200 && entry.tokenId !== null
      )?.tokenId;
      expect(initialTokenId).toBeTruthy();
      const initialRows = await queryDb<AttemptSession>(
        `SELECT id, attempt_id, token_id,
                TIMESTAMPDIFF(SECOND, issued_at, expires_at) AS ttl_seconds
           FROM attempt_sessions WHERE token_id = ? AND revoked_at IS NULL`,
        [initialTokenId!]
      );
      expect(initialRows).toHaveLength(1);
      const initial = initialRows[0]!;
      expect(initial.ttl_seconds).toBe(ATTEMPT_TOKEN_TTL_SECONDS);

      batchResponses.length = 0;
      await executeUpdate(
        "UPDATE attempt_sessions SET expires_at = TIMESTAMPADD(SECOND, -5, UTC_TIMESTAMP(6)) WHERE token_id = ?",
        [initial.token_id]
      );
      const answerText = `refreshed-attempt-token-${Date.now()}`;
      await answer.click();
      await answer.pressSequentially(answerText, { delay: 5 });
      await answer.blur();
      await expect
        .poll(() => batchResponses.map((entry) => entry.status), {
          timeout: 30_000,
          message: "the expired attempt write is retried with the refreshed credential",
        })
        .toEqual(expect.arrayContaining([401, 200]));
      await expect
        .poll(
          async () => {
            const rows = await queryDb<{ token_id: string; future: number }>(
              `SELECT token_id, expires_at > UTC_TIMESTAMP(6) AS future
                 FROM attempt_sessions WHERE id = ?`,
              [initial.id]
            );
            return rows[0] ?? null;
          },
          { timeout: 30_000, message: "student attempt credential is refreshed after expiry" }
        )
        .toMatchObject({ future: 1 });
      const refreshedRows = await queryDb<AttemptSession>(
        `SELECT s.id, s.attempt_id, s.token_id,
                TIMESTAMPDIFF(SECOND, s.issued_at, s.expires_at) AS ttl_seconds
           FROM attempt_sessions s WHERE s.id = ?`,
        [initial.id]
      );
      expect(refreshedRows[0]?.token_id).not.toBe(initial.token_id);
      expect(refreshedRows[0]?.ttl_seconds).toBe(ATTEMPT_TOKEN_TTL_SECONDS);
    } finally {
      await context.close();
    }
  });
});


test("a sitting grant keeps saving and reloads answers after account expiry", async ({ browser }, testInfo) => {
  test.skip(process.env["EXAM_ACCESS_ENABLED"] !== "true", "Requires the isolated sitting-grant qualification profile.");
  // Emulated touch devices never buffer the listening track without a user
  // gesture, so the IELTS listening readiness gate (unrelated to credentials)
  // never opens; the seeded sitting also has a single writer per run. Real
  // iPad qualification stays a manual rollout step (plan section 7).
  test.skip(testInfo.project.name === "continuity-tablet", "Listening readiness needs a gesture on touch devices; qualify on a real iPad.");
  test.setTimeout(150_000);
  const manifest = readBackendE2EManifest();
  const scheduleId = manifest.student.ieltsPersonalResilienceScheduleId;
  const candidateId = manifest.student.candidateId;
  const context = await browser.newContext({ storageState: STUDENT_STORAGE_STATE_PATH });
  await stubScreenDetails(context);
  const page = await context.newPage();
  try {
    await studentCheckIn(page, scheduleId, { wcode: candidateId, email: STUDENT_EMAIL, fullName: "Alice Candidate" });
    await openStudentSessionWithRetry(page, scheduleId, candidateId);
    await completePreCheckIfPresent(page);
    await startLobbyIfPresent(page);
    await openStudentSessionWithRetry(page, scheduleId, candidateId);
    const answer = page.getByLabel("Answer for question 1");
    await expect(answer).toBeVisible({ timeout: 30_000 });
    await answer.fill("before-account-expiry");
    await answer.blur();
    const cookie = (await context.cookies()).find((entry) => entry.name === STUDENT_SESSION_COOKIE);
    expect(cookie).toBeDefined();
    const grants = await queryDb<{ id: string; attempt_id: string; token_id: string; credential_policy: string; ttl_seconds: number }>(
      `SELECT id, attempt_id, token_id, credential_policy, TIMESTAMPDIFF(SECOND, issued_at, expires_at) AS ttl_seconds FROM attempt_sessions WHERE schedule_id = ? AND revoked_at IS NULL AND client_session_id = (SELECT active_client_session_id FROM student_attempts WHERE id = attempt_sessions.attempt_id) AND account_session_id = (SELECT id FROM user_sessions WHERE session_token_hash = ?)`, [scheduleId, tokenHash(cookie!.value)],
    );
    expect(grants).toHaveLength(1);
    const grant = grants[0]!;
    expect(grant.credential_policy).toBe("sitting_v1");
    expect(grant.ttl_seconds).toBe(12 * 60 * 60);
    await expect.poll(async () => {
      const rows = await queryDb<{ answer: string }>("SELECT JSON_UNQUOTE(JSON_EXTRACT(response, '$.answer')) AS answer FROM attempt_responses_v2 WHERE attempt_id = ? AND question_id = ?", [grant.attempt_id, manifest.student.questionId]);
      return rows[0]?.answer;
    }, { timeout: 30_000 }).toBe("before-account-expiry");
    await executeUpdate("UPDATE user_sessions SET expires_at = TIMESTAMPADD(SECOND, -5, UTC_TIMESTAMP(6)) WHERE session_token_hash = ?", [tokenHash(cookie!.value)]);
    expect((await page.request.get("/api/v1/auth/session")).status()).toBe(401);
    await answer.fill("after-account-expiry");
    await answer.blur();
    await expect.poll(async () => {
      const rows = await queryDb<{ answer: string }>("SELECT JSON_UNQUOTE(JSON_EXTRACT(response, '$.answer')) AS answer FROM attempt_responses_v2 WHERE attempt_id = ? AND question_id = ?", [grant.attempt_id, manifest.student.questionId]);
      return rows[0]?.answer;
    }, { timeout: 30_000 }).toBe("after-account-expiry");
    await page.reload();
    await expect(page.getByLabel("Answer for question 1")).toHaveValue("after-account-expiry", { timeout: 30_000 });
    await page.getByLabel("Answer for question 1").fill("after-reload-with-expired-login");
    await page.getByLabel("Answer for question 1").blur();
    await expect.poll(async () => {
      const rows = await queryDb<{ answer: string }>("SELECT JSON_UNQUOTE(JSON_EXTRACT(response, '$.answer')) AS answer FROM attempt_responses_v2 WHERE attempt_id = ? AND question_id = ?", [grant.attempt_id, manifest.student.questionId]);
      return rows[0]?.answer;
    }, { timeout: 30_000 }).toBe("after-reload-with-expired-login");
    const after = await queryDb<{ token_id: string }>("SELECT token_id FROM attempt_sessions WHERE id = ?", [grant.id]);
    expect(after[0]?.token_id).toBe(grant.token_id);
  } finally {
    await context.close();
    await closeDb();
  }
});

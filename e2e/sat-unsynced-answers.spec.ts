import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH } from "./support/backendE2e";
import { closeDb, executeUpdate, queryDb } from "./support/db";
import { createRunningSatSession } from "./support/satStudentSession";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

/**
 * Unsynced-answer behaviour on a real SAT sitting
 * (docs/plans/2026-10-31-sat-unsynced-answer-resilience.md).
 *
 * The save endpoint is failed at the browser boundary so the real durability
 * engine, banner and evidence path run; only the transport is faulted.
 */

const BATCH_ROUTE = "**/v2/student/attempts/*/responses:batch";
const UNSYNCED_NOTICE = "sat-unsynced-notice";

test.describe("SAT unsynced answers", () => {
  test.describe.configure({ timeout: 240_000 });
  test.afterAll(async () => {
    await closeDb();
  });

  test("shows the unsynced warning and clears it after the retry lands", async ({ page, browser }) => {
    const { studentContext, studentPage } = await createRunningSatSession(browser, page, {
      label: "unsynced-visible",
    });
    try {
      await studentPage.route(BATCH_ROUTE, (route) => route.abort("failed"));
      await studentPage.locator("label.sat-answer-choice").first().click();

      const notice = studentPage.getByTestId(UNSYNCED_NOTICE);
      await expect(notice).toBeVisible({ timeout: 15_000 });
      await expect(notice).toContainText("Still saving your last answers");
      await expect(notice).toHaveAttribute("role", "status");
      await expect(studentPage.getByTestId("sat-exam-shell")).toHaveAttribute(
        "data-sat-save-state",
        "stalled",
      );
      await expect(notice.getByRole("button", { name: "Dismiss message" })).toBeVisible();

      await studentPage.unroute(BATCH_ROUTE);
      await expect(studentPage.getByTestId("sat-exam-shell")).toHaveAttribute(
        "data-sat-save-state",
        "idle",
        { timeout: 30_000 },
      );
      await expect(notice).toHaveCount(0);
    } finally {
      await studentContext.close();
    }
  });

  test("dismisses the warning and reopens it on the offline escalation", async ({ page, browser }) => {
    const { studentContext, studentPage } = await createRunningSatSession(browser, page, {
      label: "unsynced-dismiss",
    });
    try {
      await studentPage.route(BATCH_ROUTE, (route) => route.abort("failed"));
      await studentPage.locator("label.sat-answer-choice").first().click();

      const notice = studentPage.getByTestId(UNSYNCED_NOTICE);
      await expect(notice).toBeVisible({ timeout: 15_000 });
      await notice.getByRole("button", { name: "Dismiss message" }).click();
      await expect(notice).toHaveCount(0);

      // VITE_SAT_UNSYNCED_OFFLINE_MS is 4500 in the E2E web server; escalation
      // is a new dismissal key, so the closed slow strip must reopen.
      await expect(studentPage.getByTestId(UNSYNCED_NOTICE)).toBeVisible({ timeout: 10_000 });
      await expect(studentPage.getByTestId(UNSYNCED_NOTICE)).toContainText("only on this device");

      await studentPage.getByTestId(UNSYNCED_NOTICE)
        .getByRole("button", { name: "Dismiss message" })
        .click();
      await expect(studentPage.getByTestId(UNSYNCED_NOTICE)).toHaveCount(0);

      // A new answer in the same window must not reopen a banner the student
      // just closed; only escalation or a new window does.
      await studentPage.getByRole("button", { name: "Next question", exact: true }).click();
      await studentPage.locator("label.sat-answer-choice").first().click();
      await expect(studentPage.getByTestId(UNSYNCED_NOTICE)).toHaveCount(0);

      await studentPage.unroute(BATCH_ROUTE);
      await expect(studentPage.getByTestId("sat-exam-shell")).toHaveAttribute(
        "data-sat-save-state",
        "idle",
        { timeout: 30_000 },
      );
    } finally {
      await studentContext.close();
    }
  });

  test("records only genuinely unsent writes as late evidence", async ({ page, browser }) => {
    const { studentContext, studentPage, scheduleId, candidateId } = await createRunningSatSession(
      browser,
      page,
      { label: "unsynced-evidence" },
    );
    try {
      const attempts = await queryDb<{ id: string }>(
        "SELECT id FROM student_attempts WHERE schedule_id = ? AND candidate_id = ? ORDER BY created_at DESC LIMIT 1",
        [scheduleId, candidateId],
      );
      const attemptId = attempts[0]?.id;
      expect(attemptId, "the created sitting must have an attempt row").toBeTruthy();

      // A confirmed answer first. It must never appear in late evidence.
      await studentPage.locator("label.sat-answer-choice").first().click();
      await expect(studentPage.getByTestId("sat-exam-shell")).toHaveAttribute(
        "data-sat-save-state",
        "idle",
        { timeout: 30_000 },
      );
      const confirmed = await queryDb<{ question_id: string }>(
        "SELECT question_id FROM attempt_responses_v2 WHERE attempt_id = ? ORDER BY updated_at DESC LIMIT 1",
        [attemptId!],
      );
      const confirmedQuestionId = confirmed[0]?.question_id;
      expect(confirmedQuestionId).toBeTruthy();

      // A second answer is held on the device while the server is unreachable.
      await studentPage.route(BATCH_ROUTE, (route) => route.abort("failed"));
      await studentPage.getByRole("button", { name: "Next question", exact: true }).click();
      await studentPage.locator("label.sat-answer-choice").first().click();

      // Shorten the active module; the server closes it and the browser seals
      // what it could not send. The client's own clock still has time, which is
      // exactly the suspended/offline case this test reproduces.
      const active = await queryDb<{ id: string }>(
        "SELECT id FROM assessment_module_attempts WHERE attempt_id = ? AND state = 'active' ORDER BY started_at DESC LIMIT 1",
        [attemptId!],
      );
      expect(active[0]?.id).toBeTruthy();
      await executeUpdate(
        "UPDATE assessment_module_attempts SET allocated_seconds = GREATEST(1, TIMESTAMPDIFF(SECOND, started_at, UTC_TIMESTAMP(6)) + 5) WHERE id = ?",
        [active[0]!.id],
      );

      await expect
        .poll(async () => {
          const rows = await queryDb<{ n: number }>(
            "SELECT COUNT(*) AS n FROM assessment_late_answer_evidence WHERE attempt_id = ?",
            [attemptId!],
          );
          return rows[0]?.n ?? 0;
        }, { timeout: 60_000 })
        .toBeGreaterThan(0);

      const evidence = await queryDb<{ question_id: string; write_id: string }>(
        "SELECT question_id, write_id FROM assessment_late_answer_evidence WHERE attempt_id = ?",
        [attemptId!],
      );
      const scored = await queryDb<{ question_id: string; client_write_id: string }>(
        "SELECT question_id, client_write_id FROM attempt_responses_v2 WHERE attempt_id = ?",
        [attemptId!],
      );

      expect(evidence.some((row) => row.question_id === confirmedQuestionId)).toBe(false);
      expect(scored.some((row) => row.question_id === confirmedQuestionId)).toBe(true);
      for (const row of evidence) {
        expect(
          scored.some((scoredRow) => scoredRow.question_id === row.question_id && scoredRow.client_write_id === row.write_id),
          "a scored write must never be uploaded as late evidence",
        ).toBe(false);
      }

      await studentPage.unroute(BATCH_ROUTE);
      await expect(studentPage.getByTestId("sat-exam-shell")).toHaveAttribute(
        "data-sat-save-state",
        "idle",
        { timeout: 30_000 },
      );
    } finally {
      await studentContext.close();
    }
  });
});

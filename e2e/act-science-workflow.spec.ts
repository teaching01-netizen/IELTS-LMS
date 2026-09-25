import { expect, test } from "@playwright/test";
import {
  ADMIN_STORAGE_STATE_PATH,
  readBackendE2EManifest,
  STUDENT_STORAGE_STATE_PATH,
} from "./support/backendE2e";
import { closeDb, queryDb } from "./support/db";
import { proctorEndSection } from "./support/proctorControls";
import {
  completePreCheckIfPresent,
  openStudentSessionWithRetry,
  startLobbyIfPresent,
  studentCheckIn,
  stubScreenDetails,
} from "./support/studentUi";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

function jsonContainsValue(value: unknown, expected: string): boolean {
  if (typeof value === "string") {
    try {
      return jsonContainsValue(JSON.parse(value), expected);
    } catch {
      return value === expected;
    }
  }
  if (Array.isArray(value)) {
    return value.some((entry) => jsonContainsValue(entry, expected));
  }
  if (value && typeof value === "object") {
    return Object.values(value).some((entry) => jsonContainsValue(entry, expected));
  }
  return value === expected;
}

test.describe("ACT Science workflow", () => {
  test.describe.configure({ timeout: 120_000 });

  test.afterAll(async () => {
    await closeDb();
  });

  test("renders, saves, terminalizes, scores, and reports an ACT Science attempt", async ({
    browser,
    page,
  }) => {
    const manifest = readBackendE2EManifest();
    const { scheduleId, candidateId, questionId, expectedAnswer } = manifest.act;
    expect(scheduleId).toBeTruthy();

    const studentContext = await browser.newContext({
      storageState: STUDENT_STORAGE_STATE_PATH,
    });
    await stubScreenDetails(studentContext);
    const studentPage = await studentContext.newPage();

    try {
      await studentCheckIn(studentPage, scheduleId, {
        wcode: candidateId,
        email: "e2e.student@example.com",
        fullName: "Alice Candidate",
      });
      await openStudentSessionWithRetry(studentPage, scheduleId, candidateId);
      await completePreCheckIfPresent(studentPage);
      await startLobbyIfPresent(studentPage);
      await expect(studentPage.getByTestId("student-exam-shell")).toBeVisible({ timeout: 30_000 });
      await expect(studentPage.getByText("ACT", { exact: true }).first()).toBeVisible();
      await expect(studentPage.getByText("Seeded ecology experiment")).toBeVisible();
      await expect(
        studentPage.getByText("Which condition produced the greatest plant growth?").first()
      ).toBeVisible();

      const options = studentPage.locator('input[type="radio"]');
      await expect(options).toHaveCount(4);
      await options.first().check();
      await expect
        .poll(
          async () => {
            const rows = await queryDb<{ answers: unknown }>(
              "SELECT answers FROM student_attempts WHERE schedule_id = ? AND candidate_id = ?",
              [scheduleId, candidateId]
            );
            return Boolean(rows[0] && jsonContainsValue(rows[0].answers, expectedAnswer));
          },
          { timeout: 30_000, message: "ACT Science answer is saved by the Go delivery API" }
        )
        .toBe(true);

      await proctorEndSection(page.context(), scheduleId, "science", "complete ACT Science");
      await expect
        .poll(
          async () => {
            const rows = await queryDb<{ status: string }>(
              "SELECT status FROM exam_session_runtimes WHERE schedule_id = ?",
              [scheduleId]
            );
            return rows[0]?.status ?? null;
          },
          { timeout: 30_000, message: "ACT runtime is terminalized" }
        )
        .toBe("completed");

      await expect
        .poll(
          async () => {
            const rows = await queryDb<{
              phase: string;
              submitted_at: string | null;
              final_submission: unknown;
            }>(
              "SELECT phase, submitted_at, final_submission FROM student_attempts WHERE schedule_id = ? AND candidate_id = ?",
              [scheduleId, candidateId]
            );
            const row = rows[0];
            return Boolean(
              row &&
              row.phase === "post-exam" &&
              row.submitted_at &&
              jsonContainsValue(row.final_submission, expectedAnswer)
            );
          },
          { timeout: 30_000, message: "ACT server score is persisted with the terminal snapshot" }
        )
        .toBe(true);

      await studentPage.goto(`/student/${scheduleId}/${candidateId}`);
      await expect(
        studentPage.getByRole("heading", { name: /ACT Science Complete!/i })
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        studentPage.getByRole("alertdialog", { name: "Submitting your exam" })
      ).not.toBeVisible({ timeout: 5_000 });

      const reportResponse = await page.request.get(
        `/api/v1/results/act-science?scheduleId=${encodeURIComponent(scheduleId)}`
      );
      expect(reportResponse.ok()).toBeTruthy();
      const reportPayload = (await reportResponse.json()) as {
        data?: Array<{
          attemptId: string;
          totalScore: number;
          maxScore: number;
          percentage: number;
        }>;
      } & Array<{ attemptId: string; totalScore: number; maxScore: number; percentage: number }>;
      const reports = Array.isArray(reportPayload) ? reportPayload : (reportPayload.data ?? []);
      const report = reports.find((item) => item.attemptId);
      if (!report) {
        throw new Error(
          `ACT report payload did not contain a row: ${JSON.stringify(reportPayload)}`
        );
      }
      expect(report).toEqual(
        expect.objectContaining({ totalScore: 1, maxScore: 1, percentage: 100 })
      );

      await page.goto("/admin/results");
      await expect(page.getByRole("heading", { name: /Results & Analytics/i })).toBeVisible();
      await page.getByLabel("Filter by provider").selectOption("act");
      const resultRow = page
        .locator("tr[data-result-card]")
        .filter({ hasText: "ACT Science Backend E2E" });
      await expect(resultRow).toBeVisible({ timeout: 30_000 });
      await expect(resultRow).toContainText("1/1");
      await resultRow.getByRole("button", { name: "View Report" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toHaveText(/ACT Science result/);
      await expect(dialog).toHaveText(/100\.0% correct/);
    } finally {
      await studentContext.close();
    }
  });
});

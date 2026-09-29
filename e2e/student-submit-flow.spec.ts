import { expect, test } from "@playwright/test";
import { readBackendE2EManifest } from "./support/backendE2e";
import { closeDb, executeUpdate, queryDb } from "./support/db";
import {
  newAdminControlContext,
  proctorEndSection,
  proctorStartExam,
} from "./support/proctorControls";
import {
  completePreCheckIfPresent,
  deterministicWcode,
  openStudentSessionWithRetry,
  startLobbyIfPresent,
  studentCheckIn,
  stubScreenDetails,
} from "./support/studentUi";

async function waitForSavedBanner(page: import("@playwright/test").Page) {
  await expect
    .poll(
      async () => {
        const banner = page.getByRole("banner");
        return banner
          .getByText("Saved")
          .isVisible()
          .catch(() => false);
      },
      { timeout: 30_000, message: "student answer is acknowledged as saved" }
    )
    .toBe(true);
}

test.describe("Student submission flow (Go runtime)", () => {
  test.describe.configure({ timeout: 240_000 });

  test.afterAll(async () => {
    await closeDb();
  });

  test("saved IELTS answers survive a listening timeout before Reading and final auto-submit", async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const scheduleId = manifest.student.submissionScheduleId;
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    const email = `submission-${wcode.toLowerCase()}@example.com`;

    const adminContext = await newAdminControlContext(browser);
    const studentContext = await browser.newContext();
    await stubScreenDetails(studentContext);
    const studentPage = await studentContext.newPage();

    await studentCheckIn(studentPage, scheduleId, {
      wcode,
      email,
      fullName: "Submission Flow Candidate",
    });
    await completePreCheckIfPresent(studentPage);
    await openStudentSessionWithRetry(studentPage, scheduleId, wcode);

    await proctorStartExam(adminContext, scheduleId);
    await startLobbyIfPresent(studentPage);
    await openStudentSessionWithRetry(studentPage, scheduleId, wcode);

    await studentPage.getByLabel("Answer for question 1").fill("saved before proctor submit");
    await waitForSavedBanner(studentPage);

    // Expire the active Listening section without a proctor command. The worker
    // must reconcile the server-owned deadline, preserve the acknowledged answer,
    // and move the same student session into Reading.
    const expiredListeningSection = await executeUpdate(
      `UPDATE exam_session_runtime_sections rs
       JOIN exam_session_runtimes r ON r.id = rs.runtime_id
          SET rs.actual_start_at = NOW(6) - INTERVAL 2 MINUTE,
              rs.planned_duration_minutes = 1,
              rs.extension_minutes = 0,
              rs.accumulated_paused_seconds = 0
        WHERE r.schedule_id = ?
          AND rs.section_key = 'listening'
          AND rs.status = 'live'`,
      [scheduleId]
    );
    expect(expiredListeningSection).toBe(1);

    await expect
      .poll(
        async () => {
          const rows = await queryDb<{ active_section_key: string | null }>(
            "SELECT active_section_key FROM exam_session_runtimes WHERE schedule_id = ?",
            [scheduleId]
          );
          return rows[0]?.active_section_key ?? null;
        },
        { timeout: 30_000, message: "worker advances the expired Listening runtime to Reading" }
      )
      .toBe("reading");
    await expect(studentPage.getByText("Write the missing word from the passage.")).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(
        async () => {
          const rows = await queryDb<{ answers: unknown }>(
            "SELECT answers FROM student_attempts WHERE schedule_id = ? AND candidate_email = ?",
            [scheduleId, email]
          );
          return JSON.stringify(rows[0]?.answers ?? "").includes("saved before proctor submit");
        },
        { timeout: 30_000, message: "the acknowledged Listening answer remains persisted" }
      )
      .toBe(true);

    // Runtime-backed IELTS delivery has no student Finish action. The
    // authoritative submit is the proctor's final section transition.
    await expect(studentPage.getByRole("button", { name: "Finish" })).toHaveCount(0);
    await proctorEndSection(adminContext, scheduleId, "reading", "advance reading");
    await expect(studentPage.getByText(/Task 1: Summarise/).first()).toBeVisible({
      timeout: 60_000,
    });
    await proctorEndSection(adminContext, scheduleId, "writing", "complete exam");

    await expect(studentPage.getByText(/Examination Complete!/i)).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(
        async () => {
          const rows = await queryDb<{ phase: string; submitted_at: string | null }>(
            "SELECT phase, submitted_at FROM student_attempts WHERE schedule_id = ? AND candidate_email = ?",
            [scheduleId, email]
          );
          return (
            rows.length === 1 && rows[0]?.phase === "post-exam" && rows[0].submitted_at !== null
          );
        },
        { timeout: 120_000, message: "Go worker auto-submits the student attempt" }
      )
      .toBe(true);

    await studentContext.close();
    await adminContext.close();
  });
});

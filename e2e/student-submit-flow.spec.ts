import { expect, test } from "@playwright/test";
import { readBackendE2EManifest } from "./support/backendE2e";
import { closeDb, queryDb } from "./support/db";
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

  test("student saves answers and the proctor-owned runtime auto-submits the attempt", async ({
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

    // Runtime-backed IELTS delivery has no student Finish action. The
    // authoritative submit is the proctor's final section transition.
    await expect(studentPage.getByRole("button", { name: "Finish" })).toHaveCount(0);
    await proctorEndSection(adminContext, scheduleId, "listening", "advance listening");
    await expect(studentPage.getByText("Write the missing word from the passage.")).toBeVisible({
      timeout: 60_000,
    });
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

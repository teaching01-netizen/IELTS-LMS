import { expect, test } from "@playwright/test";
import { readBackendE2EManifest } from "./support/backendE2e";
import {
  completePreCheckIfPresent,
  deterministicWcode,
  openStudentSessionWithRetry,
  startLobbyIfPresent,
  studentCheckIn,
  stubScreenDetails,
} from "./support/studentUi";
import { closeDb, queryDb } from "./support/db";
import {
  newAdminControlContext,
  proctorEndSection,
  proctorStartExam,
} from "./support/proctorControls";

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

async function waitForAttemptResponse(
  scheduleId: string,
  candidateEmail: string,
  expected: string,
  message: string
) {
  await expect
    .poll(
      async () => {
        const rows = await queryDb<{
          answers: unknown;
          writing_answers: unknown;
        }>(
          "SELECT answers, writing_answers FROM student_attempts WHERE schedule_id = ? AND candidate_email = ?",
          [scheduleId, candidateEmail]
        );
        const row = rows[0];
        return Boolean(
          row &&
          (jsonContainsValue(row.answers, expected) ||
            jsonContainsValue(row.writing_answers, expected))
        );
      },
      { timeout: 30_000, message }
    )
    .toBe(true);
}

test.describe("Full browser lifecycle", () => {
  test.describe.configure({ timeout: 240_000 });

  test.afterAll(async () => {
    await closeDb();
  });

  test("activates an admin account, signs in, exercises the student route, and starts password recovery", async ({
    browser,
    page,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();

    await page.goto(`/activate?token=${manifest.auth.adminLifecycle.activationToken}`);
    await page.getByLabel("Display Name").fill("Admin Lifecycle");
    await page
      .getByLabel("Password", { exact: true })
      .fill(manifest.auth.adminLifecycle.activationPassword);
    await page.getByLabel("Confirm Password").fill(manifest.auth.adminLifecycle.activationPassword);
    await page.getByRole("button", { name: "Activate Account" }).click();
    await expect(page).toHaveURL(/\/admin\/exams$/);

    const loginContext = await browser.newContext();
    const loginPage = await loginContext.newPage();
    await loginPage.goto("/login");
    await loginPage.getByLabel("Email Address").fill(manifest.auth.adminLifecycle.email);
    await loginPage
      .getByLabel("Password", { exact: true })
      .fill(manifest.auth.adminLifecycle.activationPassword);
    await loginPage.getByRole("button", { name: "Sign In" }).click();
    await expect(loginPage).toHaveURL(/\/admin\/exams$/);

    await loginPage.goto("/admin/scheduling");
    await expect(loginPage.getByRole("heading", { name: "Exam Scheduler" })).toBeVisible();

    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    const studentContext = await browser.newContext();
    await stubScreenDetails(studentContext);
    const studentPage = await studentContext.newPage();
    await studentCheckIn(studentPage, manifest.student.lifecycleScheduleId, {
      wcode,
      email: `e2e+${wcode.toLowerCase()}@example.com`,
      fullName: "E2E Candidate",
    });

    await completePreCheckIfPresent(studentPage);
    await proctorStartExam(loginContext, manifest.student.lifecycleScheduleId);
    await studentPage.reload();
    await openStudentSessionWithRetry(studentPage, manifest.student.lifecycleScheduleId, wcode);
    await expect(
      studentPage.getByLabel("Answer for question 1").filter({ visible: true })
    ).toBeVisible();

    const resetContext = await browser.newContext();
    const resetPage = await resetContext.newPage();
    await resetPage.goto("/password/reset");
    await resetPage.getByLabel("Email Address").fill(manifest.auth.adminLifecycle.email);
    await resetPage.getByRole("button", { name: "Request Reset Link" }).click();

    await resetPage.goto(
      `/password/reset/complete?token=${manifest.auth.adminLifecycle.passwordResetToken}`
    );
    await resetPage
      .getByLabel("New Password", { exact: true })
      .fill(manifest.auth.adminLifecycle.passwordResetPassword);
    await resetPage
      .getByLabel("Confirm New Password", { exact: true })
      .fill(manifest.auth.adminLifecycle.passwordResetPassword);
    await resetPage.getByRole("button", { name: "Update Password" }).click();
    await expect(resetPage).toHaveURL(/\/admin\/exams$/);

    await studentContext.close();
    await loginContext.close();
    await resetContext.close();
  });

  test("completes full exam lifecycle from registration to grading", async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    const scheduleId = manifest.student.lifecycleScheduleId;
    const email = `lifecycle-${wcode.toLowerCase()}@example.com`;

    // Step 1: Student registration
    const studentContext = await browser.newContext();
    await stubScreenDetails(studentContext);
    const studentPage = await studentContext.newPage();
    const adminControlContext = await newAdminControlContext(browser);
    await studentCheckIn(studentPage, scheduleId, {
      wcode,
      email,
      fullName: "Lifecycle Test Student",
    });

    // Step 2: Complete pre-check
    await completePreCheckIfPresent(studentPage);

    // Step 3: Runtime progression and terminalization are authoritative
    // proctor actions in the Go-backed delivery contract.
    await openStudentSessionWithRetry(studentPage, scheduleId, wcode);
    await proctorStartExam(adminControlContext, scheduleId);
    await startLobbyIfPresent(studentPage);
    await openStudentSessionWithRetry(studentPage, scheduleId, wcode);
    await studentPage
      .getByLabel("Answer for question 1")
      .filter({ visible: true })
      .fill("lifecycle test answer");
    await waitForAttemptResponse(
      scheduleId,
      email,
      "lifecycle test answer",
      "listening answer is saved"
    );
    await proctorEndSection(adminControlContext, scheduleId, "listening", "advance listening");
    await expect(studentPage.getByText("Write the missing word from the passage.")).toBeVisible({
      timeout: 60_000,
    });
    await studentPage
      .getByLabel("Answer for question 1")
      .filter({ visible: true })
      .fill("lifecycle reading answer");
    await waitForAttemptResponse(
      scheduleId,
      email,
      "lifecycle reading answer",
      "reading answer is saved"
    );
    await proctorEndSection(adminControlContext, scheduleId, "reading", "advance reading");
    await expect(studentPage.getByText(/Task 1: Summarise/).first()).toBeVisible({
      timeout: 60_000,
    });
    const writingEditor = studentPage.getByLabel("Writing response");
    await writingEditor.fill("Lifecycle writing response");
    await writingEditor.blur();
    await waitForAttemptResponse(
      scheduleId,
      email,
      "Lifecycle writing response",
      "writing answer is saved"
    );
    await proctorEndSection(adminControlContext, scheduleId, "writing", "complete exam");
    await expect(studentPage.getByText(/Examination Complete!/i)).toBeVisible({
      timeout: 60_000,
    });

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
        { timeout: 120_000, message: "Go worker finalizes the lifecycle attempt" }
      )
      .toBe(true);

    await adminControlContext.close();
    await studentContext.close();

    // Step 4: Admin grades the submission
    const adminContext = await browser.newContext({
      storageState: process.env.ADMIN_STORAGE_STATE || "./e2e/.generated/admin.storage-state.json",
    });
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/admin/grading");
    await expect(adminPage.getByRole("heading", { name: "Grading Queue" })).toBeVisible();
    await adminPage.getByPlaceholder("Search by exam or cohort...").fill("Backend E2E Lifecycle");
    const sessionRow = adminPage
      .locator("tbody tr")
      .filter({ hasText: "Backend E2E Lifecycle" })
      .first();
    await expect(sessionRow).toBeVisible({ timeout: 60_000 });
    await sessionRow.getByRole("button", { name: /Open grading session/ }).click();
    await expect(adminPage.getByText("Backend E2E Lifecycle").first()).toBeVisible();
    const studentRow = adminPage
      .locator("tbody tr")
      .filter({ hasText: "Lifecycle Test Student" })
      .first();
    await expect(studentRow).toBeVisible({ timeout: 60_000 });
    await studentRow.getByRole("button", { name: "Review" }).click();
    await expect(adminPage.getByText("Release Workflow")).toBeVisible({ timeout: 60_000 });
    await adminPage.getByRole("button", { name: "Mark Grading Complete" }).click();
    await expect(adminPage.getByRole("button", { name: "Mark Ready to Release" })).toBeVisible({
      timeout: 30_000,
    });
    await adminPage.getByRole("button", { name: "Mark Ready to Release" }).click();
    await expect(adminPage.getByRole("button", { name: "Release Now" })).toBeVisible({
      timeout: 30_000,
    });
    await adminPage.getByRole("button", { name: "Release Now" }).click();
    const releaseOverride = adminPage.getByRole("button", { name: "Release anyway" });
    if (await releaseOverride.isVisible().catch(() => false)) {
      await releaseOverride.click();
    }
    await expect(adminPage.getByText("Released", { exact: true }).last()).toBeVisible({
      timeout: 60_000,
    });

    // The admin results surface must read the released snapshot rather than
    // render a provider-agnostic placeholder row.
    await adminPage.goto("/admin/results");
    await expect(adminPage.getByRole("heading", { name: "Results & Analytics" })).toBeVisible({
      timeout: 60_000,
    });
    const resultCard = adminPage
      .locator("[data-result-card]")
      .filter({ hasText: "Lifecycle Test Student" })
      .first();
    await expect(resultCard).toBeVisible({ timeout: 60_000 });
    await expect(resultCard).toContainText("IELTS");
    await resultCard.getByRole("button", { name: "View Report" }).click();
    await expect(adminPage.getByRole("dialog")).toContainText("Lifecycle Test Student");

    await adminContext.close();
  });

  test("verifies end-to-end audit trail across all roles", async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    // Student telemetry is written by the Go audit boundary.
    // Student takes an action
    const studentContext = await browser.newContext();
    await stubScreenDetails(studentContext);
    const studentPage = await studentContext.newPage();
    const scheduleId = manifest.student.submissionScheduleId;
    await studentCheckIn(studentPage, scheduleId, {
      wcode,
      email: `e2e+${wcode.toLowerCase()}@example.com`,
      fullName: "E2E Candidate",
    });
    await completePreCheckIfPresent(studentPage);
    const adminControlContext = await newAdminControlContext(browser);
    await openStudentSessionWithRetry(studentPage, scheduleId, wcode);
    await proctorStartExam(adminControlContext, scheduleId);
    await startLobbyIfPresent(studentPage);
    await openStudentSessionWithRetry(studentPage, scheduleId, wcode);
    await studentPage
      .getByLabel("Answer for question 1")
      .filter({ visible: true })
      .fill("audit trail test");
    await waitForAttemptResponse(
      scheduleId,
      `e2e+${wcode.toLowerCase()}@example.com`,
      "audit trail test",
      "audit trail answer is saved"
    );

    await expect
      .poll(
        async () => {
          const rows = await queryDb<{ action_type: string }>(
            "SELECT action_type FROM session_audit_logs WHERE schedule_id = ? ORDER BY created_at DESC",
            [scheduleId]
          );
          return rows.map((row) => row.action_type);
        },
        { timeout: 30_000, message: "student telemetry is written to the Go audit boundary" }
      )
      .toEqual(expect.arrayContaining(["PRECHECK_COMPLETED", "STUDENT_MUTATION_BATCH"]));

    const auditRows = await queryDb<{ action_type: string }>(
      "SELECT action_type FROM session_audit_logs WHERE schedule_id = ? ORDER BY created_at DESC",
      [scheduleId]
    );
    expect(auditRows.map((row) => row.action_type)).toEqual(
      expect.arrayContaining(["PRECHECK_COMPLETED", "STUDENT_MUTATION_BATCH"])
    );

    await studentContext.close();
    await adminControlContext.close();
  });

  test("handles cross-role session state persistence", async ({ browser }) => {
    const manifest = readBackendE2EManifest();

    // Admin creates a schedule
    const adminContext = await browser.newContext({
      storageState: process.env.ADMIN_STORAGE_STATE || "./e2e/.generated/admin.storage-state.json",
    });
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/admin/scheduling");
    await adminPage.getByRole("button", { name: "New Session" }).click();
    await expect(adminPage.getByRole("heading", { name: "Schedule New Session" })).toBeVisible();
    // The scheduler defaults to the first exam in the library, which is not
    // guaranteed to have a publishable version after a migration. Pin this
    // cross-role check to the seeded published exam it later exercises.
    await adminPage.getByLabel("Select exam").selectOption({ value: manifest.student.examId });
    await adminPage.getByLabel("Select cohort").selectOption({ label: "Morning Batch B" });
    await adminPage.getByRole("button", { name: "Create Schedule" }).click();

    // Verify schedule appears in proctor dashboard
    const proctorContext = await browser.newContext({
      storageState: process.env.ADMIN_STORAGE_STATE || "./e2e/.generated/admin.storage-state.json",
    });
    const proctorPage = await proctorContext.newPage();
    await proctorPage.goto("/proctor");
    await expect(
      proctorPage.getByRole("button", {
        name: "Monitor Student Backend E2E Delivery for cohort Morning Batch B",
      })
    ).toBeVisible({ timeout: 60_000 });

    // Student can register for the schedule
    const studentContext = await browser.newContext();
    const studentPage = await studentContext.newPage();
    await studentPage.goto(`/student/${manifest.studentSelfPaced.scheduleId}`);
    await expect(studentPage.getByLabel("Code")).toBeVisible();

    await studentContext.close();
    await proctorContext.close();
    await adminContext.close();
  });
});

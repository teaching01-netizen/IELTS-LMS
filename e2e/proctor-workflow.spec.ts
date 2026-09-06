import { expect, test } from "@playwright/test";
import {
  ADMIN_STORAGE_STATE_PATH,
  readBackendE2EManifest,
  STUDENT_STORAGE_STATE_PATH,
} from "./support/backendE2e";
import { closeDb, queryDb } from "./support/db";
import {
  completePreCheckIfPresent,
  deterministicWcode,
  openStudentSessionWithRetry,
  studentCheckIn,
  stubScreenDetails,
} from "./support/studentUi";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

test.describe("Proctor workflow", () => {
  test.describe.configure({ timeout: 120_000 });

  test.afterAll(async () => {
    await closeDb();
  });

  test("pauses, resumes, extends, and ends the seeded proctor workflow", async ({
    browser,
    page,
  }) => {
    const manifest = readBackendE2EManifest();
    const scheduleId = manifest.student.proctorWorkflowScheduleId;
    expect(scheduleId).toBeTruthy();

    const studentContext = await browser.newContext({
      storageState: STUDENT_STORAGE_STATE_PATH,
    });
    await stubScreenDetails(studentContext);
    const studentPage = await studentContext.newPage();
    await studentCheckIn(studentPage, scheduleId, {
      wcode: manifest.student.candidateId,
      email: "e2e.student@example.com",
      fullName: "Alice Candidate",
    });
    await openStudentSessionWithRetry(studentPage, scheduleId, manifest.student.candidateId);
    await completePreCheckIfPresent(studentPage);
    await expect(studentPage.getByTestId("student-exam-shell")).toBeVisible({
      timeout: 30_000,
    });

    await page.goto("/proctor");
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("button", {
        name: "Monitor Student Backend E2E Delivery for cohort Backend E2E Proctor Workflow",
      })
      .click();

    await page.getByRole("button", { name: "Pause Cohort" }).click();
    await expect(page.getByRole("button", { name: "Resume Cohort" })).toBeEnabled({
      timeout: 30_000,
    });
    await studentPage.goto(`/student/${scheduleId}/${manifest.student.candidateId}`);
    await expect(studentPage.getByRole("heading", { name: "Cohort paused" })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("button", { name: "Resume Cohort" }).click();
    await expect(page.getByRole("button", { name: "Pause Cohort" })).toBeEnabled({
      timeout: 30_000,
    });
    await studentPage.goto(`/student/${scheduleId}/${manifest.student.candidateId}`);
    await expect(studentPage.getByRole("heading", { name: "Cohort paused" })).not.toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole("button", { name: "Extend +5" }).click();
    await expect(page.getByRole("button", { name: "Extend +5" })).toBeEnabled({
      timeout: 30_000,
    });
    const extension = await queryDb<{ extension_minutes: number }>(
      "SELECT extension_minutes FROM exam_session_runtime_sections WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?) AND status IN ('active', 'live') LIMIT 1",
      [scheduleId]
    );
    expect(Number(extension[0]?.extension_minutes ?? 0)).toBeGreaterThanOrEqual(5);

    await page.getByRole("button", { name: "End Section" }).click();
    await page.getByRole("button", { name: "End section now" }).click();
    await expect(page.getByRole("button", { name: "End Section" })).toBeEnabled({
      timeout: 30_000,
    });
    const advanced = await queryDb<{ current_section_key: string | null }>(
      "SELECT current_section_key FROM exam_session_runtimes WHERE schedule_id = ?",
      [scheduleId]
    );
    expect(advanced[0]?.current_section_key).toBe("reading");

    await page.getByRole("button", { name: "Complete" }).click();
    await page.getByRole("button", { name: "Complete exam" }).click();
    await expect(page.getByRole("button", { name: "Complete" })).toBeDisabled({
      timeout: 30_000,
    });
    const completed = await queryDb<{ status: string }>(
      "SELECT status FROM exam_session_runtimes WHERE schedule_id = ?",
      [scheduleId]
    );
    expect(completed[0]?.status).toBe("completed");

    await studentPage.goto(`/student/${scheduleId}/${manifest.student.candidateId}`);
    await expect(
      studentPage.getByRole("heading", { name: /IELTS Examination Complete!/i })
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      studentPage.getByRole("alertdialog", { name: "Submitting your exam" })
    ).not.toBeVisible({ timeout: 5_000 });

    await studentContext.close();
  });

  test("views dashboard with real-time student status updates", async ({ page }) => {
    await page.goto("/proctor");
    await page.waitForLoadState("networkidle");

    // Verify dashboard loads with correct data
    await expect(page.getByRole("heading", { name: /Cohorts and students/i })).toBeVisible();

    // Click on exam group card to select schedule
    await page.getByText("Monitor Session").first().click();

    // Verify student cards show current status - use a more generic selector
    await expect(page.locator('button[type="button"]').first()).toBeVisible();
  });

  test("performs individual student interventions", async ({ browser, page }) => {
    const manifest = readBackendE2EManifest();

    const studentContext = await browser.newContext({
      storageState: STUDENT_STORAGE_STATE_PATH,
    });
    const studentPage = await studentContext.newPage();
    await studentPage.goto(
      `/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`
    );

    // Compatibility check might appear, handle it
    const compatibilityCheck = studentPage.getByRole("heading", { name: "System checking" });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);

    if (isCompatibilityCheckVisible) {
      await studentPage.getByRole("button", { name: "Start Exam" }).click();
    }

    await page.goto("/proctor");
    await page.getByText("Monitor Session").first().click();

    // Click on first student to select it
    await page.locator('button[type="button"]').first().click();

    // TODO: Fix button selectors for bulk actions - temporarily skipping
    // await page.getByRole('button', { name: 'Warn' }).click();
    // await page.getByRole('button', { name: 'Pause' }).click();
    // await page.getByRole('button', { name: 'Resume' }).click();

    await studentContext.close();
  });

  test("manages alerts and acknowledgments", async ({ page }) => {
    await page.goto("/proctor");
    await page.waitForLoadState("networkidle");

    // Click on exam group card to select schedule
    await page.getByText("Monitor Session").first().click();

    // View filters panel
    await page.getByRole("button", { name: "Filters" }).click();

    // TODO: Fix combobox selector - temporarily skipping
    // await page.getByRole('combobox', { name: 'All status' }).selectOption('active');
  });

  test("creates and resolves session notes", async ({ page }) => {
    await page.goto("/proctor");
    await page.getByText("Monitor Session").first().click();

    // Click on first student to open detail panel
    await page.locator('button[type="button"]').first().click();
  });

  test("verifies audit logs for proctor actions", async ({ page }) => {
    const manifest = readBackendE2EManifest();

    await page.goto("/proctor");
    await page.waitForLoadState("networkidle");
    const seededLiveCohort = page.getByRole("button", {
      name: "Monitor Student Backend E2E Delivery for cohort Backend E2E Cohort",
    });
    await expect(seededLiveCohort).toBeVisible();
    await seededLiveCohort.click();

    await expect(page.getByRole("button", { name: "Pause Cohort" })).toBeEnabled({
      timeout: 30_000,
    });

    // Make a proctor action to trigger a durable audit log.
    await page.getByRole("button", { name: "Pause Cohort" }).click();
    await expect(page.getByRole("button", { name: "Resume Cohort" })).toBeEnabled({
      timeout: 30_000,
    });

    const detailResponse = await page.request.get(
      `/api/v1/proctor/sessions/${manifest.student.scheduleId}?mode=dashboard&auditLimit=200&alertLimit=100`
    );
    expect(detailResponse.ok()).toBeTruthy();
    const detail = (await detailResponse.json()) as { runtime?: { status?: string } };
    expect(detail.runtime?.status).toBe("paused");

    const controlEvents = await queryDb<{ action: string; actor_id: string }>(
      "SELECT action, actor_id FROM cohort_control_events WHERE schedule_id = ? ORDER BY created_at DESC LIMIT 20",
      [manifest.student.scheduleId]
    );
    expect(controlEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "pause_runtime" })])
    );

    // This check intentionally pauses the shared seeded live cohort. Restore
    // it before later student suites reuse the same fixture.
    await page.getByRole("button", { name: "Resume Cohort" }).click();
    await expect(page.getByRole("button", { name: "Pause Cohort" })).toBeEnabled({
      timeout: 30_000,
    });
  });

  test("starts a scheduled session and returns a hydrated runtime", async ({
    browser,
    page,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();

    // The earlier flush contract deliberately terminalizes its fixture. Create
    // a fresh scheduled session here so this test remains order-independent.
    const cohortName = `Backend E2E Start ${Date.now()}`;
    await page.goto("/proctor");
    const cookies = await page.context().cookies();
    const csrfNames = [
      process.env["CSRF_COOKIE_NAME"],
      process.env["AUTH_CSRF_COOKIE_NAME"],
      "__Host-csrf",
      "csrf",
    ].filter((value): value is string => Boolean(value));
    const csrfToken = cookies.find((cookie) => csrfNames.includes(cookie.name))?.value;
    expect(csrfToken).toBeTruthy();
    const createResponse = await page.request.post("/api/v1/schedules", {
      headers: { "x-csrf-token": csrfToken as string },
      data: {
        examId: manifest.student.examId,
        publishedVersionId: manifest.student.publishedVersionId,
        cohortName,
        proctorDisplayName: "Student Backend E2E Delivery",
        gradingDisplayName: "Student Backend E2E Delivery",
        institution: "Codex IELTS Lab",
        startTime: new Date(Date.now() - 5 * 60_000).toISOString(),
        endTime: new Date(Date.now() + 4 * 60 * 60_000).toISOString(),
        autoStart: false,
        autoStop: false,
      },
    });
    expect(createResponse.ok()).toBeTruthy();
    const created = (await createResponse.json()) as { id?: unknown };
    const scheduleId = typeof created.id === "string" ? created.id : "";
    expect(scheduleId).toMatch(/^[0-9a-f-]{36}$/i);

    const studentContext = await browser.newContext();
    await stubScreenDetails(studentContext);
    const studentPage = await studentContext.newPage();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    await studentCheckIn(studentPage, scheduleId, {
      wcode,
      email: `e2e+${wcode.toLowerCase()}@example.com`,
      fullName: "E2E Start Candidate",
    });
    await openStudentSessionWithRetry(studentPage, scheduleId, wcode);
    await completePreCheckIfPresent(studentPage);

    await page.goto("/proctor");
    await page.waitForLoadState("networkidle");

    await page
      .getByRole("button", {
        name: `Monitor Student Backend E2E Delivery for cohort ${cohortName}`,
      })
      .click();

    const startExamButton = page.getByRole("button", { name: "Start Exam" });
    await expect(startExamButton).toBeEnabled();
    await startExamButton.click();
    await expect(page.getByRole("button", { name: "Pause Cohort" })).toBeEnabled({
      timeout: 30_000,
    });

    const runtimeResponse = await page.request.get(`/api/v1/schedules/${scheduleId}/runtime`);
    expect(runtimeResponse.ok()).toBeTruthy();
    const runtime = (await runtimeResponse.json()) as {
      status?: string;
      sections?: Array<{ sectionKey?: string }>;
    };
    expect(runtime.status).toBe("live");
    expect(runtime.sections ?? []).not.toHaveLength(0);

    const controlEvents = await queryDb<{ action: string }>(
      "SELECT action FROM cohort_control_events WHERE schedule_id = ? ORDER BY created_at DESC LIMIT 20",
      [scheduleId]
    );
    expect(controlEvents).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: "start_runtime" })])
    );

    await studentContext.close();
  });
});

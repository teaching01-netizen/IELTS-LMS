import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  ADMIN_STORAGE_STATE_PATH,
  readBackendE2EManifest,
  STUDENT_STORAGE_STATE_PATH,
} from "./support/backendE2e";
import { closeDb, queryDb } from "./support/db";
import {
  completePreCheckIfPresent,
  openStudentSessionWithRetry,
  studentCheckIn,
  stubScreenDetails,
} from "./support/studentUi";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

type ProctorSessionDetail = {
  sessions: Array<{
    attemptId: string;
    studentId: string;
    status: string;
    warnings: number;
    violations: Array<{ type: string; description: string }>;
  }>;
  auditLogs: Array<{
    actionType: string;
    targetStudentId?: string | null;
  }>;
  notes: Array<{
    id: string;
    content: string;
    category: string;
    isResolved: boolean;
  }>;
};

async function readDetail(page: Page, scheduleId: string): Promise<ProctorSessionDetail> {
  const response = await page.request.get(
    `/api/v1/proctor/sessions/${scheduleId}?mode=dashboard&auditLimit=200&alertLimit=100`,
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as ProctorSessionDetail;
}

async function readAlice(detail: ProctorSessionDetail, candidateId: string) {
  const session = detail.sessions.find((entry) => entry.studentId === candidateId);
  expect(session).toBeTruthy();
  return session!;
}

async function openAliceSession(browser: Browser, page: Page) {
  const manifest = readBackendE2EManifest();
  const scheduleId = manifest.student.scheduleId;
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

  await page.goto("/proctor");
  const cohort = page.getByRole("button", {
    name: "Monitor Student Backend E2E Delivery for cohort Backend E2E Cohort",
  });
  await expect(cohort).toBeVisible();
  await cohort.click();

  const student = page.getByRole("button", {
    name: "Open Alice Candidate session details",
  });
  await expect(student).toBeVisible({ timeout: 30_000 });
  await student.click();
  await expect(page.getByRole("button", { name: "Close student details" })).toBeVisible();

  return { manifest, scheduleId, studentContext, studentPage };
}

test.describe("Individual student interventions", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  test.afterAll(async () => {
    await closeDb();
  });

  test("warns, pauses, resumes, annotates, resolves, and terminates one student", async ({
    browser,
    page,
  }) => {
    const { manifest, scheduleId, studentContext, studentPage } = await openAliceSession(
      browser,
      page,
    );

    try {
      const initial = await readAlice(await readDetail(page, scheduleId), manifest.student.candidateId);
      expect(initial.status).toBe("active");

      await page.getByRole("button", { name: "Warn", exact: true }).click();
      await expect
        .poll(async () => {
          const detail = await readDetail(page, scheduleId);
          const session = await readAlice(detail, manifest.student.candidateId);
          return {
            status: session.status,
            warnings: session.warnings,
            violationType: session.violations.at(-1)?.type,
            auditType: detail.auditLogs.find(
              (log) => log.targetStudentId === session.attemptId,
            )?.actionType,
          };
        }, { timeout: 30_000 })
        .toEqual({
          status: "warned",
          warnings: 1,
          violationType: "PROCTOR_WARNING",
          auditType: "STUDENT_WARN",
        });

      await expect(studentPage.getByRole("dialog")).toContainText("Warning issued by proctor", {
        timeout: 30_000,
      });
      await studentPage.getByRole("button", { name: "I Understand" }).click();

      await page.getByRole("button", { name: "Pause", exact: true }).click();
      const pauseDialog = page.getByRole("dialog", { name: "Pause this student?" });
      await expect(pauseDialog).toBeVisible();
      await pauseDialog.getByRole("button", { name: "Pause student" }).click();
      await expect(pauseDialog).not.toBeVisible();
      await expect
        .poll(
          async () =>
            (await readAlice(await readDetail(page, scheduleId), manifest.student.candidateId)).status,
          { timeout: 30_000 },
        )
        .toBe("paused");

      await studentPage.reload();
      await expect(
        studentPage.getByRole("heading", { name: "Individual session paused" }),
      ).toBeVisible({ timeout: 30_000 });

      await page.getByRole("button", { name: "Resume", exact: true }).click();
      await expect
        .poll(
          async () =>
            (await readAlice(await readDetail(page, scheduleId), manifest.student.candidateId)).status,
          { timeout: 30_000 },
        )
        .toBe("active");

      await page.getByRole("button", { name: "Notes", exact: true }).click();
      await page.getByLabel("Note category").selectOption("incident");
      await page.getByLabel("Note content").fill("Candidate resumed after proctor review.");
      await page.getByRole("button", { name: "Save note", exact: true }).click();
      await expect(page.getByText("Candidate resumed after proctor review.")).toBeVisible();
      await page.getByRole("button", { name: "Resolve", exact: true }).click();

      await expect
        .poll(async () => {
          const detail = await readDetail(page, scheduleId);
          const note = detail.notes.find(
            (entry) => entry.content === "Candidate resumed after proctor review.",
          );
          return note ? { category: note.category, isResolved: note.isResolved } : null;
        }, { timeout: 30_000 })
        .toEqual({ category: "incident", isResolved: true });

      await page.getByRole("button", { name: "Audit", exact: true }).click();
      await expect(page.getByText("STUDENT_WARN")).toBeVisible();
      await expect(page.getByText("STUDENT_PAUSE")).toBeVisible();
      await expect(page.getByText("STUDENT_RESUME")).toBeVisible();

      await page.getByRole("button", { name: "Terminate", exact: true }).click();
      const terminateDialog = page.getByRole("dialog", { name: "Terminate this student?" });
      await expect(terminateDialog).toBeVisible();
      await terminateDialog.getByRole("button", { name: "Terminate student" }).click();
      await expect(terminateDialog).not.toBeVisible();

      await expect
        .poll(
          async () =>
            (await readAlice(await readDetail(page, scheduleId), manifest.student.candidateId)).status,
          { timeout: 30_000 },
        )
        .toBe("terminated");

      const attempt = await queryDb<{
        id: string;
        proctor_status: string;
        delivery_status: string | null;
        submitted_at: string | null;
      }>(
        "SELECT id, proctor_status, delivery_status, submitted_at FROM student_attempts WHERE schedule_id = ? AND candidate_id = ? LIMIT 1",
        [scheduleId, manifest.student.candidateId],
      );
      expect(attempt[0]?.proctor_status).toBe("terminated");
      expect(attempt[0]?.delivery_status).toBe("terminated");
      expect(attempt[0]?.submitted_at).toBeTruthy();

      const audit = await queryDb<{ action_type: string; target_student_id: string }>(
        "SELECT action_type, target_student_id FROM session_audit_logs WHERE schedule_id = ? AND target_student_id = ? ORDER BY created_at ASC",
        [scheduleId, attempt[0]?.id ?? ""],
      );
      expect(audit.map((entry) => entry.action_type)).toEqual(
        expect.arrayContaining([
          "STUDENT_WARN",
          "STUDENT_PAUSE",
          "STUDENT_RESUME",
          "STUDENT_TERMINATE",
        ]),
      );

      await studentPage.reload();
      await expect(
        studentPage.getByRole("heading", { name: /Session terminated/i }),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await studentContext.close();
    }
  });
});

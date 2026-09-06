import { expect, test } from "@playwright/test";
import {
  ADMIN_STORAGE_STATE_PATH,
  readBackendE2EManifest,
  STUDENT_STORAGE_STATE_PATH,
} from "./support/backendE2e";

test.describe("Concurrent user scenarios", () => {
  test("multiple proctors can monitor the same Go-backed cohort", async ({ browser }) => {
    const { student } = readBackendE2EManifest();
    const contexts = await Promise.all(
      Array.from({ length: 2 }, () =>
        browser.newContext({ storageState: ADMIN_STORAGE_STATE_PATH })
      )
    );

    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      await Promise.all(pages.map((page) => page.goto("/proctor")));

      const monitorLabel = "Monitor Student Backend E2E Delivery for cohort Backend E2E Cohort";
      await Promise.all(
        pages.map(async (page) => {
          await expect(page.getByRole("button", { name: monitorLabel })).toBeVisible();
          await page.getByRole("button", { name: monitorLabel }).click();
          await expect(
            page.getByRole("heading", {
              name: "Student Backend E2E Delivery · Backend E2E Cohort",
            })
          ).toBeVisible();
          await expect(page.getByRole("button", { name: "Pause Cohort" })).toBeVisible();
        })
      );

      const details = await Promise.all(
        pages.map((page) =>
          page.request.get(
            `/api/v1/proctor/sessions/${student.scheduleId}?mode=dashboard&auditLimit=200&alertLimit=100`
          )
        )
      );
      for (const response of details) {
        expect(response.status()).toBe(200);
        const detail = (await response.json()) as { schedule: { id: string } };
        expect(detail.schedule.id).toBe(student.scheduleId);
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });

  test("concurrent proctor reads stay isolated by schedule", async ({ browser }) => {
    const { student } = readBackendE2EManifest();
    const context = await browser.newContext({ storageState: ADMIN_STORAGE_STATE_PATH });
    try {
      const pages = await Promise.all([context.newPage(), context.newPage()]);
      const scheduleIds = [student.scheduleId, student.proctorWorkflowScheduleId];
      const responses = await Promise.all(
        pages.map((page, index) =>
          page.request.get(
            `/api/v1/proctor/sessions/${scheduleIds[index]}?mode=dashboard&auditLimit=200&alertLimit=100`
          )
        )
      );

      for (const [index, response] of responses.entries()) {
        expect(response.status()).toBe(200);
        const detail = (await response.json()) as { schedule: { id: string } };
        expect(detail.schedule.id).toBe(scheduleIds[index]);
      }
    } finally {
      await context.close();
    }
  });

  test("multiple student clients can read the same authoritative session", async ({ browser }) => {
    const { student } = readBackendE2EManifest();
    const contexts = await Promise.all(
      Array.from({ length: 2 }, () =>
        browser.newContext({ storageState: STUDENT_STORAGE_STATE_PATH })
      )
    );

    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const responses = await Promise.all(
        pages.flatMap((page) => [
          page.request.get(`/api/v1/student/sessions/${student.scheduleId}/static`),
          page.request.get(`/api/v1/student/sessions/${student.scheduleId}/live`),
        ])
      );

      for (const response of responses) {
        expect(response.status()).toBe(200);
      }
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
});

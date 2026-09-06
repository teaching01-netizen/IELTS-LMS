import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH, readBackendE2EManifest } from "./support/backendE2e";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

type SessionDetail = {
  schedule: { id: string; status: string };
  runtime: { scheduleId: string; revision: number };
  auditLogs: Array<{
    id: string;
    scheduleId: string;
    actor: string;
    actionType: string;
    targetStudentId: string | null;
    payload: unknown;
    createdAt: string;
  }>;
};

test.describe("Go-backed audit log verification", () => {
  test("exposes the session lifecycle audit projection through the proctor API", async ({
    page,
  }) => {
    const { student } = readBackendE2EManifest();
    const response = await page.request.get(
      `/api/v1/proctor/sessions/${student.scheduleId}?mode=dashboard&auditLimit=200&alertLimit=100`
    );
    expect(response.status()).toBe(200);

    const detail = (await response.json()) as SessionDetail;
    expect(detail.schedule.id).toBe(student.scheduleId);
    expect(detail.runtime.scheduleId).toBe(student.scheduleId);
    expect(detail.runtime.revision).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(detail.auditLogs)).toBe(true);

    for (const log of detail.auditLogs) {
      expect(log.scheduleId).toBe(student.scheduleId);
      expect(log.actor.trim()).not.toBe("");
      expect(log.actionType.trim()).not.toBe("");
      expect(Date.parse(log.createdAt)).not.toBeNaN();
    }
  });

  test("does not expose audit rows from another schedule", async ({ page }) => {
    const { student } = readBackendE2EManifest();
    const response = await page.request.get(
      `/api/v1/proctor/sessions/${student.proctorWorkflowScheduleId}?mode=dashboard&auditLimit=200&alertLimit=100`
    );
    expect(response.status()).toBe(200);

    const detail = (await response.json()) as SessionDetail;
    expect(detail.schedule.id).toBe(student.proctorWorkflowScheduleId);
    expect(
      detail.auditLogs.every((log) => log.scheduleId === student.proctorWorkflowScheduleId)
    ).toBe(true);
  });
});

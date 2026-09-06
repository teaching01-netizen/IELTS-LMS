import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH, readBackendE2EManifest } from "./support/backendE2e";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

type SessionAuditLog = {
  id: string;
  scheduleId: string;
  actor: string;
  actionType: string;
  targetStudentId: string | null;
  payload: unknown;
  createdAt: string;
};

async function loadAuditLogs(page: Page, scheduleId: string, auditLimit = 200) {
  const response = await page.request.get(
    `/api/v1/proctor/sessions/${scheduleId}?mode=dashboard&auditLimit=${auditLimit}&alertLimit=${auditLimit}`
  );
  expect(response.status()).toBe(200);
  const detail = (await response.json()) as {
    schedule?: { id?: string };
    auditLogs?: SessionAuditLog[];
  };
  expect(detail.schedule?.id).toBe(scheduleId);
  expect(Array.isArray(detail.auditLogs)).toBe(true);
  return detail.auditLogs ?? [];
}

test.describe("Go-backed audit log integrity", () => {
  test("returns schedule-scoped audit records with valid immutable fields", async ({ page }) => {
    const { student } = readBackendE2EManifest();
    const logs = await loadAuditLogs(page, student.scheduleId);
    const ids = new Set<string>();
    let previousTimestamp = Number.POSITIVE_INFINITY;

    for (const log of logs) {
      expect(log.id).toMatch(/^[0-9a-f-]{20,}$/i);
      expect(ids.has(log.id)).toBe(false);
      ids.add(log.id);
      expect(log.scheduleId).toBe(student.scheduleId);
      expect(log.actor.trim()).not.toBe("");
      expect(log.actionType.trim()).not.toBe("");

      const timestamp = Date.parse(log.createdAt);
      expect(Number.isFinite(timestamp)).toBe(true);
      expect(timestamp).toBeLessThanOrEqual(previousTimestamp);
      previousTimestamp = timestamp;

      expect(
        log.payload === null || (typeof log.payload === "object" && log.payload !== null)
      ).toBe(true);
    }
  });

  test("keeps the same audit record identity across repeated reads", async ({ page }) => {
    const { student } = readBackendE2EManifest();
    const first = await loadAuditLogs(page, student.scheduleId);
    const second = await loadAuditLogs(page, student.scheduleId);

    expect(second.map(({ id, createdAt, actionType }) => ({ id, createdAt, actionType }))).toEqual(
      first.map(({ id, createdAt, actionType }) => ({ id, createdAt, actionType }))
    );
  });

  test("honors the bounded dashboard audit limit", async ({ page }) => {
    const { student } = readBackendE2EManifest();
    const logs = await loadAuditLogs(page, student.scheduleId, 1);
    expect(logs.length).toBeLessThanOrEqual(1);
  });
});

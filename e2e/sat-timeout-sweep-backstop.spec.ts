import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH } from "./support/backendE2e";
import { closeDb, executeUpdate, queryDb } from "./support/db";
import { createRunningSatSession } from "./support/satStudentSession";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

/**
 * The worker's general timeout sweep (delivery.ReconcileTimeouts →
 * timeoutCandidates) is the only path that retries completion for an attempt
 * whose modules all closed but whose terminal receipt was never written
 * (reconcile.go "audit P1" backstop). Cohort timing keeps the personal lane
 * out, no runtime event fires an outbox reconcile, and the student browser is
 * closed, so only the sweep can terminalize this attempt.
 */
test.describe("SAT timeout sweep backstop", () => {
  test.describe.configure({ timeout: 300_000 });
  test.afterAll(async () => closeDb());

  test("terminalizes a disconnected attempt whose modules closed without a receipt", async ({
    page,
    browser,
  }) => {
    const { studentContext, studentPage, scheduleId } = await createRunningSatSession(
      browser,
      page,
      { label: "sweep-backstop", timingModel: "cohort_section_v3" }
    );
    try {
      await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
      await studentContext.close();

      const attempts = await queryDb<{ id: string }>(
        "SELECT id FROM student_attempts WHERE schedule_id = ? AND submitted_at IS NULL",
        [scheduleId]
      );
      expect(attempts).toHaveLength(1);
      const attemptId = attempts[0]!.id;

      // Stage "last module finalized, completion failed": every module is
      // terminal, no receipt, attempt still open.
      const locked = await executeUpdate(
        `UPDATE assessment_module_attempts
            SET state = 'locked', locked_at = NOW(6), completion_reason = 'time_expired', updated_at = NOW(6)
          WHERE attempt_id = ? AND state IN ('not_started', 'active', 'review')`,
        [attemptId]
      );
      expect(locked).toBeGreaterThan(0);
      // Completion requires one terminal module per section; add a locked
      // Math Module 1 alongside the closed Reading & Writing module.
      const mathModule = await executeUpdate(
        `INSERT INTO assessment_module_attempts
           (id, attempt_id, module_id, state, allocated_seconds, tool_state, locked_at, completion_reason, run_generation)
         SELECT UUID(), rw.attempt_id, mm.id, 'locked', mm.duration_seconds, JSON_OBJECT(), NOW(6), 'time_expired', rw.run_generation
           FROM assessment_module_attempts rw
           JOIN assessment_modules rm ON rm.id = rw.module_id
           JOIN assessment_sections rs ON rs.id = rm.section_id
           JOIN assessment_sections ms ON ms.exam_version_id = rs.exam_version_id AND ms.section_key = 'math'
           JOIN assessment_modules mm ON mm.section_id = ms.id AND mm.adaptive_role = 'base'
          WHERE rw.attempt_id = ? AND rs.section_key = 'reading-writing' AND rm.adaptive_role = 'base'`,
        [attemptId]
      );
      expect(mathModule).toBe(1);
      const [staged] = await queryDb<{ receipts: number; open: number }>(
        `SELECT
           (SELECT COUNT(*) FROM attempt_terminalizations WHERE attempt_id = ?) AS receipts,
           (SELECT COUNT(*) FROM assessment_module_attempts
             WHERE attempt_id = ? AND state IN ('not_started', 'active', 'review')) AS open`,
        [attemptId, attemptId]
      );
      expect(Number(staged!.receipts)).toBe(0);
      expect(Number(staged!.open)).toBe(0);

      // The sweep runs every 5 s.
      await expect
        .poll(
          async () => {
            const rows = await queryDb<{ n: number }>(
              "SELECT COUNT(*) AS n FROM attempt_terminalizations WHERE attempt_id = ?",
              [attemptId]
            );
            return Number(rows[0]?.n ?? 0);
          },
          { timeout: 60_000, intervals: [1_000, 2_000, 5_000] }
        )
        .toBeGreaterThan(0);

      const [attempt] = await queryDb<{ submitted: number }>(
        "SELECT submitted_at IS NOT NULL AS submitted FROM student_attempts WHERE id = ?",
        [attemptId]
      );
      expect(Number(attempt!.submitted)).toBe(1);
    } finally {
      await studentContext.close().catch(() => undefined);
    }
  });
});

import { expect, type Page } from "@playwright/test";
import { executeUpdate, queryDb } from "./db";

export interface SatSprQuestion {
  id: string;
  displayOrder: number;
  /** 1-based position among all questions in the administered module. */
  questionNumber: number;
  moduleId: string;
  accepted: string;
  policy: string | null;
}

/**
 * Advance the real section handoff from Reading & Writing into the Math base
 * module. The test owns only the clocks: every state transition is the server's
 * normal timeout/reconciliation path.
 */
export async function advanceToSatMathBase(
  studentPage: Page,
  scheduleId: string
): Promise<void> {
  for (const locked of [1, 2]) {
    await executeUpdate(
      `UPDATE assessment_module_attempts ma JOIN student_attempts a ON a.id = ma.attempt_id
      SET ma.started_at = NOW(6) - INTERVAL 1 HOUR WHERE a.schedule_id = ? AND ma.state IN ('active','review')`,
      [scheduleId]
    );
    await expect
      .poll(
        async () => {
          const [row] = await queryDb<{ count: number }>(
            `SELECT COUNT(*) AS count FROM assessment_module_attempts ma
        JOIN student_attempts a ON a.id = ma.attempt_id JOIN assessment_modules m ON m.id = ma.module_id
        JOIN assessment_sections s ON s.id = m.section_id
        WHERE a.schedule_id = ? AND s.section_key = 'reading-writing' AND ma.state = 'locked'`,
            [scheduleId]
          );
          return row.count;
        },
        { timeout: 45_000 }
      )
      .toBe(locked);
    if (locked === 1) {
      await expect
        .poll(
          async () => {
            const [row] = await queryDb<{ count: number }>(
              `SELECT COUNT(*) AS count FROM assessment_module_attempts ma
          JOIN student_attempts a ON a.id = ma.attempt_id WHERE a.schedule_id = ? AND ma.state = 'active'`,
              [scheduleId]
            );
            return row.count;
          },
          { timeout: 45_000 }
        )
        .toBe(1);
    }
  }
  await expect(studentPage.getByTestId("sat-scheduled-break")).toBeVisible({ timeout: 45_000 });
  await executeUpdate(
    `UPDATE assessment_attempt_breaks b JOIN student_attempts a ON a.id = b.attempt_id
    SET b.starts_at = NOW(6) - INTERVAL 11 MINUTE, b.deadline_at = NOW(6) - INTERVAL 1 MINUTE,
        b.updated_at = NOW(6), b.revision = b.revision + 1 WHERE a.schedule_id = ? AND b.state = 'active'`,
    [scheduleId]
  );
  await executeUpdate(
    `UPDATE assessment_module_attempts ma JOIN student_attempts a ON a.id = ma.attempt_id
    JOIN assessment_modules m ON m.id = ma.module_id JOIN assessment_sections s ON s.id = m.section_id
    SET ma.available_at = NOW(6) - INTERVAL 1 MINUTE
    WHERE a.schedule_id = ? AND s.section_key = 'math' AND m.adaptive_role = 'base' AND ma.state = 'not_started'`,
    [scheduleId]
  );
  await expect
    .poll(
      async () => {
        const [row] = await queryDb<{ count: number }>(
          `SELECT COUNT(*) AS count FROM assessment_module_attempts ma
      JOIN student_attempts a ON a.id = ma.attempt_id JOIN assessment_modules m ON m.id = ma.module_id
      JOIN assessment_sections s ON s.id = m.section_id
      WHERE a.schedule_id = ? AND s.section_key = 'math' AND ma.state = 'active'`,
          [scheduleId]
        );
        return row.count;
      },
      { timeout: 45_000 }
    )
    .toBe(1);
  await studentPage.reload({ waitUntil: "domcontentloaded" });
  await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
}

/** All operational SPR questions in the administered Math base module. */
export async function findSatMathSprQuestions(scheduleId: string): Promise<SatSprQuestion[]> {
  const rows = await queryDb<{
    id: string;
    display_order: number;
    question_number: number;
    module_id: string;
    accepted: string | null;
    policy: string | null;
  }>(
    `
    SELECT eq.id, eq.display_order, eq.module_id,
      (SELECT COUNT(*) FROM assessment_exam_questions prior
        WHERE prior.module_id = eq.module_id AND prior.display_order < eq.display_order) + 1 AS question_number,
      JSON_UNQUOTE(JSON_EXTRACT(qr.answer_definition, '$.acceptedResponses[0]')) AS accepted,
      JSON_UNQUOTE(JSON_EXTRACT(ev.config_snapshot, '$.satStudentResponseScoring')) AS policy
    FROM exam_schedules sch JOIN exam_versions ev ON ev.id = sch.published_version_id
    JOIN assessment_sections s ON s.exam_version_id = ev.id AND s.section_key = 'math'
    JOIN assessment_modules m ON m.section_id = s.id AND m.adaptive_role = 'base'
    JOIN assessment_exam_questions eq ON eq.module_id = m.id
    JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id
    WHERE sch.id = ? AND qr.question_type = 'student_produced_response' AND eq.is_pretest = FALSE
    ORDER BY eq.display_order`,
    [scheduleId]
  );
  return rows.map((row) => ({
    id: row.id,
    displayOrder: row.display_order,
    questionNumber: row.question_number,
    moduleId: row.module_id,
    accepted: row.accepted ?? "",
    policy: row.policy,
  }));
}

/** The answer text currently stored in the V2 response aggregate, if any. */
export async function readStoredSatAnswer(
  scheduleId: string,
  candidateId: string,
  questionId: string
): Promise<string | undefined> {
  const rows = await queryDb<{ answer: string | null }>(
    `
    SELECT JSON_UNQUOTE(JSON_EXTRACT(v.response, '$.answer')) AS answer
    FROM attempt_responses_v2 v JOIN student_attempts a ON a.id = v.attempt_id
    WHERE a.schedule_id = ? AND a.candidate_id = ? AND v.question_id = ?`,
    [scheduleId, candidateId, questionId]
  );
  const answer = rows[0]?.answer;
  // MySQL JSON_EXTRACT of JSON null yields the string "null" after
  // JSON_UNQUOTE; the domain meaning is "no answer".
  return answer === null || answer === "null" ? undefined : answer;
}

function navigatorDialog(page: Page) {
  return page.getByRole("dialog", { name: /Questions/ });
}

/** Jump to a question by its 1-based number through the real navigator. */
export async function openSatQuestion(page: Page, questionNumber: number): Promise<void> {
  await page.getByRole("button", { name: /Open question navigator/ }).click();
  const dialog = navigatorDialog(page);
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: new RegExp(`^Question ${questionNumber}(?:,|$)`) })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("sat-exam-shell")).toBeVisible();
}

/** Open the review page through the navigator's own CTA. */
export async function openSatReview(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Open question navigator/ }).click();
  const dialog = navigatorDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Review answers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review your answers" })).toBeVisible();
}

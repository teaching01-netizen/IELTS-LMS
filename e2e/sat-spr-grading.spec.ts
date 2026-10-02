import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH } from "./support/backendE2e";
import { executeUpdate, queryDb } from "./support/db";
import { createRunningSatSession } from "./support/satStudentSession";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

test("SAT Math preserves responses through saving, navigation, reload and routing with clipboard protection", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  const { studentContext, studentPage, scheduleId, candidateId } = await createRunningSatSession(
    browser,
    page,
    { label: "spr-grading", studentContext: { permissions: ["clipboard-read", "clipboard-write"] } }
  );
  try {
    // Use the real section handoff; advance only the test's module clocks.
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
    const [question] = await queryDb<{
      id: string;
      display_order: number;
      accepted: string;
      module_id: string;
      policy: string;
    }>(
      `
      SELECT eq.id, eq.display_order, eq.module_id,
        JSON_UNQUOTE(JSON_EXTRACT(qr.answer_definition, '$.acceptedResponses[0]')) AS accepted,
        JSON_UNQUOTE(JSON_EXTRACT(ev.config_snapshot, '$.satStudentResponseScoring')) AS policy
      FROM exam_schedules sch JOIN exam_versions ev ON ev.id = sch.published_version_id
      JOIN assessment_sections s ON s.exam_version_id = ev.id AND s.section_key = 'math'
      JOIN assessment_modules m ON m.section_id = s.id AND m.adaptive_role = 'base'
      JOIN assessment_exam_questions eq ON eq.module_id = m.id
      JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id
      WHERE sch.id = ? AND qr.question_type = 'student_produced_response' AND eq.is_pretest = FALSE
      ORDER BY eq.display_order LIMIT 1`,
      [scheduleId]
    );
    expect(question).toBeDefined();
    expect(question.policy).toBe("strict_v1");
    for (let index = 0; index < question.display_order; index++) {
      await studentPage.getByRole("button", { name: "Next question", exact: true }).click();
    }
    const input = studentPage.getByRole("textbox", { name: "Enter your answer" });
    await expect(input).toBeVisible();
    expect(await input.getAttribute("maxlength")).toBeNull();
    const storedAnswer = async () => {
      const rows = await queryDb<{ answer: string }>(
        `
        SELECT JSON_UNQUOTE(JSON_EXTRACT(v.response, '$.answer')) AS answer
        FROM attempt_responses_v2 v JOIN student_attempts a ON a.id = v.attempt_id
        WHERE a.schedule_id = ? AND a.candidate_id = ? AND v.question_id = ?`,
        [scheduleId, candidateId, question.id]
      );
      return rows[0]?.answer;
    };
    for (const value of ["1 1/2", "1e3", "1/2.3", "123456", "1/0"]) {
      if (value === "1 1/2") {
        await studentPage.evaluate((text) => navigator.clipboard.writeText(text), value);
        await input.focus();
        await input.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
        // Timed exams deliberately block clipboard input; it must not mutate an answer.
        await expect(input).toHaveValue("");
      }
      await input.fill(value);
      await input.press("Tab");
      await expect(input).toHaveValue(value);
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect.poll(storedAnswer).toBe(value);
      await studentPage.getByRole("button", { name: "Next question", exact: true }).click();
      await studentPage.getByRole("button", { name: "Previous question", exact: true }).click();
      await expect(input).toHaveValue(value);
    }
    await studentPage.reload({ waitUntil: "domcontentloaded" });
    await expect(input).toHaveValue("1/0", { timeout: 45_000 });
    await input.press("Tab");
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await input.fill(question.accepted);
    await input.press("Tab");
    await expect(input).not.toHaveAttribute("aria-invalid", "true");
    await expect.poll(storedAnswer).toBe(question.accepted);
    await executeUpdate(
      `UPDATE assessment_module_attempts ma JOIN student_attempts a ON a.id = ma.attempt_id
      SET ma.started_at = NOW(6) - INTERVAL 1 HOUR WHERE a.schedule_id = ? AND a.candidate_id = ? AND ma.module_id = ?`,
      [scheduleId, candidateId, question.module_id]
    );
    await expect
      .poll(
        async () => {
          const rows = await queryDb<{
            raw_correct: number;
            selected_route: string;
            selected_module_id: string;
            lower_module_id: string;
          }>(
            `
        SELECT d.raw_correct, d.selected_route, d.selected_module_id, p.lower_module_id
        FROM assessment_route_decisions d JOIN student_attempts a ON a.id = d.attempt_id
        JOIN assessment_routing_policies p ON p.section_id = d.section_id
        WHERE a.schedule_id = ? AND a.candidate_id = ? AND d.base_module_id = ?`,
            [scheduleId, candidateId, question.module_id]
          );
          return rows.map((row) => ({
            correct: row.raw_correct,
            route: row.selected_route,
            correctModule: row.selected_module_id === row.lower_module_id,
          }));
        },
        { timeout: 45_000 }
      )
      .toEqual([{ correct: 1, route: "lower", correctModule: true }]);
    await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
  } finally {
    await studentContext.close();
  }
});

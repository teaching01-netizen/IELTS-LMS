import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH } from "./support/backendE2e";
import { closeDb, executeUpdate, queryDb } from "./support/db";

const E2E_ORG_ID = "e2e-org";
const E2E_ADMIN_EMAIL = "e2e.admin.operator@example.com";

interface SatRetakeQuestion {
  examQuestionId: string;
  moduleId: string;
  displayOrder: number;
  promptText: string;
  correctLabel: string;
  correctText: string;
}

async function e2eAdminUserId(): Promise<string> {
  const rows = await queryDb<{ id: string }>("SELECT id FROM users WHERE email = ? LIMIT 1", [
    E2E_ADMIN_EMAIL,
  ]);
  const id = rows[0]?.id;
  if (!id) {
    throw new Error(
      `The global E2E seed is missing ${E2E_ADMIN_EMAIL}; run e2e/global-setup.ts against the disposable database.`
    );
  }
  return id;
}

interface SeedExamOptions {
  runId: string;
  adminUserId: string;
  questionCount: number;
  moduleSeconds: number;
}

interface SeededExam {
  examId: string;
  versionId: string;
  questions: SatRetakeQuestion[];
}

function promptPayload(text: string): string {
  return JSON.stringify({
    version: 1,
    nodes: [{ type: "paragraph", text }],
  });
}

function answerPayload(runId: string): string {
  return JSON.stringify({
    kind: "single_choice",
    options: [
      {
        id: "A",
        content: { version: 1, nodes: [{ type: "paragraph", text: `Choice A ${runId}` }] },
      },
      {
        id: "B",
        content: { version: 1, nodes: [{ type: "paragraph", text: `Choice B ${runId}` }] },
      },
      {
        id: "C",
        content: { version: 1, nodes: [{ type: "paragraph", text: `Choice C ${runId}` }] },
      },
      {
        id: "D",
        content: { version: 1, nodes: [{ type: "paragraph", text: `Choice D ${runId}` }] },
      },
    ],
    correctOptionId: "A",
  });
}

async function insertQuestion(
  adminUserId: string,
  moduleId: string,
  runId: string,
  label: string,
  displayOrder: number
): Promise<SatRetakeQuestion> {
  const questionId = randomUUID();
  const revisionId = randomUUID();
  const examQuestionId = randomUUID();
  const promptText = `Choose the correct answer. ${label}`;
  await executeUpdate(
    "INSERT INTO assessment_questions (id, provider_key, created_by) VALUES (?, 'sat', ?)",
    [questionId, adminUserId]
  );
  await executeUpdate(
    `INSERT INTO assessment_question_revisions
       (id, question_id, semantic_revision, state, question_type, stimulus, prompt, answer_definition,
        rationale, metadata, accessibility, created_by)
     VALUES (?, ?, 1, 'sealed', 'single_choice', '{}', ?, ?, '{}', '{}', '{}', ?)`,
    [revisionId, questionId, promptPayload(promptText), answerPayload(runId), adminUserId]
  );
  await executeUpdate(
    `INSERT INTO assessment_exam_questions
       (id, module_id, question_id, question_revision_id, display_order)
     VALUES (?, ?, ?, ?, ?)`,
    [examQuestionId, moduleId, questionId, revisionId, displayOrder]
  );
  return {
    examQuestionId,
    moduleId,
    displayOrder,
    promptText,
    correctLabel: "A",
    correctText: `Choice A ${runId}`,
  };
}

/**
 * Minimal *published* SAT version, inserted directly as clearly-tagged test
 * setup. This mirrors the shape the Go classroom MySQL fixtures use; it is not
 * a production test hook. Publishing still goes through the real assignment
 * service, which validates the pinned version and binds the schedule/runtime.
 */
async function seedPublishedSatExam(options: SeedExamOptions): Promise<SeededExam> {
  const { runId, adminUserId, questionCount, moduleSeconds } = options;
  const examId = randomUUID();
  const versionId = randomUUID();
  const sectionId = randomUUID();
  const moduleId = randomUUID();
  const slug = `sat-retakes-e2e-${runId}`;

  await executeUpdate(
    `INSERT INTO exam_entities
       (id, slug, title, provider_key, provider_exam_type, exam_type, status, visibility,
        organization_id, owner_id, sat_score_report_enabled)
     VALUES (?, ?, ?, 'sat', 'SAT', 'Academic', 'published', 'organization', ?, ?, TRUE)`,
    [examId, slug, `SAT Retakes E2E ${runId}`, E2E_ORG_ID, adminUserId]
  );
  await executeUpdate(
    `INSERT INTO exam_versions
       (id, exam_id, version_number, content_snapshot, config_snapshot, created_by, is_published,
        sat_publish_scope, sat_flexible_count, sat_classroom_plan)
     VALUES (?, ?, 1, '{}', '{}', ?, TRUE, 'reading-writing', FALSE, '{"reading-writing":"m1_only"}')`,
    [versionId, examId, adminUserId]
  );
  await executeUpdate(
    `INSERT INTO assessment_sections
       (id, exam_version_id, section_key, title, display_order, duration_seconds, instructions, tool_policy)
     VALUES (?, ?, 'reading-writing', 'Reading and Writing', 0, ?, '{}', '{}')`,
    [sectionId, versionId, moduleSeconds * 2]
  );
  await executeUpdate(
    `INSERT INTO assessment_modules
       (id, section_id, module_key, title, display_order, duration_seconds, target_question_count,
        adaptive_role, instructions, tool_policy)
     VALUES (?, ?, 'rw-m1', 'Reading and Writing Module 1', 1, ?, ?, 'base', '{}', '{}')`,
    [moduleId, sectionId, moduleSeconds, questionCount]
  );

  // The adaptive base module requires a routing policy row even when the
  // classroom plan fixes Module 1 only. The branch modules are never delivered.
  const lowerModuleId = randomUUID();
  const higherModuleId = randomUUID();
  await executeUpdate(
    `INSERT INTO assessment_modules
       (id, section_id, module_key, title, display_order, duration_seconds, target_question_count,
        adaptive_role, instructions, tool_policy)
     VALUES (?, ?, 'rw-m2-lower', 'Reading and Writing Module 2 Lower', 2, ?, 1, 'lower_branch', '{}', '{}')`,
    [lowerModuleId, sectionId, moduleSeconds]
  );
  await executeUpdate(
    `INSERT INTO assessment_modules
       (id, section_id, module_key, title, display_order, duration_seconds, target_question_count,
        adaptive_role, instructions, tool_policy)
     VALUES (?, ?, 'rw-m2-higher', 'Reading and Writing Module 2 Higher', 3, ?, 1, 'higher_branch', '{}', '{}')`,
    [higherModuleId, sectionId, moduleSeconds]
  );
  await executeUpdate(
    `INSERT INTO assessment_routing_policies
       (id, section_id, base_module_id, lower_module_id, higher_module_id, policy_key, policy_config, revision)
     VALUES (?, ?, ?, ?, ?, 'sat_threshold', '{"threshold":1}', 1)`,
    [randomUUID(), sectionId, moduleId, lowerModuleId, higherModuleId]
  );

  const questions: SatRetakeQuestion[] = [];
  for (let index = 0; index < questionCount; index += 1) {
    questions.push(
      await insertQuestion(
        adminUserId,
        moduleId,
        runId,
        `${runId} delivered question ${index + 1}`,
        index + 1
      )
    );
  }

  await executeUpdate("UPDATE exam_entities SET current_published_version_id = ? WHERE id = ?", [
    versionId,
    examId,
  ]);

  return { examId, versionId, questions };
}

async function insertClassroomRoom(
  examId: string,
  versionId: string,
  adminUserId: string,
  runId: string
): Promise<string> {
  const scheduleId = randomUUID();
  await executeUpdate(
    `INSERT INTO exam_schedules
       (id, exam_id, published_version_id, provider_key, organization_id, exam_title,
        proctor_display_name, grading_display_name, cohort_name, start_time, end_time,
        planned_duration_minutes, delivery_mode, status, created_by,
        sat_timing_model, sat_session_mode, sat_route_policy, sat_start_mode)
     VALUES (?, ?, ?, 'sat', ?, ?, ?, ?, ?, NOW(),
        DATE_ADD(NOW(), INTERVAL 2 HOUR), 60, 'proctor_start',
        'scheduled', ?, 'sat_personal_v1', 'classroom', 'adaptive', 'proctor')`,
    [
      scheduleId,
      examId,
      versionId,
      E2E_ORG_ID,
      `SAT Classroom ${runId}`,
      `SAT Classroom ${runId}`,
      `SAT Classroom ${runId}`,
      `SAT Classroom ${runId}`,
      adminUserId,
    ]
  );
  return scheduleId;
}

async function shortenActiveModule(attemptId: string): Promise<void> {
  const rows = await queryDb<{ id: string }>(
    "SELECT id FROM assessment_module_attempts WHERE attempt_id = ? AND state = 'active' ORDER BY started_at DESC LIMIT 1",
    [attemptId]
  );
  const moduleAttemptId = rows[0]?.id;
  if (!moduleAttemptId) throw new Error(`Attempt ${attemptId} has no active module to expire.`);
  // Tagged test setup: move the server-observed personal deadline a few
  // seconds ahead. The real module-close/finalization path still runs.
  await executeUpdate(
    "UPDATE assessment_module_attempts SET allocated_seconds = GREATEST(1, TIMESTAMPDIFF(SECOND, started_at, UTC_TIMESTAMP(6)) + 4) WHERE id = ?",
    [moduleAttemptId]
  );
}


test.skip(process.env["SAT_RETAKE_E2E_DISPOSABLE"] !== "1", "Requires a disposable SAT E2E database.");
test.afterAll(closeDb);

test("Classroom room defaults, WCODE retake, pause and keyed PDF", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const admin = await browser.newContext({ storageState: ADMIN_STORAGE_STATE_PATH });
  const student = await browser.newContext();
  try {
    const runId = randomUUID().slice(0, 8);
    const adminUserId = await e2eAdminUserId();
    const { examId, versionId } = await seedPublishedSatExam({
      runId, adminUserId, questionCount: 2, moduleSeconds: 180,
    });
    const scheduleId = await insertClassroomRoom(examId, versionId, adminUserId, runId);
    const root = baseURL!;
    const csrf = (await admin.cookies()).find((cookie) => cookie.name === (process.env["CSRF_COOKIE_NAME"] ?? "csrf"))!.value;
    const settingsUrl = `${root}/api/v1/schedules/${scheduleId}/sat-learning-settings`;
    const headers = { Origin: root, "x-csrf-token": csrf };
    const settings = await admin.request.get(settingsUrl);
    expect(settings.status(), await settings.text()).toBe(200);
    const initial = (await settings.json()).data;
    expect(initial).toMatchObject({ unlimitedRetakes: true, reportVisible: true, includeAnswerKeyInPdf: false });
    const saved = await admin.request.put(settingsUrl, {
      headers,
      data: { ...initial, expectedRevision: initial.revision, includeAnswerKeyInPdf: true, pauseOnLeave: true },
    });
    expect(saved.status(), await saved.text()).toBe(200);

    const page = await student.newPage();
    await page.goto(`${root}/student/${scheduleId}`);
    await page.getByLabel("Student ID/WCODE").fill(`W${Date.now().toString().slice(-8)}`);
    await page.getByLabel("Full name").fill("SAT Retake Student");
    await page.getByLabel("Email").fill(`sat-retake-${runId}@example.test`);
    await page.getByRole("button", { name: /Continue/i }).click();
    await expect(page).toHaveURL(new RegExp(`/student/${scheduleId}/[^/]+$`));
    const started = await admin.request.post(`${root}/api/v1/schedules/${scheduleId}/runtime/commands`, {
      headers, data: { action: "start" },
    });
    expect(started.status(), await started.text()).toBe(200);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 60_000 });

    const choices = page.locator("label.sat-answer-choice").filter({ hasText: "Choice B" });
    await choices.first().click();
    await page.getByRole("button", { name: "Next question", exact: true }).click();
    await choices.first().click();
    await expect(page.getByTestId("sat-exam-shell")).toHaveAttribute("data-sat-save-state", "idle");
    await page.getByRole("button", { name: "Pause and leave" }).click();
    await expect(page.getByRole("heading", { name: "Exam paused" })).toBeVisible();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Resume exam" }).click();
    await expect(page.getByTestId("sat-exam-shell")).toBeVisible();

    const [{ id: attemptId }] = await queryDb<{ id: string }>(
      "SELECT id FROM student_attempts WHERE schedule_id = ?", [scheduleId],
    );
    await shortenActiveModule(attemptId);
    await expect(page.getByRole("region", { name: "Score report" })).toBeVisible({ timeout: 90_000 });
    const download = page.waitForEvent("download", { timeout: 90_000 });
    const prepare = page.waitForResponse((res) => res.url().endsWith(`/schedules/${scheduleId}/prepare`));
    await page.getByRole("button", { name: "Download exam PDF" }).click();
    const prepared = await prepare;
    expect(prepared.status(), await prepared.text()).toBe(200);
    expect(prepared.request().postDataJSON()).toMatchObject({ includeAnswerKey: true });
    const pdf = await readFile(await (await download).path());
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");

    const latest = (await saved.json()).data;
    const revoke = await admin.request.put(settingsUrl, {
      headers, data: { ...latest, expectedRevision: latest.revision, includeAnswerKeyInPdf: false },
    });
    expect(revoke.status(), await revoke.text()).toBe(200);
    const href = await page.getByRole("link", { name: "Download PDF again" }).getAttribute("href");
    expect((await student.request.head(new URL(href!, root).href)).status()).toBe(404);

    const retake = page.waitForResponse((res) => res.url().endsWith(`/sat/practice/schedules/${scheduleId}/attempts`) && res.request().method() === "POST");
    await page.getByRole("button", { name: "Start exam again" }).click();
    const replay = await retake;
    expect(replay.status(), await replay.text()).toBe(200);
    const next = (await replay.json()).data;
    expect(next).toMatchObject({ ordinal: 2, disposition: "started" });
    expect(next.attemptId).not.toBe(attemptId);
    await expect(page.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 60_000 });
  } finally {
    await Promise.all([admin.close(), student.close()]);
  }
});

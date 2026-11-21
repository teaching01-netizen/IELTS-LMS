import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH } from "./support/backendE2e";
import { closeDb, executeUpdate, queryDb } from "./support/db";

const E2E_ORG_ID = "e2e-org";
const E2E_ADMIN_EMAIL = "e2e.admin.operator@example.com";

async function e2eAdminUserId(): Promise<string> {
  const rows = await queryDb<{ id: string }>("SELECT id FROM users WHERE email = ? LIMIT 1", [E2E_ADMIN_EMAIL]);
  const id = rows[0]?.id;
  if (!id) throw new Error(`The global E2E seed is missing ${E2E_ADMIN_EMAIL}.`);
  return id;
}

function promptPayload(text: string): string {
  return JSON.stringify({ version: 1, nodes: [{ type: "paragraph", text }] });
}

function answerPayload(runId: string): string {
  return JSON.stringify({
    kind: "single_choice",
    options: [
      { id: "A", content: { version: 1, nodes: [{ type: "paragraph", text: `Choice A ${runId}` }] } },
      { id: "B", content: { version: 1, nodes: [{ type: "paragraph", text: `Choice B ${runId}` }] } },
    ],
    correctOptionId: "A",
  });
}

async function insertQuestion(adminUserId: string, moduleId: string, runId: string, order: number): Promise<void> {
  const questionId = randomUUID();
  const revisionId = randomUUID();
  const examQuestionId = randomUUID();
  await executeUpdate("INSERT INTO assessment_questions (id, provider_key, created_by) VALUES (?, 'sat', ?)", [questionId, adminUserId]);
  await executeUpdate(
    `INSERT INTO assessment_question_revisions
       (id, question_id, semantic_revision, state, question_type, stimulus, prompt, answer_definition,
        rationale, metadata, accessibility, created_by)
     VALUES (?, ?, 1, 'sealed', 'single_choice', '{}', ?, ?, '{}', '{}', '{}', ?)`,
    [revisionId, questionId, promptPayload(`Choose the correct answer. ${order}`), answerPayload(runId), adminUserId],
  );
  await executeUpdate(
    `INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order)
     VALUES (?, ?, ?, ?, ?)`,
    [examQuestionId, moduleId, questionId, revisionId, order],
  );
}

interface Seeded {
  examId: string;
  versionId: string;
}

async function seedExam(runId: string, adminUserId: string, moduleSeconds: number): Promise<Seeded> {
  const examId = randomUUID();
  const versionId = randomUUID();
  const sectionId = randomUUID();
  const moduleId = randomUUID();
  await executeUpdate(
    `INSERT INTO exam_entities
       (id, slug, title, provider_key, provider_exam_type, exam_type, status, visibility,
        organization_id, owner_id, sat_score_report_enabled, sat_learning_defaults)
     VALUES (?, ?, ?, 'sat', 'SAT', 'Academic', 'published', 'organization', ?, ?, FALSE, ?)`,
    [
      examId,
      `sat-live-settings-${runId}`,
      `SAT Live Settings ${runId}`,
      E2E_ORG_ID,
      adminUserId,
      JSON.stringify({
        revision: 0,
        reportVisible: false,
        includeAnswerKeyInPdf: false,
        unlimitedRetakes: false,
        pauseOnLeave: false,
        study: { enabled: false, requiredCompletions: 1, revealAnswers: true, untimed: true },
      }),
    ],
  );
  await executeUpdate(
    `INSERT INTO exam_versions
       (id, exam_id, version_number, content_snapshot, config_snapshot, created_by, is_published,
        sat_publish_scope, sat_flexible_count, sat_classroom_plan)
     VALUES (?, ?, 1, '{}', '{}', ?, TRUE, 'reading-writing', FALSE, '{"reading-writing":"m1_only"}')`,
    [versionId, examId, adminUserId],
  );
  await executeUpdate(
    `INSERT INTO assessment_sections
       (id, exam_version_id, section_key, title, display_order, duration_seconds, instructions, tool_policy)
     VALUES (?, ?, 'reading-writing', 'Reading and Writing', 0, ?, '{}', '{}')`,
    [sectionId, versionId, moduleSeconds * 2],
  );
  await executeUpdate(
    `INSERT INTO assessment_modules
       (id, section_id, module_key, title, display_order, duration_seconds, target_question_count,
        adaptive_role, instructions, tool_policy)
     VALUES (?, ?, 'rw-m1', 'Reading and Writing Module 1', 1, ?, 2, 'base', '{}', '{}')`,
    [moduleId, sectionId, moduleSeconds],
  );
  const lowerModuleId = randomUUID();
  const higherModuleId = randomUUID();
  for (const [id, key, title, order, role] of [
    [lowerModuleId, "rw-m2-lower", "Reading and Writing Module 2 Lower", 2, "lower_branch"],
    [higherModuleId, "rw-m2-higher", "Reading and Writing Module 2 Higher", 3, "higher_branch"],
  ] as const) {
    await executeUpdate(
      `INSERT INTO assessment_modules
         (id, section_id, module_key, title, display_order, duration_seconds, target_question_count,
          adaptive_role, instructions, tool_policy)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, '{}', '{}')`,
      [id, sectionId, key, title, order, moduleSeconds, role],
    );
  }
  await executeUpdate(
    `INSERT INTO assessment_routing_policies
       (id, section_id, base_module_id, lower_module_id, higher_module_id, policy_key, policy_config, revision)
     VALUES (?, ?, ?, ?, ?, 'sat_threshold', '{"threshold":1}', 1)`,
    [randomUUID(), sectionId, moduleId, lowerModuleId, higherModuleId],
  );
  await insertQuestion(adminUserId, moduleId, runId, 1);
  await insertQuestion(adminUserId, moduleId, runId, 2);
  await executeUpdate("UPDATE exam_entities SET current_published_version_id = ? WHERE id = ?", [versionId, examId]);
  return { examId, versionId };
}

async function shortenActiveModule(attemptId: string): Promise<void> {
  const rows = await queryDb<{ id: string }>(
    "SELECT id FROM assessment_module_attempts WHERE attempt_id = ? AND state = 'active' ORDER BY started_at DESC LIMIT 1",
    [attemptId],
  );
  const moduleAttemptId = rows[0]?.id;
  if (!moduleAttemptId) throw new Error(`Attempt ${attemptId} has no active module.`);
  await executeUpdate(
    "UPDATE assessment_module_attempts SET allocated_seconds = GREATEST(1, TIMESTAMPDIFF(SECOND, started_at, UTC_TIMESTAMP(6)) + 4) WHERE id = ?",
    [moduleAttemptId],
  );
}

async function createClassroomLink(root: string, admin: import("@playwright/test").APIRequestContext, headers: Record<string, string>, examId: string, versionId: string, runId: string) {
  const response = await admin.request.post(`${root}/api/v1/assessment-access/exams/${examId}/links`, {
    headers,
    data: {
      publishedVersionId: versionId,
      name: `Live settings ${runId}`,
      audienceType: "anyone",
      accessMode: "student_code",
      availabilityType: "anytime",
      satSessionMode: "classroom",
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json() as Promise<{ id: string; scheduleId: string }>;
}

async function setExamPolicy(
  root: string,
  admin: import("@playwright/test").APIRequestContext,
  headers: Record<string, string>,
  examId: string,
  patch: Record<string, unknown>,
) {
  const current = await admin.request.get(`${root}/api/v1/exams/${examId}`);
  expect(current.status(), await current.text()).toBe(200);
  const json = await current.json();
  const saved = await admin.request.patch(`${root}/api/v1/exams/${examId}`, {
    headers,
    data: { satLearningDefaults: { ...json.satLearningDefaults, ...patch }, revision: json.revision },
  });
  const body = await saved.json();
  expect(saved.status(), JSON.stringify(body)).toBe(200);
  return body;
}

test.skip(process.env["SAT_LIVE_SETTINGS_E2E_DISPOSABLE"] !== "1", "Requires a disposable SAT E2E database.");
test.afterAll(closeDb);

test("an exam save updates running rooms and a connected student without a refresh", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const admin = await browser.newContext({ storageState: ADMIN_STORAGE_STATE_PATH });
  const student = await browser.newContext();
  try {
    const runId = randomUUID().slice(0, 8);
    const adminUserId = await e2eAdminUserId();
    const root = baseURL!;
    const { examId, versionId } = await seedExam(runId, adminUserId, 180);
    const csrf = (await admin.cookies()).find((cookie) => cookie.name === (process.env["CSRF_COOKIE_NAME"] ?? "csrf"))!.value;
    const headers = { Origin: root, "x-csrf-token": csrf };
    const roomOne = await createClassroomLink(root, admin, headers, examId, versionId, `${runId}-1`);
    const roomTwo = await createClassroomLink(root, admin, headers, examId, versionId, `${runId}-2`);

    const page = await student.newPage();
    await page.goto(`${root}/join/${roomOne.id}`);
    await page.getByLabel("Student ID/WCODE").fill(`W${Date.now().toString().slice(-8)}`);
    await page.getByLabel("Full name").fill("Live Settings Student");
    await page.getByLabel("Email").fill(`live-settings-${runId}@example.test`);
    await page.getByRole("button", { name: /Continue/i }).click();
    await expect(page).toHaveURL(new RegExp(`/student/${roomOne.scheduleId}/[^/]+$`));
    const staff = await admin.newPage();
    await staff.goto(`${root}/sat/sessions/${roomOne.scheduleId}`);
    const code = staff.getByLabel("6-digit exam start code", { exact: true });
    await expect(code).toHaveText(/^\d{6}$/);
    await page.getByLabel("6-digit exam start code").fill(await code.innerText());
    await page.getByRole("button", { name: "Enter code and begin exam" }).click();
    await expect(page.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 60_000 });
    const choiceB = page.locator("label.sat-answer-choice").filter({ hasText: "Choice B" });
    await choiceB.first().click();
    await page.getByRole("button", { name: "Next question", exact: true }).click();
    await choiceB.first().click();
    const [{ id: attemptId }] = await queryDb<{ id: string }>("SELECT id FROM student_attempts WHERE schedule_id = ?", [roomOne.scheduleId]);
    await shortenActiveModule(attemptId);
    // Results are off: the student sees the completion receipt only.
    await expect(page.getByRole("heading", { name: /SAT complete|You're done|Complete/i })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole("region", { name: "Score report" })).toHaveCount(0);

    const exam = await admin.request.get(`${root}/api/v1/exams/${examId}`);
    expect(exam.status(), await exam.text()).toBe(200);
    const examJson = await exam.json();
    const initialPolicy = examJson.satLearningDefaults as Record<string, unknown>;
    const enabled = {
      ...initialPolicy,
      reportVisible: true,
      includeAnswerKeyInPdf: true,
      unlimitedRetakes: true,
      pauseOnLeave: true,
    };
    const saved = await admin.request.patch(`${root}/api/v1/exams/${examId}`, {
      headers,
      data: { satLearningDefaults: enabled, revision: examJson.revision },
    });
    const savedBody = await saved.json();
    expect(saved.status(), JSON.stringify(savedBody)).toBe(200);
    expect(savedBody.satLearningRoomsUpdated).toBe(2);

    // The room rows were updated in the same commit.
    for (const room of [roomOne, roomTwo]) {
      const policy = await admin.request.get(`${root}/api/v1/schedules/${room.scheduleId}/sat-learning-settings`);
      expect(policy.status(), await policy.text()).toBe(200);
      expect(await policy.json()).toMatchObject({
        reportVisible: true,
        includeAnswerKeyInPdf: true,
        unlimitedRetakes: true,
        pauseOnLeave: true,
      });
    }

    // The already-completed student sees the score report without navigating.
    await expect(page.getByRole("region", { name: "Score report" })).toBeVisible({ timeout: 10_000 });

    // Turning results off revokes the report on the same screen.
    const latest = await admin.request.get(`${root}/api/v1/exams/${examId}`);
    const latestJson = await latest.json();
    const off = { ...latestJson.satLearningDefaults, reportVisible: false, includeAnswerKeyInPdf: false };
    const disabled = await admin.request.patch(`${root}/api/v1/exams/${examId}`, {
      headers,
      data: { satLearningDefaults: off, revision: latestJson.revision },
    });
    expect(disabled.status(), await disabled.text()).toBe(200);
    await expect(page.getByRole("region", { name: "Score report" })).toHaveCount(0, { timeout: 10_000 });

    // A room-only save changes that room and leaves the sibling alone.
    const roomTwoPolicyResponse = await admin.request.get(`${root}/api/v1/schedules/${roomTwo.scheduleId}/sat-learning-settings`);
    const roomTwoPolicy = await roomTwoPolicyResponse.json();
    const roomTwoSaved = await admin.request.put(`${root}/api/v1/schedules/${roomTwo.scheduleId}/sat-learning-settings`, {
      headers,
      data: { ...roomTwoPolicy, expectedRevision: roomTwoPolicy.revision, reportVisible: true },
    });
    expect(roomTwoSaved.status(), await roomTwoSaved.text()).toBe(200);
    const roomOneAfter = await admin.request.get(`${root}/api/v1/schedules/${roomOne.scheduleId}/sat-learning-settings`);
    const roomTwoAfter = await admin.request.get(`${root}/api/v1/schedules/${roomTwo.scheduleId}/sat-learning-settings`);
    expect((await roomOneAfter.json()).reportVisible).toBe(false);
    expect((await roomTwoAfter.json()).reportVisible).toBe(true);
  } finally {
    await Promise.all([admin.close(), student.close()]);
  }
});

test("pause and leave turns on and off during an active timed attempt", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const admin = await browser.newContext({ storageState: ADMIN_STORAGE_STATE_PATH });
  const student = await browser.newContext();
  try {
    const runId = randomUUID().slice(0, 8);
    const adminUserId = await e2eAdminUserId();
    const root = baseURL!;
    const { examId, versionId } = await seedExam(runId, adminUserId, 300);
    const csrf = (await admin.cookies()).find((cookie) => cookie.name === (process.env["CSRF_COOKIE_NAME"] ?? "csrf"))!.value;
    const headers = { Origin: root, "x-csrf-token": csrf };
    const room = await createClassroomLink(root, admin, headers, examId, versionId, `${runId}-pause`);

    const page = await student.newPage();
    await page.goto(`${root}/join/${room.id}`);
    await page.getByLabel("Student ID/WCODE").fill(`W${Date.now().toString().slice(-8)}`);
    await page.getByLabel("Full name").fill("Pause Settings Student");
    await page.getByLabel("Email").fill(`pause-settings-${runId}@example.test`);
    await page.getByRole("button", { name: /Continue/i }).click();
    await expect(page).toHaveURL(new RegExp(`/student/${room.scheduleId}/[^/]+$`));
    const staff = await admin.newPage();
    await staff.goto(`${root}/sat/sessions/${room.scheduleId}`);
    const code = staff.getByLabel("6-digit exam start code", { exact: true });
    await expect(code).toHaveText(/^\d{6}$/);
    await page.getByLabel("6-digit exam start code").fill(await code.innerText());
    await page.getByRole("button", { name: "Enter code and begin exam" }).click();
    await expect(page.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 60_000 });
    // Pause is off at admission: no control, even after the first policy read.
    await expect(page.getByRole("button", { name: "Pause and leave" })).toHaveCount(0);

    await setExamPolicy(root, admin, headers, examId, { pauseOnLeave: true });
    const pause = page.getByRole("button", { name: "Pause and leave" });
    await expect(pause).toBeVisible({ timeout: 10_000 });
    await pause.click();
    await expect(page.getByRole("heading", { name: "Exam paused" })).toBeVisible();

    // Revoking while paused keeps the permitted continuation: resume still works.
    await setExamPolicy(root, admin, headers, examId, { pauseOnLeave: false });
    const resume = page.getByRole("button", { name: "Resume exam" });
    await expect(resume).toBeVisible();
    await resume.click();
    await expect(page.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Pause and leave" })).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await Promise.all([admin.close(), student.close()]);
  }
});

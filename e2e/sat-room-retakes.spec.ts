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

test("Classroom start code, WCODE retake, pause and keyed PDF", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const admin = await browser.newContext({ storageState: ADMIN_STORAGE_STATE_PATH });
  const student = await browser.newContext();
  try {
    const runId = randomUUID().slice(0, 8);
    const adminUserId = await e2eAdminUserId();
    const { examId, versionId } = await seedPublishedSatExam({
      runId, adminUserId, questionCount: 2, moduleSeconds: 180,
    });
    const root = baseURL!;
    const csrf = (await admin.cookies()).find((cookie) => cookie.name === (process.env["CSRF_COOKIE_NAME"] ?? "csrf"))!.value;
    const headers = { Origin: root, "x-csrf-token": csrf };
    const linkResponse = await admin.request.post(`${root}/api/v1/assessment-access/exams/${examId}/links`, {
      headers,
      data: {
        publishedVersionId: versionId, name: `SAT Classroom ${runId}`,
        audienceType: "anyone", accessMode: "student_code", availabilityType: "anytime",
        satSessionMode: "classroom",
      },
    });
    expect(linkResponse.status(), await linkResponse.text()).toBe(201);
    const { id: linkId, scheduleId } = await linkResponse.json();
    const settingsUrl = `${root}/api/v1/schedules/${scheduleId}/sat-learning-settings`;
    const settings = await admin.request.get(settingsUrl);
    expect(settings.status(), await settings.text()).toBe(200);
    const initial = await settings.json();
    expect(initial).toMatchObject({ unlimitedRetakes: true, reportVisible: true, includeAnswerKeyInPdf: false });
    const saved = await admin.request.put(settingsUrl, {
      headers,
      data: { ...initial, expectedRevision: initial.revision, includeAnswerKeyInPdf: true, pauseOnLeave: true },
    });
    expect(saved.status(), await saved.text()).toBe(200);

    const page = await student.newPage();
    await page.goto(`${root}/join/${linkId}`);
    await page.getByLabel("Student ID/WCODE").fill(`W${Date.now().toString().slice(-8)}`);
    await page.getByLabel("Full name").fill("SAT Retake Student");
    await page.getByLabel("Email").fill(`sat-retake-${runId}@example.test`);
    await page.getByRole("button", { name: /Continue/i }).click();
    await expect(page).toHaveURL(new RegExp(`/student/${scheduleId}/[^/]+$`));
    await expect(page.getByRole("heading", { name: "Enter your exam start code" })).toBeVisible();
    const staff = await admin.newPage();
    await staff.goto(`${root}/sat/sessions/${scheduleId}`);
    const code = staff.getByLabel("6-digit exam start code", { exact: true });
    await expect(code).toHaveText(/^\d{6}$/);
    await page.getByLabel("6-digit exam start code").fill(await code.innerText());
    await page.getByRole("button", { name: "Enter code and begin exam" }).click();
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
    const settingsEditor = await admin.newPage();
    await settingsEditor.goto(`${root}/sat/exams/${examId}/settings?panel=scoring`);
    await settingsEditor.getByRole("button", { name: "Customize PDF" }).click();
    const editor = settingsEditor.getByRole("dialog", { name: "Customize PDF" });
    await editor.getByRole("button", { name: "Add image after Cover" }).click();
    const image = await readFile("src/assets/warwick-institute-logo.png");
    await editor.getByLabel("Choose image").setInputFiles({ name: "Orientation.png", mimeType: "image/png", buffer: image });
    await editor.getByLabel("Image description").fill("Orientation slide");
    await editor.getByRole("button", { name: "Use image" }).click();
    await expect(editor.getByRole("region", { name: "Cover image pages" }).getByText("Orientation.png", { exact: true })).toBeVisible();
    await editor.getByRole("button", { name: "Branding" }).click();
    await editor.getByRole("button", { name: "Replace left watermark" }).click();
    await editor.getByLabel("Choose image").setInputFiles({ name: "Campus-logo.png", mimeType: "image/png", buffer: image });
    await editor.getByRole("button", { name: "Use image" }).click();
    await expect(editor.getByRole("listitem").filter({ hasText: "Left watermark" }).getByText("Campus-logo.png", { exact: true })).toBeVisible();
    await editor.getByRole("button", { name: "Preview PDF" }).click();
    await expect(editor.getByRole("link", { name: "Download sample PDF" })).toBeVisible({ timeout: 90_000 });
    await editor.getByRole("button", { name: "Back to editor" }).click();
    await editor.getByRole("button", { name: "Save layout" }).click();
    await expect(editor.getByText("Layout saved. New PDFs use this layout.")).toBeVisible();
    await settingsEditor.reload({ waitUntil: "domcontentloaded" });
    await settingsEditor.getByRole("button", { name: "Customize PDF" }).click();
    await expect(editor.getByRole("region", { name: "Cover image pages" }).getByText("Orientation.png")).toBeVisible();
    await settingsEditor.close();
    const download = page.waitForEvent("download", { timeout: 90_000 });
    const prepare = page.waitForResponse((res) => res.url().endsWith(`/schedules/${scheduleId}/prepare`));
    await page.getByRole("button", { name: "Download exam PDF" }).click();
    const prepared = await prepare;
    expect(prepared.status(), await prepared.text()).toBe(200);
    expect(prepared.request().postDataJSON()).toMatchObject({ includeAnswerKey: true });
    const pdf = await readFile(await (await download).path());
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");

    const latest = await saved.json();
    const revoke = await admin.request.put(settingsUrl, {
      headers, data: { ...latest, expectedRevision: latest.revision, includeAnswerKeyInPdf: false },
    });
    expect(revoke.status(), await revoke.text()).toBe(200);
    const href = await page.getByRole("link", { name: "Download PDF again" }).getAttribute("href");
    expect((await student.request.head(new URL(href!, root).href)).status()).toBe(404);

    const credentialKey = "ielts_student_attempt_credentials_v1";
    const previousGrants = await page.evaluate((key) => ({
      local: localStorage.getItem(key),
      session: sessionStorage.getItem(key),
    }), credentialKey);
    expect(JSON.parse(previousGrants.local ?? "[]")).toContainEqual(expect.objectContaining({
      attemptId, credentialPolicy: "sitting_v1",
    }));

    const retake = page.waitForResponse((res) => res.url().endsWith(`/sat/practice/schedules/${scheduleId}/attempts`) && res.request().method() === "POST");
    await page.getByRole("button", { name: "Start exam again" }).click();
    expect((await retake).status()).toBe(200);
    const [{ id: nextAttemptId }] = await queryDb<{ id: string }>(
      "SELECT sa.id FROM student_attempts sa JOIN sat_attempt_learning l ON l.attempt_id = sa.id WHERE sa.schedule_id = ? AND l.ordinal = 2",
      [scheduleId],
    );
    expect(nextAttemptId).not.toBe(attemptId);
    await expect(page.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 20_000 });
    await expect(choices.first()).toBeVisible();
    await expect(choices.first().locator("input")).not.toBeChecked();

    // Re-create the state of a browser whose earlier retake was admitted but
    // whose reload was still bound to the submitted attempt's grant.
    await page.evaluate(({ key, local, session }) => {
      if (local) localStorage.setItem(key, local);
      if (session) sessionStorage.setItem(key, session);
      else sessionStorage.removeItem(key);
    }, { key: credentialKey, ...previousGrants });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: "Score report" })).toBeVisible();
    await page.getByRole("button", { name: "Open new attempt" }).click();
    await expect(page.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 20_000 });
    await expect(choices.first().locator("input")).not.toBeChecked();

    const attempts = await queryDb<{ id: string; submitted: number }>(
      "SELECT id, submitted_at IS NOT NULL AS submitted FROM student_attempts WHERE schedule_id = ?",
      [scheduleId],
    );
    expect(attempts).toHaveLength(2);
    expect(attempts).toEqual(expect.arrayContaining([
      { id: attemptId, submitted: 1 },
      { id: nextAttemptId, submitted: 0 },
    ]));

    await staff.reload({ waitUntil: "domcontentloaded" });
    const roster = staff.getByRole("option").filter({ hasText: "SAT Retake Student" });
    await expect(roster).toHaveCount(2);
    const firstRoomRow = staff.getByRole("option", { name: /SAT Retake Student, Attempt 1/ });
    const secondRoomRow = staff.getByRole("option", { name: /SAT Retake Student, Attempt 2/ });
    await expect(firstRoomRow.getByText("Attempt 1", { exact: true })).toBeVisible();
    await expect(firstRoomRow).toContainText("Finished");
    await expect(secondRoomRow.getByText("Attempt 2", { exact: true })).toBeVisible();
    await staff.goto(`${root}/sat/exams/${examId}/responses?access=${scheduleId}`);
    const rows = staff.getByRole("row").filter({ hasText: "SAT Retake Student" });
    await expect(rows).toHaveCount(2);
    await rows.getByRole("button", { name: /^View answers for/ }).click();
    await expect(staff).toHaveURL(new RegExp(`[?&]attempt=${attemptId}(&|$)`));

    const correctChoices = page.locator("label.sat-answer-choice").filter({ hasText: "Choice A" });
    await correctChoices.first().click();
    await page.getByRole("button", { name: "Next question", exact: true }).click();
    await correctChoices.first().click();
    await expect(page.getByTestId("sat-exam-shell")).toHaveAttribute("data-sat-save-state", "idle");
    const completedPath = `/api/v1/sat/practice/schedules/${scheduleId}/completed-attempts`;
    const listRequest = page.waitForRequest((request) => new URL(request.url()).pathname === completedPath);
    await shortenActiveModule(nextAttemptId);
    const attemptPicker = page.getByLabel("View results for");
    await expect(attemptPicker).toHaveValue(nextAttemptId, { timeout: 60_000 });
    await expect(page.getByRole("region", { name: "Scored practice questions" })).toContainText(/2 of 2\s+correct/);

    const historyHeaders = { Authorization: (await (await listRequest).headerValue("authorization"))! };
    const unavailable = await student.request.get(`${root}${completedPath}?attemptId=${randomUUID()}`, { headers: historyHeaders });
    expect(unavailable.status()).toBe(404);

    let releaseOldReport: () => void = () => undefined;
    const holdOldReport = new Promise<void>((resolve) => { releaseOldReport = resolve; });
    await page.route((url) => url.pathname === completedPath && url.searchParams.get("attemptId") === attemptId, async (route) => {
      await holdOldReport;
      await route.continue();
    }, { times: 1 });
    try {
      await attemptPicker.selectOption(attemptId);
      await expect(page.getByText("Loading Attempt 1 results…")).toBeVisible();
      await expect(attemptPicker).toBeEnabled();
      await expect(page.getByRole("button", { name: "Download exam PDF" })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Scored practice questions" })).toHaveCount(0);
    } finally {
      releaseOldReport();
    }
    await expect(page.getByRole("region", { name: "Scored practice questions" })).toContainText(/0 of 2\s+correct/);

    const updatedPolicy = await revoke.json();
    const enableKeys = await admin.request.put(settingsUrl, {
      headers, data: { ...updatedPolicy, expectedRevision: updatedPolicy.revision, includeAnswerKeyInPdf: true },
    });
    expect(enableKeys.status(), await enableKeys.text()).toBe(200);

    const oldPdfDownload = page.waitForEvent("download", { timeout: 90_000 });
    const oldPdfPrepare = page.waitForResponse((response) => new URL(response.url()).searchParams.get("attemptId") === attemptId
      && new URL(response.url()).pathname.endsWith("/prepare"));
    await page.getByRole("button", { name: "Download exam PDF" }).click();
    const oldPdfPrepared = await oldPdfPrepare;
    expect(oldPdfPrepared.status(), await oldPdfPrepared.text()).toBe(200);
    expect(oldPdfPrepared.request().postDataJSON()).toMatchObject({
      includeAnswerKey: true,
      view: { subjects: [{ rawCorrect: 0, rawTotal: 2 }] },
    });
    const oldPdf = await readFile(await (await oldPdfDownload).path());
    expect(oldPdf.subarray(0, 4).toString()).toBe("%PDF");

    await attemptPicker.selectOption(nextAttemptId);
    await expect(page.getByRole("region", { name: "Scored practice questions" })).toContainText(/2 of 2\s+correct/);
    await expect(page.getByRole("link", { name: "Download PDF again" })).toHaveCount(0);
  } finally {
    await Promise.all([admin.close(), student.close()]);
  }
});

test("teachers can save options at exam creation and edit them later", async ({ browser, baseURL }) => {
  test.setTimeout(60_000);
  const admin = await browser.newContext({ storageState: ADMIN_STORAGE_STATE_PATH });
  try {
    const page = await admin.newPage();
    await page.goto(`${baseURL}/sat/exams`);
    await page.getByRole("button", { name: "Create exam", exact: true }).first().click();
    const wizard = page.getByRole("dialog", { name: "New exam" });
    await wizard.getByLabel("Exam name").fill(`Retake settings ${randomUUID().slice(0, 8)}`);
    await wizard.getByRole("button", { name: "Continue", exact: true }).click();
    await wizard.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(wizard.getByRole("switch", { name: "Allow retakes" })).toBeChecked();
    await expect(wizard.getByRole("switch", { name: "Show results" })).not.toBeChecked();
    await wizard.getByRole("switch", { name: "Show results" }).check();
    await wizard.getByRole("switch", { name: "Include answer key in PDF" }).check();
    await wizard.getByRole("button", { name: "Continue", exact: true }).click();
    const create = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith("/v1/exams"));
    await wizard.getByRole("button", { name: "Create exam", exact: true }).click({ noWaitAfter: true });
    const created = await create;
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    await page.goto(`${baseURL}/sat/exams/${id}/settings`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("switch", { name: "Include answer key in PDF" })).toBeChecked();
    await page.getByRole("switch", { name: "Allow retakes" }).uncheck();
    const save = page.getByRole("button", { name: "Save settings" });
    await save.click();
    await expect(page.getByRole("button", { name: /^(Save settings|Saving…)$/ })).toHaveCount(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("switch", { name: "Allow retakes" })).not.toBeChecked();
    await expect(page.getByRole("switch", { name: "Show results" })).toBeChecked();
  } finally {
    await admin.close();
  }
});

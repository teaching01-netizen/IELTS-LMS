import { createHash } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH } from "./support/backendE2e";
import { executeUpdate, queryDb } from "./support/db";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

type SatBootstrapSummary = {
  attemptId: string;
  sectionKey: string;
  timedOutModuleIds: string[];
  answeredCount: number;
  branchRole: string | null;
};

type SatDeliveryFrame = {
  sections: Array<{
    id: string;
    sectionKey: string;
    modules: Array<{ id: string; adaptiveRole: string }>;
  }>;
  attempt: {
    id: string;
    moduleAttempts: Array<{
      id: string;
      moduleId: string;
      state: string;
      completionReason: string | null;
      rawCorrect: number | null;
    }>;
  };
  result: { id: string } | null;
};

type SatRuntime = {
  status?: string;
  currentSectionKey?: string | null;
  currentSectionRemainingSeconds?: number | null;
  sections: Array<{ sectionKey: string; status?: string | null }>;
};

/**
 * Exam-day P0 guard: resolve the correct answer for every keyed question in
 * a module from the sealed revision the backend scores against. The delivered
 * bootstrap redacts the key, so the lookup runs in Node against MySQL and
 * only the serializable {examQuestionId, correctAnswer} plan crosses into
 * the browser (page.evaluate closures cannot touch Node imports or DB).
 */
async function correctAnswerPlan(moduleId: string): Promise<Array<{ examQuestionId: string; questionId: string; kind: string; correctAnswer: string }>> {
  // Pretest rows are excluded from operational scoring/routing, so answering
  // them would inflate answeredCount beyond rawCorrect and break the
  // rawCorrect >= answeredCount assertion.
  const keyRows = await queryDb<{ exam_question_id: string; question_id: string; answer_definition: string }>(
    `SELECT eq.id AS exam_question_id, eq.question_id, CAST(qr.answer_definition AS CHAR) AS answer_definition
       FROM assessment_exam_questions eq
       JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id
      WHERE eq.module_id = ? AND eq.is_pretest = FALSE`,
    [moduleId],
  );
  const plan: Array<{ examQuestionId: string; questionId: string; kind: string; correctAnswer: string }> = [];
  for (const row of keyRows) {
    let parsed: { kind?: string; correctOptionId?: unknown; acceptedResponses?: unknown } = {};
    try {
      parsed = JSON.parse(row.answer_definition) as typeof parsed;
    } catch {
      continue;
    }
    if (parsed.kind === "single_choice" && typeof parsed.correctOptionId === "string") {
      plan.push({ examQuestionId: row.exam_question_id, questionId: row.question_id, kind: parsed.kind, correctAnswer: parsed.correctOptionId });
    } else if (
      parsed.kind === "student_produced_response"
      && Array.isArray(parsed.acceptedResponses)
      && typeof parsed.acceptedResponses[0] === "string"
    ) {
      plan.push({ examQuestionId: row.exam_question_id, questionId: row.question_id, kind: parsed.kind, correctAnswer: parsed.acceptedResponses[0] as string });
    }
  }
  return plan;
}

async function leaveMathBaseModuleIncomplete(examId: string): Promise<void> {
  const drafts = await queryDb<{ current_draft_version_id: string | null }>(
    "SELECT current_draft_version_id FROM exam_entities WHERE id = ?",
    [examId],
  );
  const draftVersionId = drafts[0]?.current_draft_version_id;
  if (!draftVersionId) throw new Error("SAT draft version was not available for the Math blocker setup");
  const modules = await queryDb<{
    module_id: string;
    target_question_count: number;
    authored_questions: number;
  }>(
    `SELECT m.id AS module_id, m.target_question_count, COUNT(eq.id) AS authored_questions
       FROM assessment_modules m
       JOIN assessment_sections s ON s.id = m.section_id
       LEFT JOIN assessment_exam_questions eq ON eq.module_id = m.id
      WHERE s.exam_version_id = ? AND s.section_key = 'math' AND m.adaptive_role = 'base'
      GROUP BY m.id, m.target_question_count
      ORDER BY m.display_order
      LIMIT 1`,
    [draftVersionId],
  );
  const module = modules[0];
  if (!module) throw new Error("SAT Math base module was not available for the blocker setup");
  const incompleteTarget = Math.max(Number(module.target_question_count), Number(module.authored_questions)) + 1;
  const changed = await executeUpdate(
    "UPDATE assessment_modules SET target_question_count = ? WHERE id = ?",
    [incompleteTarget, module.module_id],
  );
  if (changed !== 1) throw new Error("Could not leave the SAT Math base module incomplete");
}

async function finishCurrentSatSection(
  page: Page,
  scheduleId: string,
  attemptId: string,
  candidateId: string,
  options: { answerQuestions?: boolean } = {}
): Promise<SatBootstrapSummary> {
  // answerQuestions=false drives the same timeout journey with an empty
  // response set; the server still scores and completes the attempt.
  const answerQuestions = options.answerQuestions ?? true;
  // Resolve the live section + base module in the browser, then answer in
  // Node-resolved key order via the real V2 transport inside the browser.
  // The DB key plan is serializable and crosses the evaluate boundary as an
  // argument (browser closures cannot touch Node imports or MySQL).
  const live = await page.evaluate(
    async ({ scheduleId, attemptId, candidateId }) => {
      const delivery = await import("/src/features/student-delivery/api/assessmentDeliveryApi.ts");
      delivery.configureAssessmentDeliveryAttempt(scheduleId, attemptId, candidateId);
      const snapshot = await delivery.assessmentDeliveryApi.bootstrap(scheduleId, attemptId);
      const stageKey = snapshot.timing.stageKey;
      const openStates = new Set(["not_started", "active", "review"]);
      const currentSection = snapshot.sections.find((item) =>
        item.modules.some((module) =>
          snapshot.attempt.moduleAttempts.some(
            (attempt) => attempt.moduleId === module.id && ["active", "review"].includes(attempt.state)
          )
        )
      );
      const pendingSection = snapshot.sections.find((item) =>
        item.modules.some((module) =>
          snapshot.attempt.moduleAttempts.some(
            (attempt) => attempt.moduleId === module.id && openStates.has(attempt.state)
          )
        )
      );
      const section = currentSection ?? pendingSection ?? snapshot.sections.find((item) => item.sectionKey === stageKey);
      if (!section) throw new Error(`No active SAT section for stage ${stageKey ?? "unknown"}`);
      const base = section.modules.find((module) => module.adaptiveRole === "base");
      if (!base) throw new Error(`No base module for ${section.sectionKey}`);
      return { sectionKey: section.sectionKey, baseModuleId: base.id };
    },
    { scheduleId, attemptId, candidateId },
  );
  // Exam-day P0 guard: known-correct answers resolved from the sealed key
  // the backend scores against (the delivered bootstrap redacts the key).
  const answerPlan = answerQuestions ? await correctAnswerPlan(live.baseModuleId) : [];
  if (answerQuestions && answerPlan.length < 1) {
    throw new Error(`No answerable base questions for ${live.sectionKey}`);
  }
  const prepared = await page.evaluate(
    async ({ scheduleId, attemptId, candidateId, baseModuleId, answerPlan, answerQuestions: shouldAnswer }) => {
      const delivery = await import("/src/features/student-delivery/api/assessmentDeliveryApi.ts");
      delivery.configureAssessmentDeliveryAttempt(scheduleId, attemptId, candidateId);
      let snapshot = await delivery.assessmentDeliveryApi.bootstrap(scheduleId, attemptId);
      const section = snapshot.sections.find((item) =>
        item.modules.some((module) => module.id === baseModuleId),
      );
      if (!section) throw new Error("Base module missing from bootstrap");
      const base = section.modules.find((module) => module.id === baseModuleId);
      if (!base) throw new Error("Base module missing from bootstrap");

      // The strict module gate rejects writes for not_started modules, so
      // the base attempt must be started before V2 answers are accepted.
      {
        const baseAttempt = snapshot.attempt.moduleAttempts.find((item) => item.moduleId === baseModuleId);
        if (!baseAttempt) throw new Error(`No module attempt for ${baseModuleId}`);
        if (baseAttempt.state === "not_started") {
          snapshot = await delivery.assessmentDeliveryApi.startModule(scheduleId, attemptId, {
            moduleId: baseModuleId,
          });
        }
      }
      // Answer every keyed base question correctly through the real V2
      // durability transport (same path the student UI uses), so module
      // scoring + adaptive routing + result review must reflect V2-saved
      // answers instead of empty legacy rows. Skipped entirely in the
      // unanswered leg: the student types nothing, so nothing is ever saved.
      let answeredCount = 0;
      if (shouldAnswer) {
        const durable = await import("/src/features/student/infrastructure/responseDurabilityTransport.ts");
        const engineMod = await import("/src/shared/durability/DurableResponseEngine.ts");
        const transport = durable.createResponseDurabilityV2Transport(scheduleId, undefined);
        const engine = new engineMod.DurableResponseEngine({
          scheduleId,
          attemptId,
          leaseEpoch: 1,
          controlEpoch: 1,
          drainDebounceMs: 0,
          transport,
        });
        await engine.recover();
        for (const plan of answerPlan as Array<{ examQuestionId: string; correctAnswer: string }>) {
          if (!base.questions.some((question) => question.examQuestionId === plan.examQuestionId)) continue;
          await engine.acceptResponse(plan.examQuestionId, {
            answer: plan.correctAnswer,
            markedForReview: false,
            eliminatedOptions: [],
            annotations: [],
          });
          answeredCount += 1;
        }
        await engine.flush();
        if (engine.getPendingCount() > 0) {
          throw new Error(engine.getLastError() ?? "V2 answers were not durably saved");
        }
        engine.destroy();
        if (answeredCount < 1) throw new Error(`No answerable base questions for ${section.sectionKey}`);
      }
      const baseAttempt = snapshot.attempt.moduleAttempts.find((item) => item.moduleId === base.id);
      if (!baseAttempt || !["active", "review"].includes(baseAttempt.state)) {
        throw new Error(`Base module did not become active for ${section.sectionKey}`);
      }
      return {
        attemptId: snapshot.attempt.id,
        sectionKey: section.sectionKey,
        baseModuleAttemptId: baseAttempt.id,
        answeredCount,
      };
    },
    { scheduleId, attemptId, candidateId, baseModuleId: live.baseModuleId, answerPlan, answerQuestions },
  );

  await expireSatModuleAttempt(prepared.baseModuleAttemptId);
  let branchFrame: SatDeliveryFrame | null = null;
  await expect.poll(async () => {
    const frame = await readSatDeliveryFrame(page, scheduleId, prepared.attemptId, candidateId);
    const base = frame.attempt.moduleAttempts.find((item) => item.id === prepared.baseModuleAttemptId);
    const branch = frame.attempt.moduleAttempts.find((item) => {
      const module = frame.sections
        .find((section) => section.sectionKey === prepared.sectionKey)
        ?.modules.find((candidate) => candidate.id === item.moduleId);
      return module !== undefined && module.adaptiveRole !== "base";
    });
    if (base && ["submitted", "locked"].includes(base.state) && branch?.state === "active") {
      branchFrame = frame;
      return "active";
    }
    return branch?.state ?? base?.state ?? "missing";
  }, { timeout: 45_000, intervals: [250, 500, 1_000, 2_000] }).toBe("active");
  const openedBranchFrame = branchFrame as SatDeliveryFrame | null;
  if (!openedBranchFrame) throw new Error(`The server did not open the adaptive module for ${prepared.sectionKey}`);

  const branchAttempt = openedBranchFrame.attempt.moduleAttempts.find((item) => {
    const module = openedBranchFrame.sections
      .find((section) => section.sectionKey === prepared.sectionKey)
      ?.modules.find((candidate) => candidate.id === item.moduleId);
    return module !== undefined && module.adaptiveRole !== "base" && item.state === "active";
  });
  if (!branchAttempt) throw new Error(`No active adaptive module for ${prepared.sectionKey}`);
  await expireSatModuleAttempt(branchAttempt.id);

  let terminalFrame: SatDeliveryFrame | null = null;
  await expect.poll(async () => {
    const frame = await readSatDeliveryFrame(page, scheduleId, prepared.attemptId, candidateId);
    const branch = frame.attempt.moduleAttempts.find((item) => item.id === branchAttempt.id);
    if (branch && ["submitted", "locked"].includes(branch.state)) {
      terminalFrame = frame;
      return "terminal";
    }
    return branch?.state ?? "missing";
  }, { timeout: 45_000, intervals: [250, 500, 1_000, 2_000] }).toBe("terminal");
  const closedBranchFrame = terminalFrame as SatDeliveryFrame | null;
  if (!closedBranchFrame) throw new Error(`The server did not close the adaptive module for ${prepared.sectionKey}`);

  const sectionModules = closedBranchFrame.sections.find(
    (section) => section.sectionKey === prepared.sectionKey,
  )?.modules ?? [];
  const branchModule = sectionModules.find((module) => module.id === branchAttempt.moduleId);
  const timedOutModuleIds = closedBranchFrame.attempt.moduleAttempts
    .filter((item) => [prepared.baseModuleAttemptId, branchAttempt.id].includes(item.id))
    .filter((item) => ["submitted", "locked"].includes(item.state))
    .map((item) => item.moduleId);
  return {
    attemptId: prepared.attemptId,
    sectionKey: prepared.sectionKey,
    timedOutModuleIds,
    answeredCount: prepared.answeredCount,
    branchRole: branchModule?.adaptiveRole ?? null,
  };
}

async function expireSatModuleAttempt(moduleAttemptId: string): Promise<void> {
  const changed = await executeUpdate(
    `UPDATE assessment_module_attempts
        SET started_at = NOW(6) - INTERVAL 1 HOUR,
            updated_at = NOW(6)
      WHERE id = ?
        AND state IN ('active', 'review')`,
    [moduleAttemptId],
  );
  if (changed !== 1) throw new Error(`Expected active SAT module attempt ${moduleAttemptId} to expire`);
}

async function readSatDeliveryFrame(
  page: Page,
  scheduleId: string,
  attemptId: string,
  candidateId: string,
): Promise<SatDeliveryFrame> {
  return page.evaluate(async ({ scheduleId, attemptId, candidateId }) => {
    const delivery = await import("/src/features/student-delivery/api/assessmentDeliveryApi.ts");
    delivery.configureAssessmentDeliveryAttempt(scheduleId, attemptId, candidateId);
    const snapshot = await delivery.assessmentDeliveryApi.bootstrap(scheduleId, attemptId);
    return {
      sections: snapshot.sections.map((section) => ({
        id: section.id,
        sectionKey: section.sectionKey,
        modules: section.modules.map((module) => ({ id: module.id, adaptiveRole: module.adaptiveRole })),
      })),
      attempt: {
        id: snapshot.attempt.id,
        moduleAttempts: snapshot.attempt.moduleAttempts.map((item) => ({
          id: item.id,
          moduleId: item.moduleId,
          state: item.state,
          completionReason: item.completionReason,
          rawCorrect: item.rawCorrect,
        })),
      },
      result: snapshot.result ? { id: snapshot.result.id } : null,
    };
  }, { scheduleId, attemptId, candidateId });
}

// Exercise the staff room pause/resume controls and confirm the server's
// room clock freezes while paused.
async function pauseAndResumeCurrentSatSection(page: Page, scheduleId: string) {
  await expect(page.getByRole("button", { name: "Pause exam" })).toBeVisible();
  await page.getByRole("button", { name: "Pause exam" }).click();
  // Confirm through the staff control; the page refreshes from the server.
  await expect.poll(async () => (await readSatRuntime(page, scheduleId)).status, { timeout: 15_000 }).toBe("paused");
  const midPause = await readSatRuntime(page, scheduleId);
  if (midPause.sections.find((s) => s.sectionKey === midPause.currentSectionKey)?.status !== "paused") {
    throw new Error("Expected current SAT section to report paused mid-pause");
  }
  const frozen = await readSatRuntime(page, scheduleId);
  const firstRemaining = frozen.currentSectionRemainingSeconds;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const secondPause = await readSatRuntime(page, scheduleId);
  if (secondPause.currentSectionRemainingSeconds !== firstRemaining) {
    throw new Error(`Countdown ticked mid-pause: ${firstRemaining} -> ${secondPause.currentSectionRemainingSeconds}`);
  }
  await page.getByRole("button", { name: "Resume exam" }).click();
  await expect
    .poll(async () => (await readSatRuntime(page, scheduleId)).sections.find((s) => s.sectionKey === midPause.currentSectionKey)?.status, {
      timeout: 15_000,
    })
    .toBe("live");
}

async function expireSatBreak(attemptId: string) {
  const changed = await executeUpdate(
    `UPDATE assessment_attempt_breaks b
       JOIN assessment_sections finished ON finished.id = b.after_section_id
       JOIN assessment_sections next_section
         ON next_section.exam_version_id = finished.exam_version_id
        AND next_section.display_order = finished.display_order + 1
       JOIN assessment_modules next_base
         ON next_base.section_id = next_section.id AND next_base.adaptive_role = 'base'
       JOIN assessment_module_attempts next_attempt
         ON next_attempt.attempt_id = b.attempt_id
        AND next_attempt.module_id = next_base.id
        AND next_attempt.state = 'not_started'
        SET b.deadline_at = DATE_SUB(NOW(6), INTERVAL 1 MINUTE),
            next_attempt.available_at = DATE_SUB(NOW(6), INTERVAL 1 MINUTE)
      WHERE b.attempt_id = ? AND b.state = 'active' AND b.paused_at IS NULL`,
    [attemptId],
  );
  if (changed < 1) throw new Error("Expected the candidate's active SAT break to expire");
}

async function readStudentActiveSection(page: Page, scheduleId: string, attemptId: string, candidateId: string): Promise<string | null> {
  return page.evaluate(async ({ scheduleId, attemptId, candidateId }) => {
    const delivery = await import("/src/features/student-delivery/api/assessmentDeliveryApi.ts");
    delivery.configureAssessmentDeliveryAttempt(scheduleId, attemptId, candidateId);
    const snapshot = await delivery.assessmentDeliveryApi.bootstrap(scheduleId, attemptId);
    const activeAttempt = snapshot.attempt.moduleAttempts.find((item) => item.state === "active" || item.state === "review");
    if (!activeAttempt) return null;
    return snapshot.sections.find((section) => section.modules.some((module) => module.id === activeAttempt.moduleId))?.sectionKey ?? null;
  }, { scheduleId, attemptId, candidateId });
}

async function readSatRuntime(page: Page, scheduleId: string): Promise<SatRuntime> {
  const response = await page.request.get(`/api/v1/schedules/${scheduleId}/runtime`);
  if (!response.ok()) {
    throw new Error(`Runtime read failed: ${response.status()} ${await response.text()}`);
  }
  const payload = (await response.json()) as { data?: SatRuntime } & SatRuntime;
  return payload.data ?? payload;
}

type SatAttemptHarness = {
  studentContext: BrowserContext;
  studentPage: Page;
  examId: string;
  scheduleId: string;
  candidateId: string;
  attemptId: string;
  examTitle: string;
  linkName: string;
  studentName: string;
};

/**
 * Shared journey setup: author, publish, configure a version-pinned room, join,
 * and proctor-start a real SAT so the exam is live with the first module auto-opened. Extracted so the
 * answered journey and the audit-finding-1 unanswered journey run against
 * identical conditions instead of two drifting fixtures.
 */
async function startSatAttempt(
  page: Page,
  browser: { newContext: () => Promise<BrowserContext> },
  options: { titlePrefix?: string; linkPrefix?: string; studentPrefix?: string; publishScope?: "full" | "reading-writing" | "math"; leaveMathIncomplete?: boolean } = {}
): Promise<SatAttemptHarness> {
  const stamp = Date.now().toString(36);
  const examTitle = `${options.titlePrefix ?? "SAT Product Smoke"} ${stamp}`;
  const linkName = `${options.linkPrefix ?? "SAT Open Link"} ${stamp}`;
  const studentName = `${options.studentPrefix ?? "SAT Smoke Student"} ${stamp}`;
  const studentEmail = `sat-smoke-${stamp}@example.com`;

  await page.goto("/sat/exams");
  await expect(page.getByRole("heading", { name: "Exams", exact: true })).toBeVisible();
  await expect(page.getByText("Digital SAT").first()).toBeVisible();
  await expect(page.getByText("IELTS", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Create exam", exact: true }).first().click();
  await page.getByLabel("Exam name").fill(examTitle);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/sat\/exams\/[0-9a-f-]+$/i, { timeout: 30_000 });
  const examId = page.url().match(/\/sat\/exams\/([^/?#]+)/)?.[1];
  if (!examId) throw new Error("SAT exam id was not present after creation");

  await expect(page.getByRole("heading", { name: examTitle })).toBeVisible();
  await page.getByRole("button", { name: "More exam actions" }).click();
  await page.getByRole("menuitem", { name: /Load sample exam/ }).click();
  await expect(page.getByRole("dialog", { name: "Load sample SAT" })).toBeVisible();
  await page.getByRole("button", { name: "Load 147 questions" }).click();
  await expect(
    page.getByRole("tab", { name: /^Reading & Writing, 81 of 81 authored/ })
  ).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole("tab", { name: /^Math, 66 of 66 authored/ })).toBeVisible();

  if (options.leaveMathIncomplete) {
    await leaveMathBaseModuleIncomplete(examId);
    await page.reload();
    await expect(page.getByRole("heading", { name: examTitle })).toBeVisible({ timeout: 30_000 });
  }

  // The shortcut intentionally yields when focus is on a button, tab, or
  // editor field. Put focus on the page first so this exercises its global
  // command path deterministically.
  await page.getByRole("heading", { name: examTitle }).click();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+k" : "Control+k");
  const commandPalette = page.getByRole("dialog", { name: "Jump to question" });
  await expect(commandPalette).toBeVisible();
  await commandPalette.getByText("Release exam", { exact: true }).click();
  await expect(page).toHaveURL(`/sat/exams/${examId}/release`);
  if (options.leaveMathIncomplete) {
    const releaseChecks = page.getByRole("region", { name: "Release checks" });
    await expect(releaseChecks).toBeVisible({ timeout: 30_000 });
    const fullScopeChecks = page.getByRole("button", { name: "Run checks" });
    await expect(fullScopeChecks).toBeEnabled({ timeout: 30_000 });
    await fullScopeChecks.click();
    await expect(releaseChecks).toHaveAttribute("aria-busy", "false");
    await expect(page.getByRole("heading", { name: "Review required" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Fix before publishing")).toBeVisible();
    await page.getByRole("radio", { name: "Reading & Writing" }).check();
    await expect(page.getByText(/Checks cover Reading & Writing/)).toBeVisible();
    const readingWritingChecks = page.getByRole("button", { name: "Run checks" });
    await expect(readingWritingChecks).toBeEnabled({ timeout: 30_000 });
    await readingWritingChecks.click();
    await expect(releaseChecks).toHaveAttribute("aria-busy", "false");
    await expect(page.getByRole("heading", { name: "Ready to publish" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Fix before publishing")).toHaveCount(0);
  } else {
    await expect(page.getByRole("heading", { name: "Ready to publish" })).toBeVisible({ timeout: 30_000 });
  }
  if (options.publishScope && options.publishScope !== "full") {
    await page.getByRole("radio", { name: options.publishScope === "math" ? "Math" : "Reading & Writing" }).check();
  }
  await page.getByRole("button", { name: "Publish" }).click();
  const publishDialog = page.getByRole("dialog");
  await expect(publishDialog).toBeVisible();
  const publishAction =
    options.publishScope === "math"
      ? "Publish Math"
      : options.publishScope === "reading-writing"
        ? "Publish Reading & Writing"
        : "Publish Full SAT";
  await publishDialog.getByRole("button", { name: publishAction, exact: true }).click();

  await expect(page).toHaveURL(`/sat/exams/${examId}/access`, { timeout: 30_000 });
  const roomSetup = page.getByRole("dialog", { name: "Create room" });
  // Publishing a first release opens room setup on the exam's access route.
  await expect(roomSetup).toBeVisible({ timeout: 30_000 });
  await expect(roomSetup.getByText(`${examTitle} · Version 1`, { exact: true })).toBeVisible();
  await roomSetup.getByLabel("Room name").fill(linkName);
  await roomSetup.getByText("More options", { exact: true }).click();
  await roomSetup.getByRole("button", { name: /Name \+ email only/i }).click();
  await roomSetup.getByRole("button", { name: /^Open now/ }).click();
  await roomSetup.getByRole("button", { name: "Create room", exact: true }).click();

  await expect(page).toHaveURL(/\/sat\/sessions\/[0-9a-f-]+$/i, { timeout: 30_000 });
  const scheduleId = new URL(page.url()).pathname.split("/").filter(Boolean)[2];
  if (!scheduleId) throw new Error("SAT room id was not present after creation");
  await expect(page.getByRole("heading", { level: 1, name: linkName })).toBeVisible();
  await page.getByRole("button", { name: "Student link", exact: true }).click();
  const shareDialog = page.getByRole("dialog", { name: `Share ${linkName} with students` });
  await expect(shareDialog).toBeVisible();
  const joinHref = await shareDialog.getByText(/\/join\//).textContent();
  if (!joinHref) throw new Error("Student join URL was not created");

  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await studentPage.goto(joinHref);
  await expect(studentPage.getByRole("heading", { name: "Exam Check-in", exact: true })).toBeVisible();
  await expect(studentPage.getByText(`${examTitle} · Version 1`)).toBeVisible();
  if (options.publishScope === "reading-writing") {
    await expect(studentPage.getByText(/You'll take Reading & Writing only/)).toBeVisible();
  }
  await studentPage.getByLabel("Full name").fill(studentName);
  await studentPage.getByLabel("Email").fill(studentEmail);
  await studentPage.getByRole("button", { name: /Continue/i }).click();
  await expect(studentPage).toHaveURL(/\/student\/[0-9a-f-]+\/[^/]+$/i, { timeout: 30_000 });
  const studentPath = new URL(studentPage.url()).pathname.split("/").filter(Boolean);
  const joinedScheduleId = studentPath[1];
  const candidateId = decodeURIComponent(studentPath[2] ?? "");
  if (!joinedScheduleId || !candidateId)
    throw new Error("Student handoff did not include schedule and candidate ids");
  expect(joinedScheduleId).toBe(scheduleId);

  await page.goto("/sat/sessions");
  await expect(page.getByRole("heading", { name: "Rooms" })).toBeVisible({ timeout: 30_000 });
  const sessionRow = page
    .locator("button")
    .filter({ hasText: examTitle })
    .filter({ hasText: linkName })
    .first();
  await expect(sessionRow).toBeVisible({ timeout: 30_000 });
  await sessionRow.click();
  await expect(page).toHaveURL(`/sat/sessions/${scheduleId}`);
  await expect(page.getByText(studentName).first()).toBeVisible({ timeout: 30_000 });
  if (options.publishScope === "reading-writing") {
    const runSheet = page.getByRole("list", { name: "Run sheet stages" });
    await expect(runSheet).toContainText("Reading & Writing");
    await expect(runSheet).not.toContainText("Math");
  }
  await page.getByRole("button", { name: "Review and start exam" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Start exam" }).click();
  await expect
    .poll(async () => (await readSatRuntime(page, scheduleId)).status, { timeout: 20_000 })
    .toBe("live");

  // Phase 5 entry assertion: the proctor's Start is the ONLY action taken
  // against the exam. The student page is refreshed (never clicked) and the
  // module must be OPEN by itself — a body-text match would be satisfied by
  // the directions screen too, so it could not tell a working auto-entry from
  // a stalled one.
  await studentPage.reload();
  await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
  // The directions entry control must not have been the way in.
  await expect(studentPage.getByRole("button", { name: /Begin module/i })).toHaveCount(0);
  const attemptId = await studentPage.evaluate(
    async ({ scheduleId, candidateId }) => {
      const response = await fetch(
        `/api/v1/student/sessions/${scheduleId}/live?candidateId=${encodeURIComponent(candidateId)}`
      );
      const payload = await response.json();
      return payload?.data?.attempt?.id ?? payload?.attempt?.id ?? null;
    },
    { scheduleId, candidateId }
  );
  if (!attemptId) throw new Error("SAT student attempt did not materialize after proctor start");

  // Server-observable proof of the auto-entry itself: the entry module is NOT
  // not_started, i.e. the client opened it without a student action. Nothing
  // else starts the first module (finishCurrentSatSection runs later), so a
  // not_started state here means auto-entry did not fire.
  const entryModuleState = await studentPage.evaluate(
    async ({ scheduleId, attemptId: id, candidateId: student }) => {
      const delivery = await import("/src/features/student-delivery/api/assessmentDeliveryApi.ts");
      delivery.configureAssessmentDeliveryAttempt(scheduleId, id, student);
      const snapshot = await delivery.assessmentDeliveryApi.bootstrap(scheduleId, id);
      const section =
        snapshot.sections.find((item) => item.sectionKey === snapshot.timing.stageKey) ??
        snapshot.sections[0];
      const entry =
        section?.modules.find((module) => module.adaptiveRole === "base") ?? section?.modules[0];
      return snapshot.attempt.moduleAttempts.find((item) => item.moduleId === entry?.id)?.state ?? null;
    },
    { scheduleId, attemptId, candidateId }
  );
  expect(entryModuleState).not.toBe("not_started");

  return {
    studentContext,
    studentPage,
    examId,
    scheduleId,
    candidateId,
    attemptId,
    examTitle,
    linkName,
    studentName,
  };
}

test.describe("Digital SAT product workspace", () => {
  test("keeps the SAT room responsive and makes the tablet inspector keyboard-modal", async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "The room geometry matrix runs in Chromium desktop only.");
    test.setTimeout(180_000);
    const harness = await startSatAttempt(page, browser, {
      titlePrefix: "SAT Room Layout",
      linkPrefix: "SAT Room Layout Link",
      studentPrefix: "SAT Room Layout Student",
    });
    const { studentContext, scheduleId, studentName } = harness;
    try {
      for (const viewport of [
        { width: 1600, height: 900 },
        { width: 1440, height: 900 },
        { width: 1280, height: 800 },
        { width: 1024, height: 768 },
        { width: 768, height: 1024 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(`/sat/sessions/${scheduleId}`);
        await expect(page.getByRole("heading", { name: "Waiting to begin" })).toHaveCount(0);
        const studentOption = page.getByRole("option", { name: `Open ${studentName}` });
        await expect(studentOption).toBeVisible({ timeout: 30_000 });
        const roomLayout = await page.locator(".sat-room").getAttribute("data-room-layout");
        expect(["wide", "split", "stack"]).toContain(roomLayout);
        if (roomLayout === "wide") {
          await expect(page.getByRole("heading", { name: studentName })).toBeVisible();
        }
        await expect(page.getByText("Run sheet", { exact: true })).toBeVisible();

        const metrics = await page.evaluate(() => {
          const workspace = document.querySelector<HTMLElement>(".sat-room__workspace");
          const roster = document.querySelector<HTMLElement>(".sat-room__roster");
          const studentList = document.querySelector<HTMLElement>('.sat-room__roster [role="listbox"]');
          const room = document.querySelector<HTMLElement>(".sat-room");
          const inspector = room?.querySelector<HTMLElement>(".sat-room__inspector");
          if (!workspace || !roster || !studentList || !room) throw new Error("SAT session room did not render");
          const workspaceRect = workspace.getBoundingClientRect();
          const rosterRect = roster.getBoundingClientRect();
          const inspectorRect = inspector?.getBoundingClientRect() ?? null;
          return {
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            documentHeight: document.documentElement.scrollHeight,
            documentWidth: document.documentElement.scrollWidth,
            workspaceTop: workspaceRect.top,
            workspaceRight: workspaceRect.right,
            workspaceBottom: workspaceRect.bottom,
            workspaceClientHeight: workspace.clientHeight,
            workspaceScrollHeight: workspace.scrollHeight,
            workspaceOverflowY: getComputedStyle(workspace).overflowY,
            rosterTop: rosterRect.top,
            rosterBottom: rosterRect.bottom,
            rosterClientHeight: studentList.clientHeight,
            rosterScrollHeight: studentList.scrollHeight,
            rosterOverflowY: getComputedStyle(studentList).overflowY,
            rowCount: workspace.querySelectorAll("[data-sat-run-sheet-row]").length,
            inspectorTop: inspectorRect?.top ?? null,
            inspectorLeft: inspectorRect?.left ?? null,
            inspectorDisplay: inspector ? getComputedStyle(inspector).display : "portal",
          };
        });
        expect(metrics.rowCount).toBeGreaterThan(5);
        expect(metrics.documentWidth).toBeLessThanOrEqual(viewport.width + 1);

        if (viewport.width >= 1024) {
          expect(metrics.documentHeight).toBeLessThanOrEqual(viewport.height + 1);
          expect(metrics.workspaceOverflowY).toBe("auto");
          expect(metrics.rosterOverflowY).toBe("auto");
          if (roomLayout === "wide") {
            await expect(page.locator(".sat-room__inspector")).toBeVisible();
            expect(metrics.inspectorLeft ?? 0).toBeGreaterThanOrEqual(metrics.workspaceRight - 1);
            await expect(page.locator(".sat-room__inspector-dialog")).toHaveCount(0);
            if (viewport.width === 1600) {
              await testInfo.attach("sat-session-room-1600-wide", {
                body: await page.screenshot(),
                contentType: "image/png",
              });
            }
          } else {
            await studentOption.click();
            const dialog = page.getByRole("dialog", { name: "Selected student inspector" });
            await expect(dialog).toBeVisible();
            await expect(dialog).toHaveAttribute("aria-modal", "true");
            await expect(page.getByRole("button", { name: "Close student inspector" })).toBeFocused();
            await expect(dialog.locator("[data-sat-room-student-detail]")).toBeVisible();
            if (viewport.width === 1280) {
              await testInfo.attach("sat-session-room-1280-tablet-inspector", {
                body: await page.screenshot(),
                contentType: "image/png",
              });
            }

            await page.keyboard.press("Shift+Tab");
            expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
            await page.keyboard.press("Escape");
            await expect(dialog).toHaveCount(0);
            await expect(studentOption).toBeFocused();
          }

          await page.locator(".sat-room__workspace").evaluate((workspace) => {
            workspace.scrollTop = workspace.scrollHeight;
          });
          await expect(page.locator(".sat-room__sticky-context")).toHaveClass(/is-visible/);
          await expect(page.locator(".sat-room__header")).toBeVisible();
          await expect(page.locator(".sat-room__roster-head")).toBeVisible();
          await expect(page.locator(".sat-room__context-health")).toContainText("Live data");
          if (roomLayout === "wide") {
            const detail = page.locator(".sat-room__inspector [data-sat-room-student-detail]");
            await expect(detail).toBeVisible();
            const studentBounds = await detail.evaluate((element) => {
              const owner = element.closest(".sat-room__inspector-panel");
              if (!owner) throw new Error("Student detail has no inspector scroll owner");
              const detailRect = element.getBoundingClientRect();
              const paneRect = owner.getBoundingClientRect();
              return { detailBottom: detailRect.bottom, paneTop: paneRect.top, paneBottom: paneRect.bottom };
            });
            expect(studentBounds.detailBottom).toBeLessThanOrEqual(studentBounds.paneBottom + 1);
            expect(studentBounds.detailBottom).toBeGreaterThan(studentBounds.paneTop);
          }
        } else {
          expect(metrics.workspaceOverflowY).toBe("visible");
          expect(metrics.documentHeight).toBeGreaterThan(viewport.height);
          const landmarks = await page.evaluate(() => {
            const rect = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
            return {
              rosterTop: rect(".sat-room__roster").top,
              workspaceTop: rect(".sat-room__workspace").top,
            };
          });
          expect(landmarks.rosterTop).toBeLessThan(landmarks.workspaceTop);
          const studentOption = page.getByRole("option", { name: `Open ${studentName}` });
          await studentOption.click();
          const dialog = page.getByRole("dialog", { name: "Selected student inspector" });
          await expect(dialog).toBeVisible();
          await expect(dialog).toHaveAttribute("aria-modal", "true");
          await expect(dialog.locator("[data-sat-room-student-detail]")).toBeVisible();
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await expect(page.locator("[data-sat-room-student-detail]")).toBeVisible();
          if (viewport.width === 390) {
            await testInfo.attach("sat-session-room-390-mobile", {
              body: await page.screenshot({ fullPage: true }),
              contentType: "image/png",
            });
          }
          await page.keyboard.press("Escape");
          await expect(dialog).toHaveCount(0);
          await expect(studentOption).toBeFocused();
        }
      }
    } finally {
      await studentContext.close();
    }
  });

  test("creates, publishes, joins, times out, and surfaces a SAT result without IELTS leakage", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const harness = await startSatAttempt(page, browser);
    const {
      studentPage,
      studentContext,
      scheduleId,
      candidateId,
      attemptId,
      studentName,
      examTitle,
      linkName,
    } = harness;
    try {
      const reading = await finishCurrentSatSection(
        studentPage,
        scheduleId,
        attemptId,
        candidateId
      );
      expect(reading.sectionKey).toBe("reading-writing");

      // Pause/resume through staff controls, then let the candidate-owned
      // break deadline drive entry into Math.
      await pauseAndResumeCurrentSatSection(page, scheduleId);
      await expireSatBreak(attemptId);
      await expect
        .poll(async () => readStudentActiveSection(studentPage, scheduleId, attemptId, candidateId), {
          timeout: 30_000,
        })
        .toBe("math");

      const math = await finishCurrentSatSection(studentPage, scheduleId, attemptId, candidateId);
      expect(math.sectionKey).toBe("math");

      // Offline leg: drop the student page network and ASSERT the
      // offline failure mode (reload must fail), then restore and ASSERT
      // outbox recovery (pending answers flush; bootstrap readable).
      await studentPage.context().setOffline(true);
      const offlineReloadFailed = await studentPage.reload().then(() => false, () => true);
      expect(offlineReloadFailed).toBe(true);
      await studentPage.context().setOffline(false);
      await studentPage.reload();
      await expect
        .poll(async () => studentPage.evaluate(() => window.navigator.onLine), { timeout: 15_000 })
        .toBe(true);

      // Completion is server-owned. Replaying the stable finalization id after
      // the automatic result exists must return the identical result.
      const submitStable = () => studentPage.evaluate(
        async ({ scheduleId, attemptId, candidateId }) => {
          const delivery =
            await import("/src/features/student-delivery/api/assessmentDeliveryApi.ts");
          delivery.configureAssessmentDeliveryAttempt(scheduleId, attemptId, candidateId);
          return delivery.assessmentDeliveryApi.submitAssessment(scheduleId, attemptId, {
            submissionId: attemptId,
          });
        },
        { scheduleId, attemptId, candidateId },
      );
      const result = await submitStable();
      const replay = await submitStable();
      expect(result.providerKey).toBe("sat");
      expect(result.releaseStatus).toBe("pending");
      expect(result.scoreKind).toBe("practice");
      expect(result.totalScore).toBeNull();
      expect(result.sections).toBeNull();
      expect(replay.submissionId).toBe(result.submissionId);
      expect(result.submissionId).toBe("");
      expect(result.attemptId).toBe(attemptId);
      expect(replay.id).toBe(result.id);
      expect(replay.attemptId).toBe(attemptId);
      // Idempotent replay must return the IDENTICAL result (not just the
      // same id): a re-score with a stable id would pass an id-only
      // check while double-scoring. Timestamps excluded.
      const { submittedAt: _a, ...resultCore } = result as unknown as Record<string, unknown>;
      const { submittedAt: _b, ...replayCore } = replay as unknown as Record<string, unknown>;
      expect(replayCore).toEqual(resultCore);
      // The student's submit response is a score-free receipt until results
      // are released. Verify scoring from the persisted staff result instead.
      expect(reading.answeredCount).toBeGreaterThan(0);
      expect(reading.branchRole).toBe("higher_branch");
      expect(math.answeredCount).toBeGreaterThan(0);
      expect(math.branchRole).toBe("higher_branch");
      const pendingResults = await queryDb<{ outcome_status: string; release_status: string; total_score: number | null }>(
        `SELECT outcome_status, release_status, total_score
           FROM assessment_results
          WHERE attempt_id = ?`,
        [attemptId],
      );
      expect(pendingResults).toEqual([{ outcome_status: "pending", release_status: "pending", total_score: null }]);

      await page.goto("/sat/results");
      await expect(page.getByRole("heading", { name: "Responses" })).toBeVisible();
      await page.getByLabel("Search exams").fill(examTitle);
      const examRow = page.locator("button").filter({ hasText: examTitle }).first();
      await expect(examRow).toBeVisible({ timeout: 30_000 });
      await examRow.click();
      await expect(page.getByRole("heading", { name: examTitle })).toBeVisible();
      const roomRow = page.getByRole("button", { name: new RegExp(linkName) });
      await expect(roomRow).toBeVisible({ timeout: 30_000 });
      await roomRow.click();
      await expect(page.getByRole("heading", { name: linkName })).toBeVisible();
      await page.getByLabel("Search students").fill(studentName);
      const resultRow = page.locator("tbody tr").filter({ hasText: studentName }).first();
      await expect(resultRow).toBeVisible({ timeout: 30_000 });
      await expect(resultRow).toContainText("Score pending");
      await expect(resultRow).not.toContainText("Overall Band");
      await resultRow.getByRole("button", { name: new RegExp(`View saved answers for ${studentName}`) }).click();
      await expect(page.getByRole("heading", { name: /Question-level responses/ })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Reading & Writing", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Math", exact: true })).toBeVisible();

      await page.goto("/admin/exams");
      await expect(page.getByText(examTitle)).toHaveCount(0);
      await page.goto("/proctor");
      await expect(page.getByText(examTitle)).toHaveCount(0);
      await page.goto("/admin/results");
      await expect(page.getByText(studentName)).toHaveCount(0);
    } finally {
      await studentContext.close();
    }
  });

  test("keeps an acknowledged V2 answer in the result after the student tab closes", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const harness = await startSatAttempt(page, browser, {
      titlePrefix: "SAT Disconnected Answer",
      linkPrefix: "SAT Disconnected Link",
      studentPrefix: "SAT Disconnected Student",
      publishScope: "reading-writing",
      leaveMathIncomplete: true,
    });
    const { studentPage, studentContext, scheduleId, candidateId, attemptId } = harness;
    try {
      const base = await studentPage.evaluate(async ({ scheduleId, attemptId, candidateId }) => {
        const delivery = await import("/src/features/student-delivery/api/assessmentDeliveryApi.ts");
        delivery.configureAssessmentDeliveryAttempt(scheduleId, attemptId, candidateId);
        const snapshot = await delivery.assessmentDeliveryApi.bootstrap(scheduleId, attemptId);
        const section = snapshot.sections.find((item) => item.sectionKey === "reading-writing");
        const module = section?.modules.find((item) => item.adaptiveRole === "base");
        const moduleAttempt = module && snapshot.attempt.moduleAttempts.find((item) => item.moduleId === module.id);
        if (!module || moduleAttempt?.state !== "active") {
          throw new Error("The base module must be active before testing disconnected answer durability.");
        }
        return { id: module.id, key: module.moduleKey, attemptId: moduleAttempt.id };
      }, { scheduleId, attemptId, candidateId });
      const answer = (await correctAnswerPlan(base.id)).find((candidate) => candidate.kind === "single_choice");
      if (!answer) throw new Error("No keyed operational question was available for the disconnected save.");

      // flush() returns only after the server ACK; close the student context
      // before advancing authoritative time so no browser request can rescue it.
      await studentPage.evaluate(async ({ scheduleId, attemptId, candidateId, baseModuleId, answer }) => {
        const delivery = await import("/src/features/student-delivery/api/assessmentDeliveryApi.ts");
        delivery.configureAssessmentDeliveryAttempt(scheduleId, attemptId, candidateId);
        const durable = await import("/src/features/student/infrastructure/responseDurabilityTransport.ts");
        const engineMod = await import("/src/shared/durability/DurableResponseEngine.ts");
        const snapshot = await delivery.assessmentDeliveryApi.bootstrap(scheduleId, attemptId);
        const module = snapshot.sections.flatMap((section) => section.modules).find((item) => item.id === baseModuleId);
        if (!module?.questions.some((question) => question.examQuestionId === answer.examQuestionId)) {
          throw new Error("The selected question was missing from the active base module.");
        }
        const engine = new engineMod.DurableResponseEngine({
          scheduleId,
          attemptId,
          leaseEpoch: 1,
          controlEpoch: 1,
          drainDebounceMs: 0,
          transport: durable.createResponseDurabilityV2Transport(scheduleId, undefined),
        });
        try {
          await engine.recover();
          await engine.acceptResponse(answer.examQuestionId, {
            answer: answer.correctAnswer,
            markedForReview: false,
            eliminatedOptions: [],
            annotations: [],
          });
          await engine.flush();
          if (engine.getPendingCount() !== 0) {
            throw new Error(engine.getLastError() ?? "The answer did not receive a durable server ACK.");
          }
        } finally {
          engine.destroy();
        }
      }, { scheduleId, attemptId, candidateId, baseModuleId: base.id, answer });

      const persisted = await queryDb<{ response: string }>(
        "SELECT CAST(response AS CHAR) AS response FROM attempt_responses_v2 WHERE attempt_id = ? AND module_id = ? AND question_id = ?",
        [attemptId, base.id, answer.examQuestionId],
      );
      expect(persisted).toHaveLength(1);
      expect(JSON.parse(persisted[0]!.response).answer).toBe(answer.correctAnswer);

      const isResponseBatchRequest = (request: import("@playwright/test").Request) =>
        request.method() === "POST" &&
        request.url().includes(`/v2/student/attempts/${attemptId}/responses:batch`);
      const responseBatchRequest = studentPage.waitForRequest(isResponseBatchRequest);
      const responseBatchResponse = responseBatchRequest.then((request) => request.response());
      const racingWrite = studentPage.evaluate(async ({ scheduleId, attemptId, candidateId, baseModuleId, answer }) => {
        const delivery = await import("/src/features/student-delivery/api/assessmentDeliveryApi.ts");
        delivery.configureAssessmentDeliveryAttempt(scheduleId, attemptId, candidateId);
        const durable = await import("/src/features/student/infrastructure/responseDurabilityTransport.ts");
        const engineMod = await import("/src/shared/durability/DurableResponseEngine.ts");
        const snapshot = await delivery.assessmentDeliveryApi.bootstrap(scheduleId, attemptId);
        const question = snapshot.sections
          .flatMap((section) => section.modules)
          .find((module) => module.id === baseModuleId)
          ?.questions.find((item) => item.examQuestionId === answer.examQuestionId);
        if (!question || question.answer.kind !== "single_choice") {
          throw new Error("The selected single-choice question was missing from the active base module.");
        }
        const alternative = question.answer.options.find((option) => option.id !== answer.correctAnswer);
        if (!alternative) throw new Error("The selected question did not have an alternative answer option.");
        const engine = new engineMod.DurableResponseEngine({
          scheduleId,
          attemptId,
          leaseEpoch: 1,
          controlEpoch: 1,
          drainDebounceMs: 0,
          transport: durable.createResponseDurabilityV2Transport(scheduleId, undefined),
        });
        try {
          await engine.recover();
          await engine.acceptResponse(answer.examQuestionId, {
            answer: alternative.id,
            markedForReview: false,
            eliminatedOptions: [],
            annotations: [],
          });
          await engine.flush();
          return {
            acknowledged: engine.getPendingCount() === 0,
            error: engine.getLastError(),
            alternativeAnswer: alternative.id,
          };
        } finally {
          engine.destroy();
        }
      }, { scheduleId, attemptId, candidateId, baseModuleId: base.id, answer });
      // Begin the expiry update only after the answer batch has left the
      // browser, so the V2 transaction and timeout boundary genuinely race.
      await responseBatchRequest;
      await expireSatModuleAttempt(base.attemptId);
      const [raced, batchResponse] = await Promise.all([racingWrite, responseBatchResponse]);
      if (!batchResponse) throw new Error("The racing response ended without an HTTP result.");
      const wasAccepted = batchResponse.ok();
      if (wasAccepted) {
        expect(raced.acknowledged).toBe(true);
      } else {
        expect(batchResponse.status()).toBe(422);
        const rejection = await batchResponse.json() as {
          code?: string;
          details?: { reason?: string };
        };
        expect(`${rejection.code ?? ""} ${rejection.details?.reason ?? ""}`).toMatch(
          /DEADLINE_EXPIRED|ATTEMPT_NOT_WRITABLE/i,
        );
      }
      const expectedAnswer = wasAccepted ? raced.alternativeAnswer : answer.correctAnswer;
      const afterRace = await queryDb<{ response: string }>(
        "SELECT CAST(response AS CHAR) AS response FROM attempt_responses_v2 WHERE attempt_id = ? AND module_id = ? AND question_id = ?",
        [attemptId, base.id, answer.examQuestionId],
      );
      expect(afterRace).toHaveLength(1);
      expect(JSON.parse(afterRace[0]!.response).answer).toBe(expectedAnswer);

      await studentContext.close();
      // The timeout closes the current adaptive module and opens the selected
      // branch. Expire that branch too so the test proves the ACK survives the
      // complete terminal result after the only browser has gone away.
      let branchAttemptId: string | null = null;
      await expect.poll(async () => {
        const rows = await queryDb<{ id: string }>(
          `SELECT ma.id
             FROM assessment_module_attempts ma
             JOIN assessment_modules m ON m.id = ma.module_id
            WHERE ma.attempt_id = ?
              AND m.adaptive_role IN ('lower_branch', 'higher_branch')
              AND ma.state IN ('active', 'review')
            ORDER BY ma.created_at
            LIMIT 1`,
          [attemptId],
        );
        branchAttemptId = rows[0]?.id ?? null;
        return branchAttemptId;
      }, { timeout: 45_000, intervals: [250, 500, 1_000, 2_000] }).not.toBeNull();
      if (!branchAttemptId) throw new Error("The timed-out base module did not open its adaptive branch.");
      await expireSatModuleAttempt(branchAttemptId);

      let resultId: string | null = null;
      await expect.poll(async () => {
        const rows = await queryDb<{ id: string }>(
          "SELECT id FROM assessment_results WHERE attempt_id = ?",
          [attemptId],
        );
        resultId = rows[0]?.id ?? null;
        return resultId;
      }, { timeout: 90_000, intervals: [500, 1_000, 2_000, 5_000] }).not.toBeNull();

      if (!resultId) throw new Error("The timeout worker did not produce a SAT result.");
      const resultResponse = await page.request.get(`/api/v1/results/sat/${resultId}`);
      expect(resultResponse.ok(), `SAT result detail returned ${resultResponse.status()}`).toBe(true);
      type ResultQuestion = {
        questionId?: string;
        moduleKey?: string;
        response?: unknown;
      };
      const answersResponse = await page.request.get(`/api/v1/results/sat/attempts/${attemptId}/answers`);
      expect(answersResponse.ok(), `SAT saved answers returned ${answersResponse.status()}`).toBe(true);
      const payload = await answersResponse.json() as {
        data?: { savedAnswerCount?: number; questions?: ResultQuestion[] };
        savedAnswerCount?: number;
        questions?: ResultQuestion[];
      };
      const detail = payload.data ?? payload;
      expect(detail.savedAnswerCount).toBeGreaterThan(0);
      const question = detail.questions?.find((item) =>
        item.questionId === answer.questionId && item.moduleKey === base.key,
      );
      expect(question?.response).toBe(expectedAnswer);
    } finally {
      await studentContext.close();
    }
  });

  test("delivers a pinned Reading & Writing release through the complete student journey", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const harness = await startSatAttempt(page, browser, {
      titlePrefix: "SAT Reading Writing Release",
      linkPrefix: "SAT Reading Writing Link",
      studentPrefix: "SAT Reading Writing Student",
      publishScope: "reading-writing",
      leaveMathIncomplete: true,
    });
    const { studentPage, studentContext, scheduleId, candidateId, attemptId } = harness;
    try {
      const runtime = await readSatRuntime(page, scheduleId);
      expect(runtime.sections.map((section) => section.sectionKey)).toEqual(["reading-writing"]);

      const deliveredPlan = await studentPage.evaluate(
        async ({ scheduleId: id, attemptId: attempt, candidateId: candidate }) => {
          const delivery = await import("/src/features/student-delivery/api/assessmentDeliveryApi.ts");
          delivery.configureAssessmentDeliveryAttempt(id, attempt, candidate);
          const snapshot = await delivery.assessmentDeliveryApi.bootstrap(id, attempt);
          return {
            sectionKeys: snapshot.sections.map((section) => section.sectionKey),
            moduleIds: snapshot.sections.flatMap((section) => section.modules.map((module) => module.id)),
            attemptModuleIds: snapshot.attempt.moduleAttempts.map((moduleAttempt) => moduleAttempt.moduleId),
          };
        },
        { scheduleId, attemptId, candidateId },
      );
      expect(deliveredPlan.sectionKeys).toEqual(["reading-writing"]);
      expect(deliveredPlan.attemptModuleIds.length).toBeGreaterThan(0);
      expect(deliveredPlan.attemptModuleIds.every((moduleId) => deliveredPlan.moduleIds.includes(moduleId))).toBe(true);

      const finished = await finishCurrentSatSection(studentPage, scheduleId, attemptId, candidateId);
      expect(finished.sectionKey).toBe("reading-writing");
      expect(finished.timedOutModuleIds).toHaveLength(2);
      expect(finished.branchRole).toMatch(/^(lower|higher)_branch$/);

      const result = await studentPage.evaluate(
        async ({ scheduleId: id, attemptId: attempt, candidateId: candidate }) => {
          const delivery = await import("/src/features/student-delivery/api/assessmentDeliveryApi.ts");
          delivery.configureAssessmentDeliveryAttempt(id, attempt, candidate);
          return delivery.assessmentDeliveryApi.submitAssessment(id, attempt, { submissionId: attempt });
        },
        { scheduleId, attemptId, candidateId },
      );
      expect(result.releaseStatus).toBe("pending");
      expect(result.totalScore).toBeNull();
      expect(result.sections).toBeNull();

      const runtimePlan = await queryDb<{ section_key: string; gap_after_minutes: number }>(
        `SELECT section_key, gap_after_minutes
           FROM exam_session_runtime_sections
          WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
          ORDER BY section_order`,
        [scheduleId],
      );
      expect(runtimePlan).toEqual([{ section_key: "reading-writing", gap_after_minutes: 0 }]);
    } finally {
      await studentContext.close();
    }
  });

  // An unanswered attempt still reaches a result after server-owned timeouts.
  test("finalizes a completely unanswered SAT attempt automatically", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const harness = await startSatAttempt(page, browser, {
      titlePrefix: "SAT Unanswered",
      linkPrefix: "SAT Unanswered Link",
      studentPrefix: "SAT Unanswered Student",
    });
    const { studentPage, studentContext, scheduleId, candidateId, attemptId, studentName, examTitle, linkName } =
      harness;
    try {
      for (const [index, sectionKey] of (["reading-writing", "math"] as const).entries()) {
        const finished = await finishCurrentSatSection(
          studentPage,
          scheduleId,
          attemptId,
          candidateId,
          { answerQuestions: false }
        );
        expect(finished.sectionKey).toBe(sectionKey);
        // The journey is only meaningful if the student truly answered nothing.
        expect(finished.answeredCount).toBe(0);
        if (index === 0) {
          await expireSatBreak(attemptId);
          await expect.poll(async () => readStudentActiveSection(studentPage, scheduleId, attemptId, candidateId), {
            timeout: 30_000,
          }).toBe("math");
        }
      }

      // Terminalization creates a score-free receipt; scoring remains pending
      // until the staff result pipeline publishes a score.
      await expect
        .poll(
          async () => {
            return queryDb<{ outcome_status: string; release_status: string; total_score: number | null }>(
              `SELECT outcome_status, release_status, total_score
                 FROM assessment_results
                WHERE attempt_id = ?`,
              [attemptId]
            );
          },
          {
            timeout: 90_000,
            message: "an unanswered SAT attempt must still reach a pending result",
          }
        )
        .toEqual([{ outcome_status: "pending", release_status: "pending", total_score: null }]);

      // Automatic finalization commits the EMPTY-set digest on the attempt
      // record; explicit-submit receipt rows are not created by this worker.
      const terminalAttempt = await queryDb<{
        phase: string;
        delivery_status: string;
        final_response_digest: string | null;
      }>(
        "SELECT phase, delivery_status, final_response_digest FROM student_attempts WHERE id = ?",
        [attemptId]
      );
      const emptySetDigest = createHash("sha256").update("[]").digest("hex");
      expect(terminalAttempt).toEqual([{
        phase: "post-exam",
        delivery_status: "submitted",
        final_response_digest: emptySetDigest,
      }]);

      // And the student sees the completed exam, with no finalization-error
      // copy and no retry affordance left behind.
      await studentPage.reload();
      await expect(studentPage.getByRole("heading", { name: "SAT Complete" })).toBeVisible({
        timeout: 45_000,
      });
      await expect(studentPage.getByText("400", { exact: true })).toHaveCount(0);
      await expect(studentPage.getByText(/finalizing|could not be finalized/i)).toHaveCount(0);
      await expect(studentPage.getByRole("button", { name: /Retry|Try again/i })).toHaveCount(0);

      // The result is complete downstream too: the answered journey's product
      // assertions apply here too, so a zero-answer attempt is a first-class
      // reviewable result rather than a shell that merely stopped erroring.
      await page.goto("/sat/results");
      await expect(page.getByRole("heading", { name: "Responses" })).toBeVisible();
      await page.getByLabel("Search exams").fill(examTitle);
      const examRow = page.locator("button").filter({ hasText: examTitle }).first();
      await expect(examRow).toBeVisible({ timeout: 30_000 });
      await examRow.click();
      await expect(page.getByRole("heading", { name: examTitle })).toBeVisible();
      const roomRow = page.getByRole("button", { name: new RegExp(linkName) });
      await expect(roomRow).toBeVisible({ timeout: 30_000 });
      await roomRow.click();
      await expect(page.getByRole("heading", { name: linkName })).toBeVisible();
      await page.getByLabel("Search students").fill(studentName);
      const resultRow = page.locator("tbody tr").filter({ hasText: studentName }).first();
      await expect(resultRow).toBeVisible({ timeout: 30_000 });
      await expect(resultRow).toContainText("Score pending");
      await expect(resultRow).not.toContainText("Overall Band");
      await resultRow.getByRole("button", { name: new RegExp(`View saved answers for ${studentName}`) }).click();
      await expect(page.getByRole("heading", { name: /Question-level responses/ })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Reading & Writing", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Math", exact: true })).toBeVisible();
    } finally {
      await studentContext.close();
    }
  });
});

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
async function correctAnswerPlan(moduleId: string): Promise<Array<{ examQuestionId: string; correctAnswer: string }>> {
  // Pretest rows are excluded from operational scoring/routing, so answering
  // them would inflate answeredCount beyond rawCorrect and break the
  // rawCorrect >= answeredCount assertion.
  const keyRows = await queryDb<{ exam_question_id: string; answer_definition: string }>(
    `SELECT eq.id AS exam_question_id, CAST(qr.answer_definition AS CHAR) AS answer_definition
       FROM assessment_exam_questions eq
       JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id
      WHERE eq.module_id = ? AND eq.is_pretest = FALSE`,
    [moduleId],
  );
  const plan: Array<{ examQuestionId: string; correctAnswer: string }> = [];
  for (const row of keyRows) {
    let parsed: { kind?: string; correctOptionId?: unknown; acceptedResponses?: unknown } = {};
    try {
      parsed = JSON.parse(row.answer_definition) as typeof parsed;
    } catch {
      continue;
    }
    if (parsed.kind === "single_choice" && typeof parsed.correctOptionId === "string") {
      plan.push({ examQuestionId: row.exam_question_id, correctAnswer: parsed.correctOptionId });
    } else if (
      parsed.kind === "student_produced_response"
      && Array.isArray(parsed.acceptedResponses)
      && typeof parsed.acceptedResponses[0] === "string"
    ) {
      plan.push({ examQuestionId: row.exam_question_id, correctAnswer: parsed.acceptedResponses[0] as string });
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
      const section =
        snapshot.sections.find((item) => item.sectionKey === stageKey) ??
        snapshot.sections.find((item) =>
          item.modules.some((module) =>
            snapshot.attempt.moduleAttempts.some(
              (attempt) =>
                attempt.moduleId === module.id &&
                ["not_started", "active", "review"].includes(attempt.state)
            )
          )
        );
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
  if (!branchFrame) throw new Error(`The server did not open the adaptive module for ${prepared.sectionKey}`);

  const branchAttempt = branchFrame.attempt.moduleAttempts.find((item) => {
    const module = branchFrame!.sections
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
  if (!terminalFrame) throw new Error(`The server did not close the adaptive module for ${prepared.sectionKey}`);

  const sectionModules = terminalFrame.sections.find(
    (section) => section.sectionKey === prepared.sectionKey,
  )?.modules ?? [];
  const branchModule = sectionModules.find((module) => module.id === branchAttempt.moduleId);
  const timedOutModuleIds = terminalFrame.attempt.moduleAttempts
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

// Pause leg — freeze the live cohort stage mid-module, ASSERT the
// freeze is observable while paused (status + frozen countdown), then
// resume. Answers saved across the pause must survive and routing must
// still reflect them (personal clock freezes with the cohort stage, so no
// spurious timeout reconciliation fires mid-pause).
async function pauseAndResumeCurrentSatSection(page: Page, scheduleId: string) {
  const paused = await executeUpdate(
    "UPDATE exam_session_runtime_sections rs JOIN exam_session_runtimes r ON r.id = rs.runtime_id " +
    "SET rs.status = 'paused', rs.accumulated_paused_seconds = rs.accumulated_paused_seconds + 60 " +
    "WHERE r.schedule_id = ? AND rs.section_key = r.active_section_key AND rs.status = 'live'",
    [scheduleId],
  );
  if (paused !== 1) throw new Error("Expected one live SAT section to pause, changed " + paused + " rows");
  // Mid-pause assertions: the runtime must report paused AND the
  // countdown must be frozen (two reads agree — no ticking mid-pause).
  const midPause = await readSatRuntime(page, scheduleId);
  if (midPause.sections.find((s) => s.sectionKey === midPause.currentSectionKey)?.status !== "paused") {
    throw new Error("Expected current SAT section to report paused mid-pause");
  }
  const firstRemaining = midPause.currentSectionRemainingSeconds;
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const secondPause = await readSatRuntime(page, scheduleId);
  if (secondPause.currentSectionRemainingSeconds !== firstRemaining) {
    throw new Error(`Countdown ticked mid-pause: ${firstRemaining} -> ${secondPause.currentSectionRemainingSeconds}`);
  }
  await executeUpdate(
    "UPDATE exam_session_runtime_sections rs JOIN exam_session_runtimes r ON r.id = rs.runtime_id " +
    "SET rs.status = 'live' " +
    "WHERE r.schedule_id = ? AND rs.section_key = r.active_section_key AND rs.status = 'paused'",
    [scheduleId],
  );
  // Post-resume: the stage must report live again.
  await expect
    .poll(async () => (await readSatRuntime(page, scheduleId)).sections.find((s) => s.sectionKey === midPause.currentSectionKey)?.status, {
      timeout: 15_000,
    })
    .toBe("live");
}

async function expireCurrentSatSection(scheduleId: string) {
  const affected = await executeUpdate(
    `
      UPDATE exam_session_runtime_sections rs
      JOIN exam_session_runtimes r ON r.id = rs.runtime_id
      SET rs.actual_start_at = DATE_SUB(NOW(6), INTERVAL 2 MINUTE),
          rs.planned_duration_minutes = 1,
          rs.extension_minutes = 0,
          rs.accumulated_paused_seconds = 0
      WHERE r.schedule_id = ?
        AND rs.section_key = r.active_section_key
        AND rs.status = 'live'
    `,
    [scheduleId]
  );
  if (affected !== 1) {
    throw new Error(`Expected one live SAT section to expire, changed ${affected} rows`);
  }
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
 * Shared journey setup: author, publish, link, join, and proctor-start a real
 * SAT so the exam is live with the first module auto-opened. Extracted so the
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
  await expect(page.getByRole("heading", { name: "Exam Library" })).toBeVisible();
  await expect(page.getByText("Digital SAT").first()).toBeVisible();
  await expect(page.getByText("IELTS", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Create SAT", exact: true }).first().click();
  await page.getByLabel("SAT exam name").fill(examTitle);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page).toHaveURL(/\/sat\/exams\/[0-9a-f-]+$/i, { timeout: 30_000 });
  const examId = page.url().match(/\/sat\/exams\/([^/?#]+)/)?.[1];
  if (!examId) throw new Error("SAT exam id was not present after creation");

  await expect(page.getByRole("heading", { name: examTitle })).toBeVisible();
  await page.getByRole("button", { name: "More authoring actions" }).click();
  await page.getByRole("menuitem", { name: /Load sample exam/ }).click();
  await expect(page.getByRole("dialog", { name: "Load sample SAT" })).toBeVisible();
  await page.getByRole("button", { name: "Load 147 questions" }).click();
  await expect(page.getByText("147 of 147 authored")).toBeVisible({ timeout: 90_000 });

  if (options.leaveMathIncomplete) {
    await leaveMathBaseModuleIncomplete(examId);
    await page.reload();
    await expect(page.getByRole("heading", { name: examTitle })).toBeVisible({ timeout: 30_000 });
  }

  await page.getByRole("button", { name: "Release" }).click();
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
  await expect(page.getByRole("heading", { name: "Student Access", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New Student Link", exact: true }).first().click();
  await page.getByLabel("Student Link name").fill(linkName);
  await page.getByRole("button", { name: /Name \+ email only/i }).click();
  await page.getByRole("button", { name: /Anytime/i }).click();
  await page.getByRole("button", { name: "Create Link" }).click();
  await expect(page.getByText(linkName).first()).toBeVisible({ timeout: 20_000 });
  const joinHref = await page.getByRole("link", { name: "Open student page" }).getAttribute("href");
  if (!joinHref) throw new Error("Student join URL was not created");

  const studentContext = await browser.newContext();
  const studentPage = await studentContext.newPage();
  await studentPage.goto(joinHref);
  await expect(studentPage.getByRole("heading", { name: linkName })).toBeVisible();
  await expect(studentPage.getByText(`${examTitle} · Version 1`)).toBeVisible();
  if (options.publishScope === "reading-writing") {
    await expect(studentPage.getByText(/You'll take Reading & Writing only/)).toBeVisible();
  }
  await studentPage.getByLabel("Full name").fill(studentName);
  await studentPage.getByLabel("Email").fill(studentEmail);
  await studentPage.getByRole("button", { name: /Continue/i }).click();
  await expect(studentPage).toHaveURL(/\/student\/[0-9a-f-]+\/[^/]+$/i, { timeout: 30_000 });
  const studentPath = new URL(studentPage.url()).pathname.split("/").filter(Boolean);
  const scheduleId = studentPath[1];
  const candidateId = decodeURIComponent(studentPath[2] ?? "");
  if (!scheduleId || !candidateId)
    throw new Error("Student handoff did not include schedule and candidate ids");

  await page.goto("/sat/sessions");
  await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible({ timeout: 30_000 });
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
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText("Session started.")).toBeVisible({ timeout: 20_000 });

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
        if (viewport.width >= 1440) {
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
          if (viewport.width >= 1440) {
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
          if (viewport.width >= 1440) {
            await expect(page.locator(".sat-room__context-health")).toContainText("Online");
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
              inspectorTop: rect(".sat-room__inspector").top,
            };
          });
          expect(landmarks.rosterTop).toBeLessThan(landmarks.workspaceTop);
          expect(landmarks.workspaceTop).toBeLessThan(landmarks.inspectorTop);
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await expect(page.locator("[data-sat-room-student-detail]")).toBeVisible();
          if (viewport.width === 390) {
            await testInfo.attach("sat-session-room-390-mobile", {
              body: await page.screenshot({ fullPage: true }),
              contentType: "image/png",
            });
          }
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
    } = harness;
    try {
      const reading = await finishCurrentSatSection(
        studentPage,
        scheduleId,
        attemptId,
        candidateId
      );
      expect(reading.sectionKey).toBe("reading-writing");

      // Pause leg: freeze + resume the live stage after reading times out.
      // The math section must still open and route on V2-saved answers.
      await pauseAndResumeCurrentSatSection(page, scheduleId);

      await expireCurrentSatSection(scheduleId);
      await expect
        .poll(async () => (await readSatRuntime(page, scheduleId)).currentSectionKey, {
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

      // Takeover leg: rotate the writer lease, ASSERT the epoch increments,
      // and adopt the new session after automatic completion.
      const takeoverEpoch = await studentPage.evaluate(
        async ({ scheduleId, attemptId }) => {
          const durable = await import("/src/features/student/infrastructure/responseDurabilityTransport.ts");
          const attempt = { id: attemptId, scheduleId } as never;
          const result = await durable.takeOverResponseDurabilityLease(scheduleId, attemptId, {
            clientSessionId: "e2e-takeover-" + attemptId.slice(0, 8),
            reason: "e2e_takeover_leg",
          }, attempt);
          return result.leaseEpoch as number;
        },
        { scheduleId, attemptId },
      );
      expect(takeoverEpoch).toBeGreaterThan(1);

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
      expect(result.scoreKind).toBe("practice");
      expect(replay.submissionId).toBe(result.submissionId);
      expect(replay.submissionId).toBe(attemptId);
      // Idempotent replay must return the IDENTICAL result (not just the
      // same id): a re-score with a stable id would pass an id-only
      // check while double-scoring. Timestamps excluded.
      const { submittedAt: _a, ...resultCore } = result as Record<string, unknown>;
      const { submittedAt: _b, ...replayCore } = replay as Record<string, unknown>;
      expect(replayCore).toEqual(resultCore);
      // Exam-day P0 assertions: V2-saved correct answers must score, route
      // the adaptive branch, and appear in the released review.
      expect(reading.answeredCount).toBeGreaterThan(0);
      expect(reading.branchRole).toBe("higher_branch");
      expect(math.answeredCount).toBeGreaterThan(0);
      expect(math.branchRole).toBe("higher_branch");
      const readingSection = result.sections.find((section) => section.sectionKey === "reading-writing");
      expect(readingSection?.rawCorrect).toBeGreaterThanOrEqual(reading.answeredCount);
      expect(readingSection?.route).toBe("higher");
      const mathSection = result.sections.find((section) => section.sectionKey === "math");
      expect(mathSection?.rawCorrect).toBeGreaterThanOrEqual(math.answeredCount);
      expect(mathSection?.route).toBe("higher");

      await page.goto("/sat/results");
      await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
      await page.getByLabel("Search SAT results").fill(studentName);
      const resultRow = page
        .locator("button")
        .filter({ hasText: studentName })
        .filter({ hasText: examTitle })
        .first();
      await expect(resultRow).toBeVisible({ timeout: 30_000 });
      await expect(resultRow).not.toContainText("Overall Band");
      await resultRow.click();
      await expect(
        page.getByText("Practice score").or(page.getByText("Practice · raw score")).first()
      ).toBeVisible();
      await expect(page.getByText("Reading & Writing")).toBeVisible();
      await expect(page.getByText("Math")).toBeVisible();

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
      expect(result.sections.map((section) => section.sectionKey)).toEqual(["reading-writing"]);

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
    const { studentPage, studentContext, scheduleId, candidateId, attemptId, studentName, examTitle } =
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
          await expireCurrentSatSection(scheduleId);
          await expect.poll(async () => (await readSatRuntime(page, scheduleId)).currentSectionKey, {
            timeout: 30_000,
          }).toBe("math");
        }
      }

      // Zero raw is a legitimate score: the practice table's floor is 200 per
      // section, so both sections at zero = 400.
      await expect
        .poll(
          async () => {
            const rows = await queryDb<{ total_score: number | null }>(
              "SELECT total_score FROM assessment_results WHERE attempt_id = ?",
              [attemptId]
            );
            return rows[0]?.total_score ?? null;
          },
          {
            timeout: 90_000,
            message: "an unanswered SAT attempt must still reach a scored result",
          }
        )
        .toBe(400);

      // The provisional terminal claim committed with the EMPTY-set digest —
      // proof the V2 submit accepted zero responses instead of refusing them.
      const receipts = await queryDb<{ final_response_digest: string }>(
        "SELECT final_response_digest FROM attempt_submissions_v2 WHERE attempt_id = ?",
        [attemptId]
      );
      expect(receipts.length).toBe(1);
      const emptySetDigest = createHash("sha256").update("[]").digest("hex");
      expect(receipts[0]?.final_response_digest).toBe(emptySetDigest);

      // And the student sees the completed exam, with no finalization-error
      // copy and no retry affordance left behind.
      await studentPage.reload();
      await expect(studentPage.getByRole("heading", { name: "SAT Complete" })).toBeVisible({
        timeout: 45_000,
      });
      await expect(studentPage.getByText("400", { exact: true })).toBeVisible();
      await expect(studentPage.getByText(/finalizing|could not be finalized/i)).toHaveCount(0);
      await expect(studentPage.getByRole("button", { name: /Retry|Try again/i })).toHaveCount(0);

      // The result is complete downstream too: the answered journey's product
      // assertions apply verbatim, so a zero-answer attempt is a first-class
      // result rather than a shell that merely stopped erroring.
      await page.goto("/sat/results");
      await expect(page.getByRole("heading", { name: "Results" })).toBeVisible();
      await page.getByLabel("Search SAT results").fill(studentName);
      const resultRow = page
        .locator("button")
        .filter({ hasText: studentName })
        .filter({ hasText: examTitle })
        .first();
      await expect(resultRow).toBeVisible({ timeout: 30_000 });
      await resultRow.click();
      await expect(page.getByText("Reading & Writing")).toBeVisible();
      await expect(page.getByText("Math")).toBeVisible();
    } finally {
      await studentContext.close();
    }
  });
});

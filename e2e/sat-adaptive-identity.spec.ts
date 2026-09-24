import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH } from "./support/backendE2e";
import { executeTransaction, executeUpdate, queryDb } from "./support/db";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

/**
 * Browser-level adaptive-routing identity (plan T6/T12/T16 release items).
 *
 * Unit + integration coverage proves each link of the chain in isolation;
 * these scenarios prove the chain holds in a real browser against a live
 * backend: the routed Module 2 id is the authority on the student screen,
 * in the start request, on the staff roster, and in the final result.
 */
test.describe("SAT adaptive identity in the browser", () => {
  test.describe.configure({ timeout: 420_000 });

  test("Higher normal: decision, branch, staff view, and reload agree", async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Adaptive identity scenarios run once in desktop Chromium.",
    );
    const { studentContext, studentPage, scheduleId, candidateId, attemptId, studentName } =
      await startSatAttempt(page, browser, {
        titlePrefix: "SAT Adaptive Higher",
        linkPrefix: "SAT Adaptive Higher Link",
        studentPrefix: "SAT Adaptive Higher Student",
      });
    try {

      // Answer everything correctly so Module 1 must route HIGH.
      const frame = await readDeliveryFrame(studentPage, scheduleId, attemptId, candidateId);
      const base = frame.sections
        .find((item) => item.sectionKey === "reading-writing")
        ?.modules.find((module) => module.adaptiveRole === "base");
      if (!base) throw new Error("Reading & Writing base module missing from bootstrap");
      await answerBaseModuleCorrectly(studentPage, scheduleId, attemptId, candidateId, base.id);
      await expireCurrentBaseModule(studentPage, scheduleId, attemptId, candidateId, "reading-writing");

      const branch = await waitForActiveBranch(
        studentPage,
        scheduleId,
        attemptId,
        candidateId,
        "reading-writing",
      );
      expect(branch.role).toBe("higher_branch");

      // The recorded decision names the exact module the student sits.
      const decision = await routeDecision(attemptId);
      expect(decision.sectionKey).toBe("reading-writing");
      expect(decision.route).toBe("higher");
      expect(decision.moduleId).toBe(branch.moduleId);

      // Staff projection agrees through the staff API the room reads.
      await expect
        .poll(async () => (await staffProjection(page, scheduleId, studentName)).runtimeCurrentModuleId, {
          timeout: 45_000,
          intervals: [500, 1_000, 2_000],
        })
        .toBe(branch.moduleId);
      const projection = await staffProjection(page, scheduleId, studentName);
      expect(projection.runtimeCurrentModuleRole).toBe("higher_branch");

      // And the staff room names the slot for this candidate.
      await page.goto(`/sat/sessions/${scheduleId}`);
      const studentOption = page.getByRole("option", { name: `Open ${studentName}` });
      await expect(studentOption).toBeVisible({ timeout: 30_000 });
      await studentOption.click();
      const dialog = page.getByRole("dialog", { name: "Selected student inspector" });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.locator("[data-sat-room-student-detail]").getByText("Module 2 · Higher"),
      ).toBeVisible();

      // The rendered student screen belongs to the routed module: reload and
      // confirm the exam shell still shows Module 2 content, never Module 1.
      await studentPage.reload({ waitUntil: "domcontentloaded" });
      await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
      const reloaded = await readDeliveryFrame(studentPage, scheduleId, attemptId, candidateId);
      const activeAfterReload = reloaded.attempt.moduleAttempts.find((item) => item.state === "active");
      expect(activeAfterReload?.moduleId).toBe(branch.moduleId);
    } finally {
      await studentContext.close();
    }
  });

  test("Lower normal: an unanswered section routes, shows, and scores Lower", async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Adaptive identity scenarios run once in desktop Chromium.",
    );
    const { studentContext, studentPage, scheduleId, candidateId, attemptId, studentName } =
      await startSatAttempt(page, browser, {
        titlePrefix: "SAT Adaptive Lower",
        linkPrefix: "SAT Adaptive Lower Link",
        studentPrefix: "SAT Adaptive Lower Student",
      });
    try {

      // Answer nothing on either section: zero correct must route LOW — the
      // control that proves fixing Higher did not break Lower.
      for (const sectionKey of ["reading-writing", "math"] as const) {
        await expireCurrentBaseModule(studentPage, scheduleId, attemptId, candidateId, sectionKey);
        const branch = await waitForActiveBranch(
          studentPage,
          scheduleId,
          attemptId,
          candidateId,
          sectionKey,
        );
        expect(branch.role).toBe("lower_branch");

        const sectionDecision = await routeDecisionForSection(attemptId, sectionKey);
        expect(sectionDecision.route).toBe("lower");
        expect(sectionDecision.moduleId).toBe(branch.moduleId);

        // Observe staff projection while this branch is active; once its
        // timeout closes it the roster correctly has no active module to name.
        await expect
          .poll(
            async () => (await staffProjection(page, scheduleId, studentName)).runtimeCurrentModuleId,
            { timeout: 45_000, intervals: [500, 1_000, 2_000] },
          )
          .toBe(branch.moduleId);
        const branchProjection = await staffProjection(page, scheduleId, studentName);
        expect(branchProjection.runtimeCurrentModuleRole).toBe("lower_branch");

        await page.goto(`/sat/sessions/${scheduleId}`);
        const studentOption = page.getByRole("option", { name: `Open ${studentName}` });
        await expect(studentOption).toBeVisible({ timeout: 30_000 });
        await studentOption.click();
        const dialog = page.getByRole("dialog", { name: "Selected student inspector" });
        await expect(dialog).toBeVisible();
        await expect(
          dialog.locator("[data-sat-room-student-detail]").getByText("Module 2 · Lower"),
        ).toBeVisible();

        await expireModuleAttempt(branch.attemptId);
        await waitForTerminalBranch(studentPage, scheduleId, attemptId, candidateId, branch.attemptId);
        if (sectionKey === "reading-writing") {
          await expireCurrentSatSection(scheduleId, attemptId);
          await expect
            .poll(async () => (await readRuntimeStage(page, scheduleId))?.currentSectionKey, {
              timeout: 30_000,
            })
            .toBe("math");
        }
      }

      // The attempt completes and both section routes read lower.
      const result = await studentPage.evaluate(
        async ({ scheduleId: id, attemptId: attempt, candidateId: candidate }) => {
          const delivery = await import("/src/features/student-delivery/api/assessmentDeliveryApi.ts");
          delivery.configureAssessmentDeliveryAttempt(id, attempt, candidate);
          return delivery.assessmentDeliveryApi.submitAssessment(id, attempt, { submissionId: attempt });
        },
        { scheduleId, attemptId, candidateId },
      );
      for (const section of result.sections) {
        expect(section.route).toBe("lower");
      }

      // Nothing was ever answered on the unadministered branch.
      const strayAnswers = await queryDb<{ count: number }>(
        `SELECT COUNT(*) AS count FROM attempt_responses_v2 v
           JOIN assessment_exam_questions eq
             ON eq.id = v.question_id OR eq.question_id = v.question_id
           JOIN assessment_modules m ON m.id = eq.module_id
          WHERE v.attempt_id = ? AND m.adaptive_role = 'higher_branch'`,
        [attemptId],
      );
      expect(strayAnswers[0]?.count ?? -1).toBe(0);
    } finally {
      await studentContext.close();
    }
  });

  test("Reload at the handoff starts exactly the routed module", async ({ page, browser }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Adaptive identity scenarios run once in desktop Chromium.",
    );
    const { studentContext, studentPage, scheduleId, candidateId, attemptId } =
      await startSatAttempt(page, browser, {
        titlePrefix: "SAT Adaptive Handoff",
        linkPrefix: "SAT Adaptive Handoff Link",
        studentPrefix: "SAT Adaptive Handoff Student",
      });
    try {
      const frame = await readDeliveryFrame(studentPage, scheduleId, attemptId, candidateId);
      const base = frame.sections
        .find((item) => item.sectionKey === "reading-writing")
        ?.modules.find((module) => module.adaptiveRole === "base");
      if (!base) throw new Error("Reading & Writing base module missing from bootstrap");
      await answerBaseModuleCorrectly(studentPage, scheduleId, attemptId, candidateId, base.id);

      // Hold the start response so Module 2 stays routed-but-unopened while
      // the reload happens: the exact reconnect-at-handoff window.
      const startedModuleIds: string[] = [];
      let releaseStart!: () => void;
      const released = new Promise<void>((resolve) => {
        releaseStart = resolve;
      });
      let held = false;
      const startPattern = "**/v1/assessment-delivery/schedules/*/modules/start";
      await studentPage.route(startPattern, async (route) => {
        const body = route.request().postDataJSON() as { moduleId?: string } | null;
        if (typeof body?.moduleId === "string") startedModuleIds.push(body.moduleId);
        if (!held) {
          held = true;
          await released;
        }
        await route.continue();
      });
      try {
        await expireCurrentBaseModule(studentPage, scheduleId, attemptId, candidateId, "reading-writing");
        // Wait until the server has routed: the HIGH attempt exists while
        // the student's start stays held.
        let highModuleId: string | null = null;
        await expect
          .poll(
            async () => {
              const current = await readDeliveryFrame(studentPage, scheduleId, attemptId, candidateId);
              const pending = current.attempt.moduleAttempts.find((item) => {
                const module = current.sections
                  .find((section) => section.sectionKey === "reading-writing")
                  ?.modules.find((candidate) => candidate.id === item.moduleId);
                return module?.adaptiveRole === "higher_branch";
              });
              highModuleId = pending?.moduleId ?? null;
              return highModuleId;
            },
            { timeout: 60_000, intervals: [500, 1_000, 2_000] },
          )
          .not.toBeNull();
        if (!highModuleId) throw new Error("HIGH branch attempt never materialized");

        const decision = await routeDecision(attemptId);
        expect(decision.route).toBe("higher");
        expect(decision.moduleId).toBe(highModuleId);

        // Reload inside the held window, then let the start through: every
        // start the client fires must name the routed module — never LOW.
        await studentPage.reload({ waitUntil: "domcontentloaded" });
        await expect
          .poll(() => Promise.resolve(startedModuleIds.length), { timeout: 45_000 })
          .toBeGreaterThan(0);
        releaseStart();
        await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
        expect(startedModuleIds.length).toBeGreaterThan(0);
        for (const moduleId of startedModuleIds) {
          expect(moduleId).toBe(highModuleId);
        }

        // The opened module is the routed one, end to end.
        const opened = await waitForActiveBranch(
          studentPage,
          scheduleId,
          attemptId,
          candidateId,
          "reading-writing",
        );
        expect(opened.moduleId).toBe(highModuleId);
        expect(opened.role).toBe("higher_branch");
      } finally {
        releaseStart();
        await studentPage.unroute(startPattern);
      }
    } finally {
      await studentContext.close();
    }
  });

  test("Staff view converges to Higher and never regresses to Module 1", async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Adaptive identity scenarios run once in desktop Chromium.",
    );
    const { studentContext, studentPage, scheduleId, candidateId, attemptId, studentName } =
      await startSatAttempt(page, browser, {
        titlePrefix: "SAT Adaptive Staff",
        linkPrefix: "SAT Adaptive Staff Link",
        studentPrefix: "SAT Adaptive Staff Student",
      });
    try {
      const frame = await readDeliveryFrame(studentPage, scheduleId, attemptId, candidateId);
      const base = frame.sections
        .find((item) => item.sectionKey === "reading-writing")
        ?.modules.find((module) => module.adaptiveRole === "base");
      if (!base) throw new Error("Reading & Writing base module missing from bootstrap");
      await answerBaseModuleCorrectly(studentPage, scheduleId, attemptId, candidateId, base.id);
      await expireCurrentBaseModule(studentPage, scheduleId, attemptId, candidateId, "reading-writing");

      // Convergence: the staff projection must arrive at the routed module.
      await expect
        .poll(async () => (await staffProjection(page, scheduleId, studentName)).runtimeCurrentModuleId, {
          timeout: 60_000,
          intervals: [500, 1_000, 2_000],
        })
        .not.toBeNull();
      const converged = await staffProjection(page, scheduleId, studentName);
      const decision = await routeDecision(attemptId);
      expect(decision.route).toBe("higher");
      expect(converged.runtimeCurrentModuleId).toBe(decision.moduleId);
      expect(converged.runtimeCurrentModuleRole).toBe("higher_branch");
      const heartbeatBefore = converged.lastActivity;

      // Reconnect the student (fresh heartbeat) and re-read the staff page
      // repeatedly: the roster must still name the routed module — presence
      // freshness must never regress exam-state freshness.
      await studentPage.reload({ waitUntil: "domcontentloaded" });
      await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
      for (let round = 0; round < 3; round += 1) {
        await page.goto(`/sat/sessions/${scheduleId}`);
        await expect(page.getByText("Run sheet", { exact: true })).toBeVisible({ timeout: 30_000 });
        const reread = await staffProjection(page, scheduleId, studentName);
        expect(reread.runtimeCurrentModuleId).toBe(decision.moduleId);
        expect(reread.runtimeCurrentModuleRole).toBe("higher_branch");
      }
      const after = await staffProjection(page, scheduleId, studentName);
      expect(after.runtimeCurrentModuleId).toBe(decision.moduleId);
      if (heartbeatBefore && after.lastActivity) {
        expect(Date.parse(after.lastActivity) >= Date.parse(heartbeatBefore)).toBe(true);
      }
    } finally {
      await studentContext.close();
    }
  });
});

type DeliveryFrame = {
  sections: Array<{
    id: string;
    sectionKey: string;
    modules: Array<{ id: string; adaptiveRole: string }>;
  }>;
  attempt: {
    id: string;
    moduleAttempts: Array<{ id: string; moduleId: string; state: string }>;
  };
};

type StaffProjection = {
  runtimeCurrentModuleId: string | null;
  runtimeCurrentModuleRole: string | null;
  attemptRevision: number | null;
  lastActivity: string | null;
};

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
 * Shared journey setup: author, publish, link, join, and proctor-start a
 * real SAT so the exam is live with the first module auto-opened. Mirrors
 * the product-workspace harness (same UI path, same assertions) without the
 * co-edit save barrier that flakes in constrained environments: readiness
 * is proven by the authored-question count, not the realtime acknowledgement.
 */
async function startSatAttempt(
  page: Page,
  browser: { newContext: () => Promise<BrowserContext> },
  options: { titlePrefix?: string; linkPrefix?: string; studentPrefix?: string } = {},
): Promise<SatAttemptHarness> {
  const stamp = Date.now().toString(36);
  const examTitle = `${options.titlePrefix ?? "SAT Adaptive"} ${stamp}`;
  const linkName = `${options.linkPrefix ?? "SAT Adaptive Link"} ${stamp}`;
  const studentName = `${options.studentPrefix ?? "SAT Adaptive Student"} ${stamp}`;
  const studentEmail = `sat-adaptive-${stamp}@example.com`;

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
  // Both the load dialog and the section panel report the authored count;
  // match either surface — the load is done when all 147 are authored.
  await expect(page.getByText(/147 of 147 (questions )?authored/).first()).toBeVisible({
    timeout: 90_000,
  });
  // Release reads the committed Go projection, not the optimistic editor
  // view. Wait for the co-edit acknowledgement before crossing that barrier.
  await expect(page.getByText("Saved", { exact: true }).last()).toBeVisible({ timeout: 90_000 });

  await page.getByRole("button", { name: "Release" }).click();
  await expect(page).toHaveURL(`/sat/exams/${examId}/release`);
  await expect(page.getByRole("heading", { name: "Ready to publish" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Publish" }).click();
  const publishDialog = page.getByRole("dialog");
  await expect(publishDialog).toBeVisible();
  await publishDialog.getByRole("button", { name: "Publish Full SAT", exact: true }).click();

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
  await expect(studentPage.getByRole("heading", { name: linkName })).toBeVisible({ timeout: 30_000 });
  await expect(studentPage.getByText(`${examTitle} · Version 1`)).toBeVisible();
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
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText("Session started.")).toBeVisible({ timeout: 20_000 });

  // The proctor's Start is the ONLY action taken: refresh (never click) and
  // the module must be OPEN by itself. One reload retry absorbs a first load
  // that raced the runtime start; entry itself is still asserted below.
  await studentPage.reload();
  try {
    await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
  } catch {
    await studentPage.reload();
    await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
  }
  await expect(studentPage.getByRole("button", { name: /Begin module/i })).toHaveCount(0);
  const attemptId = await studentPage.evaluate(
    async ({ scheduleId: id, candidateId: candidate }) => {
      const response = await fetch(
        `/api/v1/student/sessions/${id}/live?candidateId=${encodeURIComponent(candidate)}`,
      );
      const payload = (await response.json()) as {
        data?: { attempt?: { id?: string } };
        attempt?: { id?: string };
      };
      return payload?.data?.attempt?.id ?? payload?.attempt?.id ?? null;
    },
    { scheduleId, candidateId },
  );
  if (!attemptId) throw new Error("SAT student attempt did not materialize after proctor start");

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

async function readDeliveryFrame(
  studentPage: import("@playwright/test").Page,
  scheduleId: string,
  attemptId: string,
  candidateId: string,
): Promise<DeliveryFrame> {
  return studentPage.evaluate(
    async ({ scheduleId: id, attemptId: attempt, candidateId: candidate }) => {
      const delivery = await import("/src/features/student-delivery/api/assessmentDeliveryApi.ts");
      delivery.configureAssessmentDeliveryAttempt(id, attempt, candidate);
      const snapshot = await delivery.assessmentDeliveryApi.bootstrap(id, attempt);
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
          })),
        },
      };
    },
    { scheduleId, attemptId, candidateId },
  );
}

async function correctAnswerPlan(
  moduleId: string,
): Promise<Array<{ examQuestionId: string; correctAnswer: string }>> {
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
      parsed.kind === "student_produced_response" &&
      Array.isArray(parsed.acceptedResponses) &&
      typeof parsed.acceptedResponses[0] === "string"
    ) {
      plan.push({
        examQuestionId: row.exam_question_id,
        correctAnswer: parsed.acceptedResponses[0] as string,
      });
    }
  }
  return plan;
}

/** Answer every keyed base question correctly through the real V2 transport. */
async function answerBaseModuleCorrectly(
  studentPage: import("@playwright/test").Page,
  scheduleId: string,
  attemptId: string,
  candidateId: string,
  baseModuleId: string,
): Promise<number> {
  const answerPlan = await correctAnswerPlan(baseModuleId);
  if (answerPlan.length < 1) throw new Error(`No answerable base questions for ${baseModuleId}`);
  const answered = await studentPage.evaluate(
    async ({ scheduleId: id, attemptId: attempt, candidateId: candidate, baseModuleId: base, answerPlan }) => {
      const delivery = await import("/src/features/student-delivery/api/assessmentDeliveryApi.ts");
      delivery.configureAssessmentDeliveryAttempt(id, attempt, candidate);
      const snapshot = await delivery.assessmentDeliveryApi.bootstrap(id, attempt);
      const baseAttempt = snapshot.attempt.moduleAttempts.find((item) => item.moduleId === base);
      if (!baseAttempt) throw new Error(`No module attempt for ${base}`);
      if (baseAttempt.state === "not_started") {
        await delivery.assessmentDeliveryApi.startModule(id, attempt, { moduleId: base });
      }
      const durable = await import("/src/features/student/infrastructure/responseDurabilityTransport.ts");
      const engineMod = await import("/src/shared/durability/DurableResponseEngine.ts");
      const transport = durable.createResponseDurabilityV2Transport(id, undefined);
      const engine = new engineMod.DurableResponseEngine({
        scheduleId: id,
        attemptId: attempt,
        leaseEpoch: 1,
        controlEpoch: 1,
        drainDebounceMs: 0,
        transport,
      });
      await engine.recover();
      let answeredCount = 0;
      for (const item of answerPlan as Array<{ examQuestionId: string; correctAnswer: string }>) {
        await engine.acceptResponse(item.examQuestionId, {
          answer: item.correctAnswer,
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
      return answeredCount;
    },
    { scheduleId, attemptId, candidateId, baseModuleId, answerPlan },
  );
  if (answered < 1) throw new Error(`Nothing answerable in ${baseModuleId}`);
  return answered;
}

async function expireModuleAttempt(moduleAttemptId: string): Promise<void> {
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

async function expireCurrentBaseModule(
  studentPage: import("@playwright/test").Page,
  scheduleId: string,
  attemptId: string,
  candidateId: string,
  sectionKey: string,
): Promise<string> {
  // Auto-entry opens the base module on its own cadence (especially right
  // after a section advance), so wait until it is started before expiring
  // it — expiring a not_started attempt is a silent no-op below.
  let baseId: string | null = null;
  let baseAttemptId: string | null = null;
  await expect
    .poll(
      async () => {
        const frame = await readDeliveryFrame(studentPage, scheduleId, attemptId, candidateId);
        const section = frame.sections.find((item) => item.sectionKey === sectionKey);
        const base = section?.modules.find((module) => module.adaptiveRole === "base");
        const baseAttempt = frame.attempt.moduleAttempts.find((item) => item.moduleId === base?.id);
        if (base && baseAttempt && ["active", "review"].includes(baseAttempt.state)) {
          baseId = base.id;
          baseAttemptId = baseAttempt.id;
          return baseAttempt.id;
        }
        return null;
      },
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .not.toBeNull();
  if (!baseId || !baseAttemptId) throw new Error(`No started base module attempt for ${sectionKey}`);
  await expireModuleAttempt(baseAttemptId);
  return baseId;
}

async function routeDecision(attemptId: string): Promise<{ sectionKey: string; route: string; moduleId: string }> {
  const rows = await queryDb<{ section_key: string; selected_route: string; selected_module_id: string }>(
    `SELECT s.section_key, rd.selected_route, rd.selected_module_id
       FROM assessment_route_decisions rd
       JOIN assessment_sections s ON s.id = rd.section_id
      WHERE rd.attempt_id = ?
      ORDER BY s.display_order
      LIMIT 1`,
    [attemptId],
  );
  const row = rows[0];
  if (!row) throw new Error(`No route decision for attempt ${attemptId}`);
  return { sectionKey: row.section_key, route: row.selected_route, moduleId: row.selected_module_id };
}

async function routeDecisionForSection(
  attemptId: string,
  sectionKey: string,
): Promise<{ route: string; moduleId: string }> {
  const rows = await queryDb<{ selected_route: string; selected_module_id: string }>(
    `SELECT rd.selected_route, rd.selected_module_id
       FROM assessment_route_decisions rd
       JOIN assessment_sections s ON s.id = rd.section_id
      WHERE rd.attempt_id = ? AND s.section_key = ?`,
    [attemptId, sectionKey],
  );
  const row = rows[0];
  if (!row) throw new Error(`No route decision for ${sectionKey}`);
  return { route: row.selected_route, moduleId: row.selected_module_id };
}

async function staffProjection(
  page: import("@playwright/test").Page,
  scheduleId: string,
  studentName: string,
): Promise<StaffProjection> {
  const response = await page.request.get(
    `/api/v1/proctor/sessions/${scheduleId}?mode=dashboard&auditLimit=200&alertLimit=100`,
  );
  if (!response.ok()) throw new Error(`Proctor detail read failed: ${response.status()}`);
  const detail = (await response.json()) as {
    sessions?: Array<{
      studentName?: string;
      runtimeCurrentModuleId?: string | null;
      runtimeCurrentModuleRole?: string | null;
      attemptRevision?: number | null;
      lastActivity?: string | null;
    }>;
  };
  const session = (detail.sessions ?? []).find((item) => item.studentName === studentName);
  if (!session) throw new Error(`Student ${studentName} missing from the proctor roster`);
  return {
    runtimeCurrentModuleId: session.runtimeCurrentModuleId ?? null,
    runtimeCurrentModuleRole: session.runtimeCurrentModuleRole ?? null,
    attemptRevision: session.attemptRevision ?? null,
    lastActivity: session.lastActivity ?? null,
  };
}

/** Poll bootstrap until the routed (non-base) branch attempt is active. */
async function waitForActiveBranch(
  studentPage: import("@playwright/test").Page,
  scheduleId: string,
  attemptId: string,
  candidateId: string,
  sectionKey: string,
): Promise<{ moduleId: string; role: string; attemptId: string }> {
  let found: { moduleId: string; role: string; attemptId: string } | null = null;
  await expect
    .poll(
      async () => {
        const frame = await readDeliveryFrame(studentPage, scheduleId, attemptId, candidateId);
        const section = frame.sections.find((item) => item.sectionKey === sectionKey);
        const branch = frame.attempt.moduleAttempts.find((item) => {
          const module = section?.modules.find((candidate) => candidate.id === item.moduleId);
          return module !== undefined && module.adaptiveRole !== "base" && item.state === "active";
        });
        if (!branch) return null;
        const module = section?.modules.find((candidate) => candidate.id === branch.moduleId);
        found = { moduleId: branch.moduleId, role: module?.adaptiveRole ?? "unknown", attemptId: branch.id };
        return branch.moduleId;
      },
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .not.toBeNull();
  if (!found) throw new Error(`No active adaptive branch for ${sectionKey}`);
  return found;
}

async function waitForTerminalBranch(
  studentPage: import("@playwright/test").Page,
  scheduleId: string,
  attemptId: string,
  candidateId: string,
  branchAttemptId: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const frame = await readDeliveryFrame(studentPage, scheduleId, attemptId, candidateId);
        return (
          frame.attempt.moduleAttempts.find((item) => item.id === branchAttemptId)?.state ?? "missing"
        );
      },
      { timeout: 60_000, intervals: [500, 1_000, 2_000] },
    )
    .toMatch(/^(submitted|locked)$/);
}

async function expireCurrentSatSection(scheduleId: string, attemptId: string): Promise<void> {
  const affected = await executeTransaction(async (connection) => {
    const [attemptRows] = await connection.execute(
      "SELECT id FROM student_attempts WHERE id = ? AND schedule_id = ? AND protocol_version = 2 FOR UPDATE",
      [attemptId, scheduleId],
    );
    if ((attemptRows as Array<Record<string, unknown>>).length === 0) return 0;
    const [runtimeRows] = await connection.execute(
      "SELECT id, active_section_key FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE",
      [scheduleId],
    );
    const runtime = (runtimeRows as Array<{ id: string; active_section_key: string | null }>)[0];
    if (!runtime?.active_section_key) return 0;
    const [sectionRows] = await connection.execute(
      "SELECT section_key FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = ? AND status = 'live' FOR UPDATE",
      [runtime.id, runtime.active_section_key],
    );
    if ((sectionRows as Array<Record<string, unknown>>).length === 0) return 0;
    await connection.execute(
      // The authored break gap is zeroed: section advance (not break
      // behavior) is what this spec exercises, and a multi-minute gap
      // would park the run between sections past every sane poll budget.
      `UPDATE exam_session_runtime_sections
          SET actual_start_at = DATE_SUB(NOW(6), INTERVAL 2 MINUTE),
              planned_duration_minutes = 1,
              gap_after_minutes = 0,
              extension_minutes = 0,
              accumulated_paused_seconds = 0
        WHERE runtime_id = ? AND section_key = ? AND status = 'live'`,
      [runtime.id, runtime.active_section_key],
    );
    const [attemptUpdate] = await connection.execute(
      `UPDATE student_attempts
          SET deadline_at = DATE_SUB(NOW(6), INTERVAL 1 MINUTE),
              closing_grace_until = DATE_SUB(NOW(6), INTERVAL 30 SECOND)
        WHERE id = ? AND schedule_id = ? AND protocol_version = 2`,
      [attemptId, scheduleId],
    );
    return Number((attemptUpdate as { affectedRows?: number }).affectedRows ?? 0);
  });
  if (affected < 1) {
    throw new Error("Expected one live SAT section to expire");
  }
}

async function readRuntimeStage(
  page: import("@playwright/test").Page,
  scheduleId: string,
): Promise<{ currentSectionKey: string | null }> {
  const response = await page.request.get(`/api/v1/schedules/${scheduleId}/runtime`);
  if (!response.ok()) throw new Error(`Runtime read failed: ${response.status()}`);
  const payload = (await response.json()) as {
    data?: { currentSectionKey?: string | null };
    currentSectionKey?: string | null;
  };
  const runtime = payload.data ?? payload;
  return { currentSectionKey: runtime.currentSectionKey ?? null };
}

import { expect, test } from "@playwright/test";
import { regressesAttemptState } from "../src/features/student-delivery/application/satBootstrapEquality";
import type { AssessmentDeliveryBootstrap } from "../src/features/student-delivery/contracts/assessmentDelivery";
import { ADMIN_STORAGE_STATE_PATH } from "./support/backendE2e";
import { executeUpdate, queryDb } from "./support/db";
import { createRunningSatSession } from "./support/satStudentSession";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

test.describe("SAT student transitions", () => {
  test.describe.configure({ timeout: 240_000 });

  test("keeps the newer attempt snapshot when bootstrap and state responses finish out of order", async ({
    page,
  }) => {
    await page.goto("/");
    for (const endpoint of ["bootstrap", "state"]) {
      const older = {
        attempt: {
          id: "attempt-order",
          moduleAttempts: [{ id: "m1-attempt", moduleId: "m1", state: "active", revision: 1 }],
          personalBreaks: [],
        },
        timing: { runtimeRevision: 7 },
        result: null,
      } as unknown as AssessmentDeliveryBootstrap;
      const newer = {
        attempt: {
          id: "attempt-order",
          moduleAttempts: [
            { id: "m1-attempt", moduleId: "m1", state: "locked", revision: 2 },
            { id: "m2-attempt", moduleId: "m2-higher", state: "active", revision: 1 },
          ],
          personalBreaks: [],
        },
        timing: { runtimeRevision: 7 },
        result: null,
      } as unknown as AssessmentDeliveryBootstrap;
      const olderSeen = deferredSignal();
      const newerSeen = deferredSignal();
      const releaseOlder = deferredSignal();
      const releaseNewer = deferredSignal();
      const routePattern = new RegExp(
        `/api/v1/assessment-delivery/schedules/e2e-order/${endpoint}[?]snapshot=(older|newer)$`
      );
      const handler = async (route: import("@playwright/test").Route) => {
        const isOlder = new URL(route.request().url()).searchParams.get("snapshot") === "older";
        (isOlder ? olderSeen : newerSeen).resolve();
        await (isOlder ? releaseOlder : releaseNewer).promise;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "Cache-Control": "no-store" },
          body: JSON.stringify(isOlder ? older : newer),
        });
      };
      const capture = captureDeliveryResponses(page);
      await page.route(routePattern, handler);
      try {
        const path = `/api/v1/assessment-delivery/schedules/e2e-order/${endpoint}`;
        const olderRequest = page.evaluate(
          async (url) => (await fetch(url)).text(),
          `${path}?snapshot=older`
        );
        const newerRequest = page.evaluate(
          async (url) => (await fetch(url)).text(),
          `${path}?snapshot=newer`
        );
        await Promise.all([olderSeen.promise, newerSeen.promise]);

        releaseNewer.resolve();
        const newerBody = await newerRequest;
        let committed = JSON.parse(newerBody) as AssessmentDeliveryBootstrap;
        expect(
          (await capture.collectedBodies()).map(
            (body) => JSON.parse(body).attempt.moduleAttempts.length
          )
        ).toEqual([2]);

        releaseOlder.resolve();
        const olderBody = await olderRequest;
        const stale = JSON.parse(olderBody) as AssessmentDeliveryBootstrap;
        if (!regressesAttemptState(committed, stale)) committed = stale;
        expect(committed.attempt.moduleAttempts.map((module) => module.moduleId)).toEqual([
          "m1",
          "m2-higher",
        ]);
        expect(
          (await capture.collectedBodies()).map(
            (body) => JSON.parse(body).attempt.moduleAttempts.length
          )
        ).toEqual([2, 1]);
      } finally {
        releaseOlder.resolve();
        releaseNewer.resolve();
        capture.detach();
        await page.unroute(routePattern, handler);
      }
    }
  });

  test("moves from pre-start through early branch routing, the scheduled break, and completion", async ({
    page,
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "The transition flow runs once in desktop Chromium; device sizes are checked in the scenario."
    );
    const { studentContext, studentPage, scheduleId, candidateId } = await createRunningSatSession(
      browser,
      page,
      {
        label: "transitions",
        startRuntime: false,
        studentContext: { reducedMotion: "reduce" },
      }
    );

    const delivery = captureDeliveryResponses(studentPage);
    try {
      const readingBranches = await readAdaptiveBranches(scheduleId, "reading-writing");
      expect(readingBranches).toHaveLength(2);
      expect(
        await studentPage.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)
      ).toBe(true);
      await expect(
        studentPage.getByRole("heading", { name: /Waiting for your proctor/ })
      ).toBeVisible({ timeout: 30_000 });
      await expect(studentPage.getByTestId("sat-exam-shell")).toHaveCount(0);
      await expect(studentPage.getByRole("button", { name: /Begin module/i })).toHaveCount(0);
      await studentPage.reload({ waitUntil: "domcontentloaded" });
      await expect(
        studentPage.getByRole("heading", { name: /Waiting for your proctor/ })
      ).toBeVisible({ timeout: 30_000 });

      await page.getByRole("button", { name: "Start" }).click();
      await expect(page.getByText("Session started.")).toBeVisible({ timeout: 20_000 });
      await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
      await expect(studentPage.getByRole("button", { name: /Begin module/i })).toHaveCount(0);
      await studentPage.reload({ waitUntil: "domcontentloaded" });
      await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
      const beforeRoutingBodies = await delivery.collectedBodies();
      expect(beforeRoutingBodies.length).toBeGreaterThan(0);
      const staleStateBody = beforeRoutingBodies.find((body) => {
        const snapshot = JSON.parse(body) as AssessmentDeliveryBootstrap;
        return snapshot.attempt?.moduleAttempts?.some((module) => module.state === "active");
      });
      expect(staleStateBody, "the pre-routing attempt snapshot must be captured").toBeDefined();
      for (const body of beforeRoutingBodies) {
        for (const branch of readingBranches) assertBranchAbsent(body, branch);
      }

      const beforeSubmit = await readSectionModules(
        studentPage,
        scheduleId,
        candidateId,
        "reading-writing"
      );
      expect(beforeSubmit.find((module) => module.adaptiveRole === "base")?.state).toBe("active");
      const moduleOneQuestionText = await studentPage
        .locator("[data-sat-question-scroll]")
        .first()
        .innerText();
      await expectEarlyModuleSubmitRejected(studentPage, scheduleId, candidateId);

      await markExamFrame(studentPage);
      await reviewAndExpireCurrentModule(studentPage, scheduleId);
      await expect
        .poll(
          async () => {
            const modules = await readSectionModules(
              studentPage,
              scheduleId,
              candidateId,
              "reading-writing"
            );
            return (
              modules.find((module) => module.adaptiveRole !== "base" && module.state === "active")
                ?.state ?? null
            );
          },
          { timeout: 45_000, intervals: [250, 500, 1_000, 2_000] }
        )
        .toBe("active");
      // The server opens the assigned branch. Check the raw responses received
      // across that handoff for both the unassigned module and its questions.
      const unassigned = await readUnassignedBranch(scheduleId, candidateId, "reading-writing");
      expect(unassigned, "the fixture must author two adaptive branches").not.toBeNull();
      const routedBodies = await delivery.collectedBodies();
      expect(routedBodies.length).toBeGreaterThan(0);
      for (const body of routedBodies) assertBranchAbsent(body, unassigned!);
      await expect(studentPage.locator("[data-sat-transition-hold]")).toHaveCount(0);
      await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
      const unassignedAfterEntry = await readUnassignedBranch(
        scheduleId,
        candidateId,
        "reading-writing"
      );
      expect(unassignedAfterEntry).not.toBeNull();
      for (const body of await delivery.collectedBodies()) {
        assertBranchAbsent(body, unassignedAfterEntry!);
      }
      const moduleTwoQuestionText = await studentPage
        .locator("[data-sat-question-scroll]")
        .first()
        .innerText();
      expect(moduleTwoQuestionText).not.toBe(moduleOneQuestionText);
      const staleSnapshot = JSON.parse(staleStateBody!) as AssessmentDeliveryBootstrap;
      const statePattern = `**/api/v1/assessment-delivery/schedules/${scheduleId}/state`;
      await studentPage.route(statePattern, async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ...staleSnapshot, sections: [] }),
        });
      });
      try {
        const staleStateResponse = studentPage.waitForResponse(
          (response) =>
            response.url().includes(`/assessment-delivery/schedules/${scheduleId}/state`) &&
            response.status() === 200,
          { timeout: 45_000 }
        );
        const response = await staleStateResponse;
        await response.text();
        await delivery.collectedBodies();
        await studentPage.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
            )
        );
        expect(await studentPage.locator("[data-sat-question-scroll]").first().innerText()).toBe(
          moduleTwoQuestionText
        );
      } finally {
        await studentPage.unroute(statePattern);
      }
      // One frame throughout: the handoff reconciled the surface it already had
      // instead of mounting the next module on a fresh one.
      await expectSameExamFrameNode(studentPage);
      await assertSingleSatStage(studentPage);
      await expect(studentPage.getByRole("button", { name: /Begin module/i })).toHaveCount(0);
      await expect(studentPage.getByRole("heading", { name: "Review your answers" })).toHaveCount(
        0
      );
      await studentPage.reload({ waitUntil: "domcontentloaded" });
      await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
      await expect(studentPage.getByRole("button", { name: /Begin module/i })).toHaveCount(0);

      await reviewAndExpireCurrentModule(studentPage, scheduleId);
      const scheduledBreak = studentPage.getByTestId("sat-scheduled-break");
      await expect(scheduledBreak).toBeVisible({ timeout: 30_000 });
      await assertSingleSatStage(studentPage);
      await expect(scheduledBreak).toHaveAttribute("data-sat-break-phase", "active");
      await expect(scheduledBreak.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(scheduledBreak.getByRole("timer")).toBeVisible();
      await expect(studentPage.getByRole("button", { name: /Begin module/i })).toHaveCount(0);
      await studentPage.reload({ waitUntil: "domcontentloaded" });
      await expect(studentPage.getByTestId("sat-scheduled-break")).toHaveAttribute(
        "data-sat-break-phase",
        "active"
      );
      await assertNoHorizontalOverflow(studentPage, [
        { width: 390, height: 844 },
        { width: 768, height: 1024 },
        { width: 1440, height: 900 },
      ]);

      const expiredBreak = await executeUpdate(
        `UPDATE assessment_attempt_breaks b
         JOIN student_attempts a ON a.id = b.attempt_id
            SET b.starts_at = NOW(6) - INTERVAL 11 MINUTE,
                b.deadline_at = NOW(6) - INTERVAL 1 MINUTE,
                b.updated_at = NOW(6)
          WHERE a.schedule_id = ?
            AND a.candidate_id = ?
            AND b.state = 'active'`,
        [scheduleId, candidateId]
      );
      expect(expiredBreak).toBe(1);
      // Math Module 1 was scheduled at the original break deadline. Advance
      // that availability too when the test moves the personal clock forward.
      const availableMath = await executeUpdate(
        `UPDATE assessment_module_attempts ma
         JOIN student_attempts a ON a.id = ma.attempt_id
         JOIN assessment_modules m ON m.id = ma.module_id
         JOIN assessment_sections s ON s.id = m.section_id
            SET ma.available_at = NOW(6) - INTERVAL 1 MINUTE
          WHERE a.schedule_id = ?
            AND a.candidate_id = ?
            AND s.section_key = 'math'
            AND m.adaptive_role = 'base'
            AND ma.state = 'not_started'`,
        [scheduleId, candidateId]
      );
      expect(availableMath).toBe(1);
      await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
      await expect(studentPage.getByTestId("sat-scheduled-break")).toHaveCount(0);
      await expect(studentPage.getByRole("button", { name: /Begin module/i })).toHaveCount(0);
      await studentPage.reload({ waitUntil: "domcontentloaded" });
      await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
      await expect
        .poll(
          async () => {
            const modules = await readSectionModules(studentPage, scheduleId, candidateId, "math");
            return modules.find((module) => module.adaptiveRole === "base")?.state ?? null;
          },
          { timeout: 45_000, intervals: [250, 500, 1_000, 2_000] }
        )
        .toBe("active");

      await markExamFrame(studentPage);
      await reviewAndExpireCurrentModule(studentPage, scheduleId);
      await expect(studentPage.locator("[data-sat-transition-hold]")).toHaveCount(0);
      await expectSameExamFrameNode(studentPage);

      await expect
        .poll(
          async () => {
            const modules = await readSectionModules(studentPage, scheduleId, candidateId, "math");
            return (
              modules.find((module) => module.adaptiveRole !== "base" && module.state === "active")
                ?.state ?? null
            );
          },
          { timeout: 45_000, intervals: [250, 500, 1_000, 2_000] }
        )
        .toBe("active");
      await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
      await expect(studentPage.getByRole("button", { name: /Begin module/i })).toHaveCount(0);
      await studentPage.reload({ waitUntil: "domcontentloaded" });
      await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });

      await reviewAndExpireCurrentModule(studentPage, scheduleId);
      await expect(studentPage.getByRole("heading", { name: "SAT Complete" })).toBeVisible({
        timeout: 60_000,
      });
      await expect(studentPage.getByRole("button", { name: /Begin module/i })).toHaveCount(0);
    } finally {
      delivery.detach();
      await studentContext.close();
    }
  });
  for (const scenario of [
    "delayed final batch",
    "offline at zero",
    "reload during handoff",
  ] as const) {
    test(`client-start handoff survives ${scenario}`, async ({ browser, page }) => {
      test.skip(
        process.env["SAT_HANDOFF_MODE"] !== "client_start",
        "Requires an opt-in client-start runtime."
      );
      const session = await createRunningSatSession(browser, page, { label: scenario });
      const student = session.studentPage;
      const release = deferredSignal();
      let sawRequest = false;
      const runtimes = await queryDb<{ sat_handoff_mode: string }>(
        "SELECT sat_handoff_mode FROM exam_session_runtimes WHERE schedule_id = ?",
        [session.scheduleId]
      );
      expect(runtimes[0]!.sat_handoff_mode).toBe("client_start");
      const bases = await queryDb<{ id: string; attempt_id: string; module_id: string }>(
        `SELECT ma.id, ma.attempt_id, ma.module_id FROM assessment_module_attempts ma
         JOIN student_attempts a ON a.id = ma.attempt_id WHERE a.schedule_id = ? AND ma.state = 'active'`,
        [session.scheduleId]
      );
      expect(bases).toHaveLength(1);
      const base = bases[0]!;
      let finalQuestion: string | undefined;
      try {
        if (scenario === "delayed final batch") {
          await student.route("**/responses:batch", async (route) => {
            const command = route.request().postDataJSON().commands[0];
            finalQuestion = command.questionId;
            sawRequest = true;
            await release.promise;
            await route.continue();
          });
          await student.getByRole("radio").first().press("Space");
          await expect.poll(() => sawRequest, { timeout: 30_000 }).toBe(true);
          // Hold the final packet across the old three-second boundary.
          await executeUpdate(
            "UPDATE assessment_module_attempts SET started_at = TIMESTAMPADD(SECOND, -allocated_seconds - 4, NOW(6)) WHERE id = ?",
            [base.id]
          );
          release.resolve();
          await expect
            .poll(
              async () =>
                (
                  await queryDb<{ n: number }>(
                    "SELECT COUNT(*) AS n FROM attempt_responses_v2 WHERE attempt_id = ? AND question_id = ?",
                    [base.attempt_id, finalQuestion!]
                  )
                )[0]!.n
            )
            .toBe(1);
          await student.unroute("**/responses:batch");
        } else if (scenario === "offline at zero") {
          await executeUpdate(
            "UPDATE assessment_module_attempts SET allocated_seconds = 10, started_at = NOW(6) WHERE id = ?",
            [base.id]
          );
          await student.reload({ waitUntil: "domcontentloaded" });
          await expect(student.getByTestId("sat-exam-shell")).toBeVisible();
          await session.studentContext.setOffline(true);
          await student.getByRole("radio").first().press("Space");
          await expect
            .poll(
              async () =>
                (
                  await queryDb<{ state: string }>(
                    "SELECT state FROM assessment_module_attempts WHERE id = ?",
                    [base.id]
                  )
                )[0]!.state,
              { timeout: 40_000 }
            )
            .toBe("locked");
          await session.studentContext.setOffline(false);
          await expect
            .poll(
              async () =>
                (
                  await queryDb<{ n: number }>(
                    "SELECT COUNT(*) AS n FROM assessment_late_answer_evidence WHERE attempt_id = ?",
                    [base.attempt_id]
                  )
                )[0]!.n,
              { timeout: 30_000 }
            )
            .toBe(1);
        } else {
          await student.route("**/modules/start", async (route) => {
            sawRequest = true;
            await release.promise;
            await route.continue().catch(() => undefined); // Reload aborts the old request.
          });
          await executeUpdate(
            "UPDATE assessment_module_attempts SET started_at = TIMESTAMPADD(SECOND, -allocated_seconds - 20, NOW(6)) WHERE id = ?",
            [base.id]
          );
          await expect.poll(() => sawRequest, { timeout: 30_000 }).toBe(true);
          const waiting = await queryDb<{ state: string; started_at: string | null }>(
            "SELECT state, started_at FROM assessment_module_attempts WHERE attempt_id = ? AND module_id <> ?",
            [base.attempt_id, base.module_id]
          );
          expect(waiting).toHaveLength(1);
          expect(waiting[0]).toMatchObject({ state: "not_started", started_at: null });
          await student.reload({ waitUntil: "domcontentloaded" });
          release.resolve();
        }
        await expect
          .poll(
            async () =>
              (
                await queryDb<{ n: number }>(
                  "SELECT COUNT(*) AS n FROM assessment_module_attempts WHERE attempt_id = ? AND module_id <> ? AND state = 'active'",
                  [base.attempt_id, base.module_id]
                )
              )[0]!.n,
            { timeout: 45_000 }
          )
          .toBe(1);
        await expect(student.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 30_000 });
        const branch = await queryDb<{ n: number }>(
          "SELECT COUNT(*) AS n FROM assessment_route_decisions WHERE attempt_id = ?",
          [base.attempt_id]
        );
        expect(branch[0]!.n).toBe(1);
        const questions = await queryDb<{ id: string }>(
          `SELECT eq.id FROM assessment_exam_questions eq JOIN assessment_module_attempts ma ON ma.module_id = eq.module_id
           WHERE ma.attempt_id = ? AND ma.state = 'active' ORDER BY eq.display_order LIMIT 1`,
          [base.attempt_id]
        );
        const option = student.locator(`input[name="sat-answer-${questions[0]!.id}"]`).first();
        await expect(option).toBeVisible({ timeout: 30_000 });
        const saved = student.waitForResponse(
          (response) => response.url().endsWith("/responses:batch") && response.status() === 200
        );
        await option.press("Space");
        await saved;
      } finally {
        release.resolve();
        await session.studentContext.setOffline(false);
        await session.studentContext.close();
      }
    });
  }
});

async function reviewAndExpireCurrentModule(
  page: import("@playwright/test").Page,
  scheduleId: string
): Promise<void> {
  await page.getByRole("button", { name: /Open question navigator/ }).click();
  await page.getByRole("button", { name: "Review answers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Review your answers" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit module", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Submit anyway", exact: true })).toHaveCount(0);
  await expect(page.getByTestId("sat-submit-confirm")).toHaveCount(0);
  const changed = await executeUpdate(
    `UPDATE assessment_module_attempts ma
       JOIN student_attempts a ON a.id = ma.attempt_id
        SET ma.started_at = NOW(6) - INTERVAL 1 HOUR,
            ma.updated_at = NOW(6)
      WHERE a.schedule_id = ?
        AND ma.state IN ('active', 'review')`,
    [scheduleId]
  );
  expect(changed, "the current SAT module clock must expire through server reconciliation").toBe(1);
}

async function expectEarlyModuleSubmitRejected(
  page: import("@playwright/test").Page,
  scheduleId: string,
  candidateId: string
): Promise<void> {
  const outcome = await page.evaluate(
    async ({ scheduleId, candidateId }) => {
      const liveResponse = await fetch(
        `/api/v1/student/sessions/${scheduleId}/live?candidateId=${encodeURIComponent(candidateId)}`
      );
      const livePayload = await liveResponse.json();
      const attemptId = livePayload?.data?.attempt?.id ?? livePayload?.attempt?.id;
      if (typeof attemptId !== "string")
        throw new Error("SAT attempt was unavailable for the early-submit check.");
      const delivery = await import("/src/features/student-delivery/api/assessmentDeliveryApi.ts");
      delivery.configureAssessmentDeliveryAttempt(scheduleId, attemptId, candidateId);
      const snapshot = await delivery.assessmentDeliveryApi.bootstrap(scheduleId, attemptId);
      const active = snapshot.attempt.moduleAttempts.find(
        (item) => item.state === "active" || item.state === "review"
      );
      if (!active) throw new Error("SAT module was not active for the early-submit check.");
      try {
        await delivery.assessmentDeliveryApi.submitModule(scheduleId, attemptId, {
          moduleId: active.moduleId,
        });
        return { accepted: true, status: 200, reason: null };
      } catch (error) {
        const apiError = error as { status?: number; details?: { reason?: string } };
        return {
          accepted: false,
          status: apiError.status ?? null,
          reason: apiError.details?.reason ?? null,
        };
      }
    },
    { scheduleId, candidateId }
  );
  expect(outcome).toEqual({
    accepted: false,
    status: 409,
    reason: "STUDENT_MODULE_SUBMIT_DISABLED",
  });
}

// Capture raw delivery bodies so branch isolation is verified at the API
// boundary, not only through the rendered student surface.
interface DeliveryCapture {
  collectedBodies: () => Promise<string[]>;
  detach: () => void;
}

function deferredSignal(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function captureDeliveryResponses(page: import("@playwright/test").Page): DeliveryCapture {
  const bodies: string[] = [];
  const pending: Promise<void>[] = [];
  const handler = (response: import("@playwright/test").Response): void => {
    if (!response.url().includes("/api/v1/assessment-delivery/")) return;
    if (response.status() !== 200) return;
    pending.push(
      response.text().then((body) => {
        bodies.push(body);
      })
    );
  };
  page.on("response", handler);
  return {
    collectedBodies: async () => {
      await Promise.all([...pending]);
      return [...bodies];
    },
    detach: () => page.off("response", handler),
  };
}

interface UnassignedBranch {
  moduleId: string;
  questionIds: string[];
}

function assertBranchAbsent(body: string, branch: UnassignedBranch): void {
  expect(body, `delivery exposed branch ${branch.moduleId}`).not.toContain(branch.moduleId);
  for (const questionId of branch.questionIds) {
    expect(body, `delivery exposed branch question ${questionId}`).not.toContain(questionId);
  }
}

async function readAdaptiveBranches(
  scheduleId: string,
  sectionKey: string
): Promise<UnassignedBranch[]> {
  const modules = await queryDb<{ id: string }>(
    `SELECT m.id AS id FROM assessment_modules m
       JOIN assessment_sections s ON s.id = m.section_id
       JOIN exam_schedules sch ON sch.published_version_id = s.exam_version_id
      WHERE sch.id = ? AND s.section_key = ?
        AND m.adaptive_role IN ('lower_branch', 'higher_branch')
      ORDER BY m.display_order`,
    [scheduleId, sectionKey]
  );
  return Promise.all(
    modules.map(async ({ id }) => ({
      moduleId: id,
      questionIds: (
        await queryDb<{ id: string }>(
          "SELECT id FROM assessment_exam_questions WHERE module_id = ?",
          [id]
        )
      ).map((row) => row.id),
    }))
  );
}

/** The branch with no module-attempt row for this candidate. */
async function readUnassignedBranch(
  scheduleId: string,
  candidateId: string,
  sectionKey: string
): Promise<UnassignedBranch | null> {
  const modules = await queryDb<{ id: string }>(
    `SELECT m.id AS id
       FROM assessment_modules m
       JOIN assessment_sections s ON s.id = m.section_id
       JOIN exam_schedules sch ON sch.published_version_id = s.exam_version_id
      WHERE s.section_key = ?
        AND sch.id = ?
        AND m.adaptive_role IN ('lower_branch', 'higher_branch')
        AND NOT EXISTS (
              SELECT 1 FROM assessment_module_attempts ma
               WHERE ma.module_id = m.id
                 AND ma.attempt_id = (
                       SELECT a.id FROM student_attempts a
                        WHERE a.schedule_id = ? AND a.candidate_id = ?
                        ORDER BY a.updated_at DESC, a.id DESC LIMIT 1))
      ORDER BY m.display_order
      LIMIT 1`,
    [sectionKey, scheduleId, scheduleId, candidateId]
  );
  if (modules.length === 0) return null;
  const moduleId = modules[0]!.id;
  const questions = await queryDb<{ id: string }>(
    "SELECT id AS id FROM assessment_exam_questions WHERE module_id = ?",
    [moduleId]
  );
  return { moduleId, questionIds: questions.map((row) => row.id) };
}

const EXAM_FRAME_MARKER = "data-e2e-frame-marker";

/**
 * Marks the mounted exam frame so a later assertion can prove it is the SAME
 * node — the handoff must reconcile the surface the student is on, never mount
 * the next module on a fresh one.
 */
async function markExamFrame(page: import("@playwright/test").Page): Promise<void> {
  const marked = await page.evaluate((attribute) => {
    const frame = document.querySelector("[data-sat-student-frame]");
    if (!frame) return false;
    frame.setAttribute(attribute, "same-node");
    return true;
  }, EXAM_FRAME_MARKER);
  expect(marked, "the exam frame must be mounted before the handoff").toBe(true);
}

async function expectSameExamFrameNode(page: import("@playwright/test").Page): Promise<void> {
  const survived = await page.evaluate(
    (attribute) =>
      document.querySelector(`[data-sat-student-frame][${attribute}="same-node"]`) !== null,
    EXAM_FRAME_MARKER
  );
  expect(survived, "the module handoff must not remount the exam frame").toBe(true);
}

/**
 * Exactly one student stage is active. A stage may still be fading out, but a
 * departing one is inert and hidden from assistive tech — so the student is
 * never shown (or read) two surfaces at once.
 */
async function assertSingleSatStage(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.locator("[data-sat-stage]:not([data-sat-stage-exiting])")).toHaveCount(1);
  const exiting = page.locator("[data-sat-stage-exiting]");
  if ((await exiting.count()) > 0) {
    await expect(exiting.first()).toHaveAttribute("aria-hidden", "true");
    await expect(exiting.first()).toHaveAttribute("inert");
  }
}

async function assertNoHorizontalOverflow(
  page: import("@playwright/test").Page,
  viewports: Array<{ width: number; height: number }>
): Promise<void> {
  const originalViewport = page.viewportSize();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasOverflow, `horizontal overflow at ${viewport.width}×${viewport.height}`).toBe(false);
  }
  if (originalViewport) await page.setViewportSize(originalViewport);
}

async function readSectionModules(
  page: import("@playwright/test").Page,
  scheduleId: string,
  candidateId: string,
  sectionKey: "reading-writing" | "math"
): Promise<Array<{ adaptiveRole: string; state: string | null }>> {
  return page.evaluate(
    async ({ scheduleId: id, candidateId: studentId, sectionKey: requestedSection }) => {
      const liveResponse = await fetch(
        `/api/v1/student/sessions/${id}/live?candidateId=${encodeURIComponent(studentId)}`
      );
      const livePayload = await liveResponse.json();
      const attemptId = livePayload?.data?.attempt?.id ?? livePayload?.attempt?.id;
      if (typeof attemptId !== "string") {
        throw new Error("SAT student attempt was unavailable during the transition.");
      }

      const delivery = await import("/src/features/student-delivery/api/assessmentDeliveryApi.ts");
      delivery.configureAssessmentDeliveryAttempt(id, attemptId, studentId);
      const snapshot = await delivery.assessmentDeliveryApi.bootstrap(id, attemptId);
      const section = snapshot.sections.find((item) => item.sectionKey === requestedSection);
      if (!section) throw new Error(`${requestedSection} was missing from the SAT bootstrap.`);
      return section.modules.map((module) => ({
        adaptiveRole: module.adaptiveRole,
        state:
          snapshot.attempt.moduleAttempts.find((attempt) => attempt.moduleId === module.id)
            ?.state ?? null,
      }));
    },
    { scheduleId, candidateId, sectionKey }
  );
}

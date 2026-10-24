import { expect, test } from "@playwright/test";
import { regressesAttemptState } from "../src/features/student-delivery/application/satBootstrapEquality";
import type {
  AssessmentDeliveryBootstrap,
  SATRecoveryResolutionReceipt,
  SATRecoveryResolutionRequest,
} from "../src/features/student-delivery/contracts/assessmentDelivery";
import { ADMIN_STORAGE_STATE_PATH } from "./support/backendE2e";
import { executeTransaction, executeUpdate, queryDb } from "./support/db";
import { createRunningSatSession } from "./support/satStudentSession";
import {
  hasCompleteDeadlineTransitionCoverage,
  hasMeasuredDeadlineTransition,
  satAnswerUntilComplete,
  satCaptureAnswerableFrames,
  satReadAnswerableFrames,
} from "./prod-load/sat-live-scenario";

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

test.describe("SAT student transitions", () => {
  test.describe.configure({ timeout: 240_000 });

  test("answerable-frame probe waits for a usable SAT answer control", async ({ page }) => {
    let deadlineFrameSignals = 0;
    await page.route("http://sat-frame.test/probe", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<main data-testid="sat-exam-shell">
        <input type="text" aria-label="Notes">
        <fieldset disabled>
          <label id="choice-row" for="choice" style="display:none">
            <input id="choice" type="radio" data-testid="sat-answer-control">
            <span>Option A</span>
          </label>
        </fieldset>
      </main>`,
      })
    );
    await satCaptureAnswerableFrames(page, () => {
      deadlineFrameSignals += 1;
    });
    await page.goto("http://sat-frame.test/probe");
    await page.evaluate(() => {
      const now = Date.now();
      window.dispatchEvent(
        new CustomEvent("student-observability-metric", {
          detail: {
            name: "sat_first_answerable_frame_at",
            moduleId: "module-2",
            authorizedAt: now - 1_000,
            transitionDeadlineAt: now - 1_500,
          },
        })
      );
    });

    await expect.poll(async () => (await satReadAnswerableFrames(page)).length).toBe(0);
    await page.locator("fieldset").evaluate((element) => {
      (element as HTMLFieldSetElement).disabled = false;
    });
    await page.locator("#choice-row").evaluate((element) => {
      (element as HTMLLabelElement).style.display = "block";
    });
    await expect.poll(async () => (await satReadAnswerableFrames(page)).length).toBe(1);
    await expect.poll(() => deadlineFrameSignals).toBe(1);
    const [frame] = await satReadAnswerableFrames(page);
    expect(frame).toMatchObject({ moduleId: "module-2" });
    expect(frame?.latencyMs).toBeGreaterThanOrEqual(1_000);
    expect(frame?.deadlineToAnswerableMs).toBeGreaterThanOrEqual(1_500);
    expect(frame?.observedAtMs).toEqual(expect.any(Number));
    expect(Date.now() - (frame?.observedAtMs ?? 0)).toBeLessThan(10_000);
  });

  test("initial answerable frame does not satisfy the timed-transition stop signal", async ({ page }) => {
    let timedTransitionObserved = false;
    await page.route("http://sat-frame.test/initial", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<main data-testid="sat-exam-shell">
          <label><input type="radio" data-testid="sat-answer-control"><span>Option A</span></label>
        </main>`,
      })
    );
    await satCaptureAnswerableFrames(page, () => {
      timedTransitionObserved = true;
    });
    await page.goto("http://sat-frame.test/initial");
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent("student-observability-metric", {
        detail: {
          name: "sat_first_answerable_frame_at",
          moduleId: "module-1",
          authorizedAt: Date.now() - 1_000,
        },
      }));
    });

    await expect.poll(async () => (await satReadAnswerableFrames(page)).length).toBe(1);
    expect(timedTransitionObserved).toBe(false);
    expect((await satReadAnswerableFrames(page))[0]?.deadlineToAnswerableMs).toBeUndefined();
  });

  test("transition rehearsal stops answering after the first timed answerable frame", async ({ page }) => {
    let timedTransitionObserved = false;
    await page.route("http://sat-frame.test/early-exit", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<main data-testid="sat-exam-shell">
          <input type="text" aria-label="Notes" data-testid="sat-answer-control">
        </main>`,
      })
    );
    await satCaptureAnswerableFrames(page, () => {
      timedTransitionObserved = true;
    });
    await page.goto("http://sat-frame.test/early-exit");

    const answering = satAnswerUntilComplete(
      page,
      { userId: "sat-frame-probe", email: "probe@example.test", password: "unused" },
      {
        origin: "http://sat-frame.test",
        accessLinkId: "unused",
        examTimeoutMs: 60_000,
        startPollIntervalMs: 10,
        startTimeoutMs: 1_000,
      },
      undefined,
      undefined,
      () => timedTransitionObserved,
    );
    await page.evaluate(() => {
      const now = Date.now();
      window.dispatchEvent(new CustomEvent("student-observability-metric", {
        detail: {
          name: "sat_first_answerable_frame_at",
          moduleId: "module-2",
          authorizedAt: now - 1_000,
          transitionDeadlineAt: now - 1_500,
        },
      }));
    });

    await expect.poll(() => timedTransitionObserved).toBe(true);
    await expect(answering).resolves.toMatchObject({ answered: 0, stoppedEarly: true });
  });

  test("keeps a disconnected final answer frozen, then routes an expired module entry to recovery", async ({
    page,
    browser,
  }) => {
    const { studentContext, studentPage, scheduleId, candidateId } = await createRunningSatSession(
      browser,
      page,
      {
        label: "boundary-recovery",
        startRuntime: false,
        deliveryPolicy: {
          version: "sat_recovery_v1",
          recoverySeconds: 120,
          entryRecoverySeconds: 120,
          lateAnswerPolicy: "frozen_arrival_window",
        },
      }
    );
    try {
      await page.getByRole("button", { name: "Review and start exam" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Start exam" }).click();
      await expect(page.getByText("Exam started.")).toBeVisible({ timeout: 20_000 });
      await satCaptureAnswerableFrames(studentPage);
      await studentPage.reload({ waitUntil: "domcontentloaded" });
      await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });

      const moduleAttempts = await queryDb<{ id: string; attempt_id: string }>(
        `SELECT ma.id, ma.attempt_id FROM assessment_module_attempts ma
         JOIN student_attempts a ON a.id = ma.attempt_id
         JOIN assessment_modules m ON m.id = ma.module_id
         JOIN assessment_sections s ON s.id = m.section_id
         WHERE a.schedule_id = ? AND a.candidate_id = ? AND s.section_key = 'reading-writing'
           AND m.adaptive_role = 'base' AND ma.state = 'active'`,
        [scheduleId, candidateId]
      );
      expect(moduleAttempts).toHaveLength(1);
      const active = moduleAttempts[0]!;
      const questions = await queryDb<{ id: string }>(
        `SELECT eq.id FROM assessment_exam_questions eq
         JOIN assessment_module_attempts ma ON ma.module_id = eq.module_id
         WHERE ma.id = ? ORDER BY eq.display_order LIMIT 1`,
        [active.id]
      );
      expect(questions).toHaveLength(1);
      const answerOptions = studentPage.locator(`input[name="sat-answer-${questions[0]!.id}"]`);
      const answerControl = answerOptions.nth(1);
      await expect(answerControl).toHaveAttribute("data-testid", "sat-answer-control");
      await expect(answerControl).toBeEnabled();
      await expect(answerControl.locator("xpath=ancestor::label[1]")).toBeVisible();
      await answerControl.press("Space");
      await expect
        .poll(
          async () =>
            (
              await queryDb<{ n: number }>(
                "SELECT COUNT(*) AS n FROM attempt_responses_v2 WHERE attempt_id = ? AND question_id = ?",
                [active.attempt_id, questions[0]!.id]
              )
            )[0]!.n,
          { timeout: 20_000 }
        )
        .toBe(1);

      const offlineChoice = await answerOptions.nth(1).getAttribute("value");
      expect(offlineChoice).toBeTruthy();
      await studentPage.route("**/api/v1/assessment-delivery/**", (route) => route.abort());
      await answerOptions.nth(2).press("Space");
      const frozenChoice = await answerOptions.nth(2).getAttribute("value");
      expect(frozenChoice).toBeTruthy();

      await executeTransaction(async (connection) => {
        // Match the timeout worker's attempt -> module -> boundary lock order.
        await connection.execute("SELECT id FROM student_attempts WHERE id = ? FOR UPDATE", [
          active.attempt_id,
        ]);
        await connection.execute(
          "SELECT id FROM assessment_module_attempts WHERE id = ? FOR UPDATE",
          [active.id]
        );
        await connection.execute(
          "SELECT module_attempt_id FROM assessment_module_boundaries WHERE module_attempt_id = ? FOR UPDATE",
          [active.id]
        );
        await connection.execute(
          "UPDATE assessment_module_attempts SET started_at = TIMESTAMPADD(SECOND, -allocated_seconds, NOW(6)) WHERE id = ?",
          [active.id]
        );
        await connection.execute(
          `UPDATE assessment_module_boundaries
           SET work_deadline_at = NOW(6),
               recovery_deadline_at = TIMESTAMPADD(SECOND, 120, NOW(6)),
               next_action_at = NOW(6),
               revision = revision + 1
           WHERE module_attempt_id = ?`,
          [active.id]
        );
      });
      await expect
        .poll(
          async () =>
            (
              await queryDb<{ phase: string }>(
                "SELECT b.phase FROM assessment_module_boundaries b WHERE b.module_attempt_id = ?",
                [active.id]
              )
            )[0]?.phase ?? null,
          { timeout: 20_000, intervals: [250, 500, 1_000] }
        )
        .toBe("collecting");
      const nextBeforeRecovery = await queryDb<{ state: string; started_at: string | null }>(
        `SELECT ma.state, ma.started_at FROM assessment_module_attempts ma
         JOIN assessment_modules m ON m.id = ma.module_id
         JOIN assessment_sections s ON s.id = m.section_id
         WHERE ma.attempt_id = ? AND s.section_key = 'reading-writing'
           AND m.adaptive_role <> 'base'`,
        [active.attempt_id]
      );
      // The adaptive route is not selected until the frozen M1 answers settle;
      // before recovery, there must be no active follow-up module or clock.
      expect(
        nextBeforeRecovery.every((item) => item.state === "not_started" && item.started_at === null)
      ).toBe(true);

      await studentPage.unroute("**/api/v1/assessment-delivery/**");
      await studentPage.reload({ waitUntil: "domcontentloaded" });

      await expect
        .poll(
          async () =>
            (
              await queryDb<{ phase: string }>(
                "SELECT b.phase FROM assessment_module_boundaries b WHERE b.module_attempt_id = ?",
                [active.id]
              )
            )[0]?.phase ?? null,
          { timeout: 45_000, intervals: [250, 500, 1_000, 2_000] }
        )
        .toBe("settled");
      const savedResponse = await queryDb<{ response: string | null }>(
        "SELECT CAST(response AS CHAR) AS response FROM attempt_responses_v2 WHERE attempt_id = ? AND question_id = ?",
        [active.attempt_id, questions[0]!.id]
      );
      expect(savedResponse).toHaveLength(1);
      expect(JSON.stringify(savedResponse[0]!.response)).toContain(frozenChoice!);

      const nextAfterSettlement = await queryDb<{
        id: string;
        state: string;
        started_at: string | null;
      }>(
        `SELECT ma.id, ma.state, ma.started_at FROM assessment_module_attempts ma
         JOIN assessment_modules m ON m.id = ma.module_id
         JOIN assessment_sections s ON s.id = m.section_id
         WHERE ma.attempt_id = ? AND s.section_key = 'reading-writing'
           AND m.adaptive_role <> 'base'`,
        [active.attempt_id]
      );
      expect(nextAfterSettlement).toHaveLength(1);
      expect(nextAfterSettlement[0]).toMatchObject({ state: "not_started", started_at: null });

      await expect(studentPage.getByRole("button", { name: /Begin module/i })).toBeVisible();
      const entryBoundary = await queryDb<{ phase: string; entry_deadline_at: string | null }>(
        "SELECT phase, entry_deadline_at FROM assessment_module_boundaries WHERE module_attempt_id = ?",
        [nextAfterSettlement[0]!.id]
      );
      expect(entryBoundary).toHaveLength(1);
      expect(entryBoundary[0]!.phase).toBe("preparing");
      const startRoute = `**/api/v1/assessment-delivery/schedules/${scheduleId}/modules/start`;
      let startRequests = 0;
      await studentPage.route(startRoute, async (route) => {
        startRequests += 1;
        const changed = await executeUpdate(
          `UPDATE assessment_module_boundaries
           SET entry_deadline_at = TIMESTAMPADD(SECOND, -1, NOW(6)), revision = revision + 1
           WHERE module_attempt_id = ? AND phase = 'preparing'`,
          [nextAfterSettlement[0]!.id]
        );
        expect(changed).toBe(1);
        await route.continue();
      });
      await studentPage.getByRole("button", { name: /Begin module/i }).click();
      await expect(
        studentPage.getByRole("heading", { name: /module entry recovery ended/i })
      ).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(
          async () =>
            (
              await queryDb<{ state: string; started_at: string | null }>(
                "SELECT state, started_at FROM assessment_module_attempts WHERE id = ?",
                [nextAfterSettlement[0]!.id]
              )
            )[0],
          { timeout: 30_000 }
        )
        .toMatchObject({ state: "not_started", started_at: null });
      expect(startRequests).toBe(1);
      await expect
        .poll(
          async () =>
            (
              await queryDb<{ phase: string }>(
                "SELECT phase FROM assessment_module_boundaries WHERE module_attempt_id = ?",
                [nextAfterSettlement[0]!.id]
              )
            )[0]?.phase ?? null,
          { timeout: 20_000 }
        )
        .toBe("blocked");
      await studentPage.unroute(startRoute);
    } finally {
      await studentContext.setOffline(false);
      await studentContext.close();
    }
  });

  test("practice recovery expiry requires confirmation and continues only with server-confirmed answers", async ({
    page,
    browser,
  }) => {
    const { studentContext, studentPage, scheduleId, candidateId } = await createRunningSatSession(
      browser,
      page,
      {
        label: "practice-recovery-expiry",
        startRuntime: false,
        deliveryPolicy: {
          version: "sat_recovery_v1",
          recoverySeconds: 120,
          entryRecoverySeconds: 120,
          lateAnswerPolicy: "frozen_arrival_window",
        },
      }
    );
    try {
      await executeUpdate("UPDATE exam_schedules SET sat_session_mode = 'practice' WHERE id = ?", [
        scheduleId,
      ]);
      await page.getByRole("button", { name: "Review and start exam" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Start exam" }).click();
      await expect(page.getByText("Exam started.")).toBeVisible({ timeout: 20_000 });
      // Install before the student controller mounts so its lifecycle timer
      // is controlled by Playwright's clock.
      await studentPage.clock.install();
      await satCaptureAnswerableFrames(studentPage);
      await studentPage.addInitScript(() => {
        Math.random = () => 0;
      });
      await studentPage.routeWebSocket("**/api/v1/ws/live*", (socket) => {
        void socket.close();
      });
      await studentPage.bringToFront();
      await studentPage.reload({ waitUntil: "domcontentloaded" });
      await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });

      const activeRows = await queryDb<{ id: string; attempt_id: string }>(
        `SELECT ma.id, ma.attempt_id FROM assessment_module_attempts ma
         JOIN student_attempts a ON a.id = ma.attempt_id
         JOIN assessment_modules m ON m.id = ma.module_id
         JOIN assessment_sections s ON s.id = m.section_id
         WHERE a.schedule_id = ? AND a.candidate_id = ? AND s.section_key = 'reading-writing'
           AND m.adaptive_role = 'base' AND ma.state = 'active'`,
        [scheduleId, candidateId]
      );
      expect(activeRows).toHaveLength(1);
      const active = activeRows[0]!;
      const questions = await queryDb<{ id: string }>(
        `SELECT eq.id FROM assessment_exam_questions eq
         JOIN assessment_module_attempts ma ON ma.module_id = eq.module_id
         WHERE ma.id = ? ORDER BY eq.display_order LIMIT 2`,
        [active.id]
      );
      expect(questions).toHaveLength(2);
      const answer = studentPage.locator(`input[name="sat-answer-${questions[0]!.id}"]`).nth(1);
      await expect(answer).toBeVisible();
      await answer.press("Space");
      await expect
        .poll(
          async () =>
            (
              await queryDb<{ n: number }>(
                "SELECT COUNT(*) AS n FROM attempt_responses_v2 WHERE attempt_id = ? AND question_id = ?",
                [active.attempt_id, questions[0]!.id]
              )
            )[0]!.n,
          { timeout: 20_000 }
        )
        .toBe(1);

      // Keep a later local draft whose save never reaches the server. The
      // explicit exception must score only the canonical row above.
      const failedSaveRoute = `**/api/v1/assessment-delivery/schedules/${scheduleId}/responses/**`;
      let failedSaveRequests = 0;
      const abortUnconfirmedSave = (route: import("@playwright/test").Route) => {
        failedSaveRequests += 1;
        return route.abort();
      };
      await studentPage.route(failedSaveRoute, abortUnconfirmedSave);
      await studentPage.route("**/responses:batch", abortUnconfirmedSave);
      await studentPage.getByRole("button", { name: "Next question" }).click();
      const unconfirmedAnswer = studentPage
        .locator(`input[name="sat-answer-${questions[1]!.id}"]`)
        .nth(1);
      await expect(unconfirmedAnswer).toBeVisible();
      await unconfirmedAnswer.press("Space");
      await expect.poll(() => failedSaveRequests, { timeout: 3_000 }).toBeGreaterThan(0);
      await expect
        .poll(
          async () =>
            (
              await queryDb<{ n: number }>(
                "SELECT COUNT(*) AS n FROM attempt_responses_v2 WHERE attempt_id = ? AND question_id = ?",
                [active.attempt_id, questions[1]!.id]
              )
            )[0]!.n,
          { timeout: 3_000 }
        )
        .toBe(0);

      await executeTransaction(async (connection) => {
        // Match the reconciler's attempt -> module -> boundary lock order so
        // the test's deadline setup cannot deadlock its one-second worker.
        await connection.execute("SELECT id FROM student_attempts WHERE id = ? FOR UPDATE", [
          active.attempt_id,
        ]);
        await connection.execute(
          "SELECT id FROM assessment_module_attempts WHERE id = ? FOR UPDATE",
          [active.id]
        );
        await connection.execute(
          "SELECT module_attempt_id FROM assessment_module_boundaries WHERE module_attempt_id = ? FOR UPDATE",
          [active.id]
        );
        await connection.execute(
          "UPDATE assessment_module_attempts SET started_at = TIMESTAMPADD(SECOND, -allocated_seconds - 121, NOW(6)) WHERE id = ?",
          [active.id]
        );
        await connection.execute(
          `UPDATE assessment_module_boundaries
           SET phase = 'collecting',
               work_deadline_at = TIMESTAMPADD(SECOND, -121, NOW(6)),
               recovery_deadline_at = TIMESTAMPADD(SECOND, -1, NOW(6)),
               next_action_at = NOW(6),
               revision = revision + 1
           WHERE module_attempt_id = ?`,
          [active.id]
        );
      });
      await studentPage.reload({ waitUntil: "domcontentloaded" });
      await expect
        .poll(
          async () =>
            (
              await queryDb<{ phase: string }>(
                "SELECT phase FROM assessment_module_boundaries WHERE module_attempt_id = ?",
                [active.id]
              )
            )[0]?.phase ?? null,
          { timeout: 30_000, intervals: [250, 500, 1_000] }
        )
        .toBe("blocked");

      await expect(
        studentPage.getByRole("heading", { name: /connection recovery ended/i })
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        studentPage.getByRole("heading", { name: /connection recovery ended/i })
      ).toBeFocused();

      // Exercise the reachable-HTTP cadence after dropping the socket. Its
      // shorter poll interval lets the refresh overlap without advancing past
      // the API request timeout.
      const statePattern = `**/api/v1/assessment-delivery/schedules/${scheduleId}/state`;
      let stateRequests = 0;
      let inFlightStateRequests = 0;
      let peakInFlightStateRequests = 0;
      let deliveryReadStarts = 0;
      let peakInFlightDeliveryReads = 0;
      const deliveryReadPaths: string[] = [];
      const inFlightDeliveryReads = new Set<import("@playwright/test").Request>();
      const isDeliveryRead = (request: import("@playwright/test").Request) => {
        const path = new URL(request.url()).pathname;
        return path.endsWith("/state") || path.endsWith("/bootstrap");
      };
      studentPage.on("request", (request) => {
        if (!isDeliveryRead(request)) return;
        deliveryReadStarts += 1;
        deliveryReadPaths.push(new URL(request.url()).pathname);
        inFlightDeliveryReads.add(request);
        peakInFlightDeliveryReads = Math.max(peakInFlightDeliveryReads, inFlightDeliveryReads.size);
      });
      const finishDeliveryRead = (request: import("@playwright/test").Request) => {
        inFlightDeliveryReads.delete(request);
      };
      studentPage.on("requestfinished", finishDeliveryRead);
      studentPage.on("requestfailed", finishDeliveryRead);
      const readsBeforeRetry = deliveryReadStarts;
      let releaseFirstStateRequest!: () => void;
      let firstStateRequestStarted!: () => void;
      const releaseFirst = new Promise<void>((resolve) => {
        releaseFirstStateRequest = resolve;
      });
      const firstStarted = new Promise<void>((resolve) => {
        firstStateRequestStarted = resolve;
      });
      await studentPage.route(statePattern, async (route) => {
        stateRequests += 1;
        inFlightStateRequests += 1;
        peakInFlightStateRequests = Math.max(peakInFlightStateRequests, inFlightStateRequests);
        try {
          if (stateRequests === 1) {
            firstStateRequestStarted();
            await releaseFirst;
          }
          await route.continue();
        } finally {
          inFlightStateRequests -= 1;
        }
      });
      await studentPage.evaluate(() => {
        const target = window as Window & { __satRefreshCoalesced?: number };
        target.__satRefreshCoalesced = 0;
        window.addEventListener("student-observability-metric", (event: Event) => {
          const detail = (event as CustomEvent<{ name?: string }>).detail;
          if (detail?.name === "sat_lifecycle_refresh_coalesced") {
            target.__satRefreshCoalesced = (target.__satRefreshCoalesced ?? 0) + 1;
          }
        });
      });
      await studentPage.getByRole("button", { name: "Try reconnecting" }).click();
      await firstStarted;
      const retryButton = studentPage.getByRole("button", { name: /checking connection/i });
      await expect(retryButton).toBeFocused();
      // Fire the real lifecycle timer deterministically while the explicit
      // recovery read remains held. The dropped socket selects the 10–20
      // second HTTP fallback, below the request's 30-second timeout.
      await studentPage.clock.fastForward("00:15");
      await expect
        .poll(
          () =>
            studentPage.evaluate(
              () =>
                (window as Window & { __satRefreshCoalesced?: number }).__satRefreshCoalesced ?? 0
            ),
          { timeout: 5_000, intervals: [100, 250, 500] }
        )
        .toBeGreaterThan(0);
      await expect(retryButton).toBeFocused();
      expect(peakInFlightStateRequests).toBe(1);
      expect(stateRequests).toBe(1);
      expect(
        deliveryReadStarts - readsBeforeRetry,
        `Unexpected lifecycle reads while the first state request is held: ${JSON.stringify(deliveryReadPaths.slice(readsBeforeRetry))}`
      ).toBe(1);
      releaseFirstStateRequest();
      await expect
        .poll(() => deliveryReadStarts, { timeout: 10_000 })
        .toBeGreaterThan(readsBeforeRetry + 1);
      await expect.poll(() => inFlightDeliveryReads.size, { timeout: 10_000 }).toBe(0);
      expect(peakInFlightDeliveryReads).toBe(1);
      await studentPage.unroute(statePattern);

      await expect(
        studentPage.getByText(/some answers are not confirmed by the exam/i)
      ).toBeVisible({ timeout: 30_000 });

      const resolutionRoute = `**/api/v1/assessment-delivery/schedules/${scheduleId}/modules/recovery/resolve`;
      let resolutionRequests = 0;
      let completedResolutionRequests = 0;
      let firstRequest: SATRecoveryResolutionRequest | null = null;
      let firstReceipt: SATRecoveryResolutionReceipt | null = null;
      let replayReceipt: SATRecoveryResolutionReceipt | null = null;
      const loseFirstResolutionResponse = async (route: import("@playwright/test").Route) => {
        resolutionRequests += 1;
        const response = await route.fetch();
        const body = (await response.json()) as SATRecoveryResolutionReceipt;
        if (resolutionRequests === 1) {
          expect(response.status()).toBe(200);
          firstRequest = route.request().postDataJSON() as SATRecoveryResolutionRequest;
          firstReceipt = body;
          await route.abort();
          return;
        }
        replayReceipt = body;
        completedResolutionRequests += 1;
        await route.fulfill({ response, body: JSON.stringify(body) });
      };
      await studentPage.route(resolutionRoute, loseFirstResolutionResponse);
      await studentPage
        .getByRole("button", { name: /continue with server-confirmed answers/i })
        .click();
      const confirmation = studentPage.getByRole("alertdialog", {
        name: /continue with confirmed answers/i,
      });
      await expect(
        confirmation.getByText(/unconfirmed answers will not be included/i)
      ).toBeVisible();
      await confirmation
        .getByRole("button", { name: /continue with server-confirmed answers/i })
        .click();
      await expect
        .poll(
          async () =>
            (
              await queryDb<{ phase: string; resolution: string | null }>(
                "SELECT phase, resolution FROM assessment_module_boundaries WHERE module_attempt_id = ?",
                [active.id]
              )
            )[0],
          { timeout: 30_000 }
        )
        .toMatchObject({ phase: "settled", resolution: "continue_confirmed" });
      await expect(
        studentPage.getByRole("heading", { name: /connection recovery ended/i })
      ).toHaveCount(0, {
        timeout: 30_000,
      });
      const replayed = await replaySatRecoveryResolution(
        studentPage,
        scheduleId,
        active.attempt_id,
        candidateId,
        firstRequest!
      );
      expect(replayed).toMatchObject({ replayed: true, receiptId: firstReceipt?.receiptId });
      await expect.poll(() => completedResolutionRequests, { timeout: 10_000 }).toBe(1);
      expect(resolutionRequests).toBe(2);
      expect(replayReceipt).toMatchObject({ replayed: true, receiptId: firstReceipt?.receiptId });
      await studentPage.unroute(resolutionRoute, loseFirstResolutionResponse);

      await expect
        .poll(
          async () =>
            (
              await queryDb<{
                phase: string;
                resolution: string | null;
                resolved_by: string | null;
              }>(
                "SELECT phase, resolution, resolved_by FROM assessment_module_boundaries WHERE module_attempt_id = ?",
                [active.id]
              )
            )[0],
          { timeout: 30_000 }
        )
        .toMatchObject({ phase: "settled", resolution: "continue_confirmed" });
      const module = await queryDb<{ state: string }>(
        "SELECT state FROM assessment_module_attempts WHERE id = ?",
        [active.id]
      );
      expect(module[0]?.state).toBe("locked");
      const unconfirmedRows = await queryDb<{ n: number }>(
        "SELECT COUNT(*) AS n FROM attempt_responses_v2 WHERE attempt_id = ? AND question_id = ?",
        [active.attempt_id, questions[1]!.id]
      );
      expect(unconfirmedRows[0]?.n).toBe(0);
      const nextModule = await queryDb<{ id: string; state: string; started_at: string | null }>(
        `SELECT ma.id, ma.state, ma.started_at FROM assessment_module_attempts ma
         JOIN assessment_modules m ON m.id = ma.module_id
         JOIN assessment_sections s ON s.id = m.section_id
         WHERE ma.attempt_id = ? AND s.section_key = 'reading-writing' AND m.adaptive_role <> 'base'`,
        [active.attempt_id]
      );
      expect(nextModule).toHaveLength(1);
      expect(nextModule[0]).toMatchObject({ state: "not_started", started_at: null });
      await expect(studentPage.getByRole("button", { name: /begin module/i })).toBeVisible();
      await expect(studentPage.getByRole("heading", { name: /is ready/i })).toBeFocused();
      await studentPage.getByRole("button", { name: /begin module/i }).click();
      await expect
        .poll(
          async () =>
            (
              await queryDb<{ state: string }>(
                "SELECT state FROM assessment_module_attempts WHERE id = ?",
                [nextModule[0]!.id]
              )
            )[0]?.state ?? null,
          { timeout: 30_000 }
        )
        .toBe("active");
      await expect(studentPage.getByRole("heading", { name: "Question 1" })).toBeFocused();
      await expect
        .poll(async () => hasMeasuredDeadlineTransition(await satReadAnswerableFrames(studentPage)))
        .toBe(true);
      const timedFrames = await satReadAnswerableFrames(studentPage);
      expect(hasCompleteDeadlineTransitionCoverage([{ answerableFrames: timedFrames }], 1)).toBe(true);
      expect(hasCompleteDeadlineTransitionCoverage([{ answerableFrames: timedFrames }], 2_000)).toBe(false);
    } finally {
      await studentPage.unrouteAll({ behavior: "ignoreErrors" });
      await studentContext.setOffline(false);
      await studentContext.close();
    }
  });

  test("practice entry expiry requires explicit one-time activation", async ({ page, browser }) => {
    const { studentContext, studentPage, scheduleId, candidateId } = await createRunningSatSession(
      browser,
      page,
      {
        label: "practice-entry-expiry",
        startRuntime: false,
        deliveryPolicy: {
          version: "sat_recovery_v1",
          recoverySeconds: 120,
          entryRecoverySeconds: 120,
          lateAnswerPolicy: "frozen_arrival_window",
        },
      }
    );
    try {
      await executeUpdate("UPDATE exam_schedules SET sat_session_mode = 'practice' WHERE id = ?", [
        scheduleId,
      ]);
      await page.getByRole("button", { name: "Review and start exam" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Start exam" }).click();
      await expect(page.getByText("Exam started.")).toBeVisible({ timeout: 20_000 });
      await studentPage.reload({ waitUntil: "domcontentloaded" });
      await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });

      const active = (
        await queryDb<{ id: string; attempt_id: string }>(
          `SELECT ma.id, ma.attempt_id FROM assessment_module_attempts ma
         JOIN student_attempts a ON a.id = ma.attempt_id
         JOIN assessment_modules m ON m.id = ma.module_id
         JOIN assessment_sections s ON s.id = m.section_id
         WHERE a.schedule_id = ? AND a.candidate_id = ? AND s.section_key = 'reading-writing'
           AND m.adaptive_role = 'base' AND ma.state = 'active'`,
          [scheduleId, candidateId]
        )
      )[0];
      expect(active).toBeTruthy();
      await executeUpdate(
        `UPDATE assessment_module_attempts ma
         JOIN assessment_module_boundaries b ON b.module_attempt_id = ma.id
         SET ma.state = 'not_started', ma.started_at = NULL, ma.paused_at = NULL,
             b.phase = 'blocked', b.work_deadline_at = NULL,
             b.entry_deadline_at = TIMESTAMPADD(SECOND, -1, NOW(6)),
             b.recovery_deadline_at = NULL, b.next_action_at = NULL, b.revision = b.revision + 1
         WHERE ma.id = ?`,
        [active!.id]
      );
      await studentPage.reload({ waitUntil: "domcontentloaded" });
      await expect(
        studentPage.getByRole("heading", { name: /module entry recovery ended/i })
      ).toBeVisible();
      const unopened = (
        await queryDb<{ state: string; started_at: string | null }>(
          "SELECT state, started_at FROM assessment_module_attempts WHERE id = ?",
          [active!.id]
        )
      )[0];
      expect(unopened).toEqual({ state: "not_started", started_at: null });

      const resolutionRoute = `**/api/v1/assessment-delivery/schedules/${scheduleId}/modules/recovery/resolve`;
      let requests = 0;
      let completedRetry = 0;
      let firstRequest: SATRecoveryResolutionRequest | null = null;
      let firstReceipt: SATRecoveryResolutionReceipt | null = null;
      let replayReceipt: SATRecoveryResolutionReceipt | null = null;
      const loseFirstResponse = async (route: import("@playwright/test").Route) => {
        requests += 1;
        const response = await route.fetch();
        const body = (await response.json()) as SATRecoveryResolutionReceipt;
        if (requests === 1) {
          firstRequest = route.request().postDataJSON() as SATRecoveryResolutionRequest;
          firstReceipt = body;
          await route.abort();
          return;
        }
        replayReceipt = body;
        completedRetry += 1;
        await route.fulfill({ response, body: JSON.stringify(body) });
      };
      await studentPage.route(resolutionRoute, loseFirstResponse);
      await studentPage.getByRole("button", { name: "Start this module" }).click();
      const confirmation = studentPage.getByRole("alertdialog", { name: /start this module now/i });
      await expect(
        confirmation.getByText(/your module timer begins when you confirm/i)
      ).toBeVisible();
      await confirmation.getByRole("button", { name: "Start this module" }).click();
      await expect
        .poll(
          async () =>
            (
              await queryDb<{ state: string; started_at: string | null }>(
                "SELECT state, started_at FROM assessment_module_attempts WHERE id = ?",
                [active!.id]
              )
            )[0],
          { timeout: 30_000 }
        )
        .toMatchObject({ state: "active" });
      expect(firstRequest).toMatchObject({
        resolutionId: expect.any(String),
        moduleAttemptId: active!.id,
        expectedBoundaryRevision: expect.any(Number),
        action: "activate_entry",
      });
      expect(firstRequest?.expectedBoundaryRevision).toBeGreaterThan(0);
      const replayed = await replaySatRecoveryResolution(
        studentPage,
        scheduleId,
        active!.attempt_id,
        candidateId,
        firstRequest!
      );
      expect(replayed).toMatchObject({
        action: "activate_entry",
        replayed: true,
        receiptId: firstReceipt?.receiptId,
      });
      await expect.poll(() => completedRetry, { timeout: 10_000 }).toBe(1);
      expect(requests).toBe(2);
      expect(replayReceipt).toMatchObject({
        action: "activate_entry",
        replayed: true,
        receiptId: firstReceipt?.receiptId,
      });
      await studentPage.unroute(resolutionRoute, loseFirstResponse);

      await expect
        .poll(
          async () =>
            (
              await queryDb<{
                phase: string;
                entry_deadline_at: string | null;
                resolution_count: number;
              }>(
                `SELECT b.phase, b.entry_deadline_at,
             (SELECT COUNT(*) FROM assessment_module_boundary_resolutions r WHERE r.module_attempt_id = b.module_attempt_id) AS resolution_count
           FROM assessment_module_boundaries b WHERE b.module_attempt_id = ?`,
                [active!.id]
              )
            )[0],
          { timeout: 20_000 }
        )
        .toMatchObject({ phase: "working", entry_deadline_at: null, resolution_count: 1 });
    } finally {
      await studentPage.unrouteAll({ behavior: "ignoreErrors" });
      await studentContext.setOffline(false);
      await studentContext.close();
    }
  });

  test("classroom recovery is resolved from the staff room with a required reason", async ({
    page,
    browser,
  }) => {
    const { studentContext, studentPage, scheduleId, candidateId, studentName } =
      await createRunningSatSession(browser, page, {
        label: "classroom-recovery-expiry",
        startRuntime: false,
        deliveryPolicy: {
          version: "sat_recovery_v1",
          recoverySeconds: 120,
          entryRecoverySeconds: 120,
          lateAnswerPolicy: "frozen_arrival_window",
        },
      });
    try {
      await executeUpdate("UPDATE exam_schedules SET sat_session_mode = 'classroom' WHERE id = ?", [
        scheduleId,
      ]);
      await page.getByRole("button", { name: "Review and start exam" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Start exam" }).click();
      await expect(page.getByText("Exam started.")).toBeVisible({ timeout: 20_000 });
      await studentPage.reload({ waitUntil: "domcontentloaded" });
      await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });

      const active = (
        await queryDb<{ id: string; attempt_id: string }>(
          `SELECT ma.id, ma.attempt_id FROM assessment_module_attempts ma
         JOIN student_attempts a ON a.id = ma.attempt_id
         JOIN assessment_modules m ON m.id = ma.module_id
         JOIN assessment_sections s ON s.id = m.section_id
         WHERE a.schedule_id = ? AND a.candidate_id = ? AND s.section_key = 'reading-writing'
           AND m.adaptive_role = 'base' AND ma.state = 'active'`,
          [scheduleId, candidateId]
        )
      )[0];
      expect(active).toBeTruthy();
      await executeUpdate(
        `UPDATE assessment_module_attempts ma
         JOIN assessment_module_boundaries b ON b.module_attempt_id = ma.id
         SET ma.started_at = TIMESTAMPADD(SECOND, -ma.allocated_seconds - 121, NOW(6)),
             b.phase = 'blocked',
             b.work_deadline_at = TIMESTAMPADD(SECOND, -121, NOW(6)),
             b.recovery_deadline_at = TIMESTAMPADD(SECOND, -1, NOW(6)),
             b.next_action_at = NULL, b.revision = b.revision + 1
         WHERE ma.id = ?`,
        [active!.id]
      );
      await studentPage.reload({ waitUntil: "domcontentloaded" });
      await expect(
        studentPage.getByRole("heading", { name: /connection recovery ended/i })
      ).toBeVisible();
      await expect(studentPage.getByText(/your proctor can help you continue/i)).toBeVisible();
      await expect(
        studentPage.getByRole("button", { name: /continue with server-confirmed answers/i })
      ).toHaveCount(0);

      await page.reload({ waitUntil: "domcontentloaded" });
      const rosterItem = page.getByRole("option", {
        name: new RegExp(
          `Open ${studentName}, needs attention: SAT connection recovery expired`,
          "i"
        ),
      });
      await expect(rosterItem).toBeVisible({ timeout: 30_000 });
      await rosterItem.click();
      await page.getByRole("heading", { name: "Recovery exception" }).waitFor({ state: "visible" });
      await page.getByRole("button", { name: /review recovery decision/i }).click();
      const reason = page.getByLabel("Reason for the recovery decision");
      await expect(reason).toBeVisible();
      const continueButton = page.getByRole("button", { name: "Continue with confirmed answers" });
      await expect(continueButton).toBeDisabled();
      await reason.fill(
        "Student reconnected after the recovery limit; continue from server-confirmed answers."
      );
      await continueButton.click();

      await expect
        .poll(
          async () =>
            (
              await queryDb<{
                phase: string;
                resolution: string | null;
                resolution_reason: string | null;
              }>(
                "SELECT b.phase, b.resolution, b.resolution_reason FROM assessment_module_boundaries b WHERE b.module_attempt_id = ?",
                [active!.id]
              )
            )[0],
          { timeout: 30_000 }
        )
        .toMatchObject({
          phase: "settled",
          resolution: "continue_confirmed",
          resolution_reason:
            "Student reconnected after the recovery limit; continue from server-confirmed answers.",
        });
    } finally {
      await studentContext.setOffline(false);
      await studentContext.close();
    }
  });

  test("lifecycle state read leaves answer rows and timeout reconciliation to their owners", async ({
    page,
    browser,
  }) => {
    const { studentContext, studentPage, scheduleId, candidateId } = await createRunningSatSession(
      browser,
      page,
      {
        label: "lifecycle-state-read",
        startRuntime: false,
        deliveryPolicy: {
          version: "sat_recovery_v1",
          recoverySeconds: 120,
          entryRecoverySeconds: 120,
          lateAnswerPolicy: "frozen_arrival_window",
        },
      }
    );
    try {
      await page.getByRole("button", { name: "Review and start exam" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Start exam" }).click();
      await expect(page.getByText("Exam started.")).toBeVisible({ timeout: 20_000 });
      await studentPage.reload({ waitUntil: "domcontentloaded" });
      await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });

      const active = (
        await queryDb<{ id: string; attempt_id: string }>(
          `SELECT ma.id, ma.attempt_id FROM assessment_module_attempts ma
         JOIN student_attempts a ON a.id = ma.attempt_id
         JOIN assessment_modules m ON m.id = ma.module_id
         JOIN assessment_sections s ON s.id = m.section_id
         WHERE a.schedule_id = ? AND a.candidate_id = ? AND s.section_key = 'reading-writing'
           AND m.adaptive_role = 'base' AND ma.state = 'active'`,
          [scheduleId, candidateId]
        )
      )[0];
      expect(active).toBeTruthy();
      const question = (
        await queryDb<{ id: string }>(
          `SELECT eq.id FROM assessment_exam_questions eq
         JOIN assessment_module_attempts ma ON ma.module_id = eq.module_id
         WHERE ma.id = ? ORDER BY eq.display_order LIMIT 1`,
          [active!.id]
        )
      )[0];
      expect(question).toBeTruthy();
      const answer = studentPage.locator(`input[name="sat-answer-${question!.id}"]`).nth(1);
      await answer.press("Space");
      await expect
        .poll(
          async () =>
            (
              await queryDb<{ n: number }>(
                "SELECT COUNT(*) AS n FROM attempt_responses_v2 WHERE attempt_id = ? AND question_id = ?",
                [active!.attempt_id, question!.id]
              )
            )[0]!.n,
          { timeout: 20_000 }
        )
        .toBe(1);

      // Keep the timeout worker out of this read-path assertion while making
      // the boundary authoritative deadline overdue. A lifecycle GET must not
      // itself reconcile the boundary or reload the full response projection.
      await executeUpdate(
        `UPDATE assessment_module_attempts ma
         JOIN assessment_module_boundaries b ON b.module_attempt_id = ma.id
         SET ma.started_at = TIMESTAMPADD(SECOND, -ma.allocated_seconds - 1, NOW(6)),
             b.phase = 'working', b.work_deadline_at = TIMESTAMPADD(SECOND, -1, NOW(6)),
             b.recovery_deadline_at = TIMESTAMPADD(SECOND, 120, NOW(6)),
             b.next_action_at = TIMESTAMPADD(HOUR, 1, NOW(6)), b.revision = b.revision + 1
         WHERE ma.id = ?`,
        [active!.id]
      );
      const token = await studentPage.evaluate(
        ({ currentScheduleId, currentAttemptId }) => {
          const raw =
            localStorage.getItem("ielts_student_attempt_credentials_v1") ??
            sessionStorage.getItem("ielts_student_attempt_credentials_v1");
          const credentials = JSON.parse(raw ?? "[]") as Array<{
            scheduleId?: string;
            attemptId?: string;
            attemptToken?: string;
          }>;
          return (
            credentials.find(
              (item) => item.scheduleId === currentScheduleId && item.attemptId === currentAttemptId
            )?.attemptToken ?? null
          );
        },
        { currentScheduleId: scheduleId, currentAttemptId: active!.attempt_id }
      );
      expect(token).toBeTruthy();
      const lifecycle = await studentPage.evaluate(
        async ({ currentScheduleId, currentToken }) => {
          const response = await fetch(
            `/api/v1/assessment-delivery/schedules/${currentScheduleId}/state`,
            {
              headers: { Authorization: `Bearer ${currentToken}` },
              cache: "no-store",
            }
          );
          return {
            status: response.status,
            body: (await response.json()) as {
              sections?: unknown[];
              attempt?: { responses?: unknown[] };
            },
          };
        },
        { currentScheduleId: scheduleId, currentToken: token }
      );
      expect(lifecycle.status).toBe(200);
      expect(lifecycle.body.sections ?? []).toHaveLength(0);
      expect(lifecycle.body.attempt?.responses ?? []).toHaveLength(0);
      const boundary = (
        await queryDb<{ phase: string }>(
          "SELECT phase FROM assessment_module_boundaries WHERE module_attempt_id = ?",
          [active!.id]
        )
      )[0];
      expect(boundary?.phase).toBe("working");
    } finally {
      await studentContext.close();
    }
  });

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
      await expect(
        studentPage.getByRole("heading", { name: /Waiting for your proctor/ })
      ).toBeFocused();
      await expect(studentPage.getByTestId("sat-exam-shell")).toHaveCount(0);
      await expect(studentPage.getByRole("button", { name: /Begin module/i })).toHaveCount(0);
      await studentPage.reload({ waitUntil: "domcontentloaded" });
      await expect(
        studentPage.getByRole("heading", { name: /Waiting for your proctor/ })
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        studentPage.getByRole("heading", { name: /Waiting for your proctor/ })
      ).toBeFocused();

      await page.getByRole("button", { name: "Review and start exam" }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: "Start exam" }).click();
      await expect(page.getByText("Exam started.")).toBeVisible({ timeout: 20_000 });
      // The student and proctor use separate pages. Bring the student page to
      // the foreground before asserting entry so Chromium does not throttle
      // the student's startup/recovery timers as a background tab.
      await studentPage.bringToFront();
      await expect(studentPage.getByTestId("sat-exam-shell")).toBeVisible({ timeout: 45_000 });
      await expect(studentPage.getByRole("button", { name: /Begin module/i })).toHaveCount(0);
      await expect(studentPage.getByRole("heading", { name: "Question 1" })).toBeFocused();
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
      await expect(studentPage.getByRole("heading", { name: "Question 1" })).toBeFocused();
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
          // The lifecycle fallback is jittered between 30 and 60 seconds
          // while the realtime socket is healthy.
          { timeout: 65_000 }
        );
        await studentPage.bringToFront();
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
      await expect(scheduledBreak.getByRole("heading", { level: 1 })).toBeFocused();
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
      await expect(studentPage.getByRole("heading", { name: "Question 1" })).toBeFocused();
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
      await expect(studentPage.getByRole("heading", { name: "SAT Complete" })).toBeFocused();
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
          // Load the active exam before shortening its server deadline. This
          // keeps a slow full-suite reload from consuming the whole test window.
          await student.reload({ waitUntil: "domcontentloaded" });
          await expect(student.getByTestId("sat-exam-shell")).toBeVisible();
          await session.studentContext.setOffline(true);
          await executeUpdate(
            "UPDATE assessment_module_attempts SET allocated_seconds = 10, started_at = NOW(6) WHERE id = ?",
            [base.id]
          );
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
          await expireModuleForHandoff(base.id);
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

async function expireModuleForHandoff(moduleAttemptId: string): Promise<number> {
  const sql = `UPDATE assessment_module_attempts
                  SET started_at = TIMESTAMPADD(SECOND, -allocated_seconds - 20, NOW(6))
                WHERE id = ? AND state = 'active'`;
  // The live worker may expire this same module concurrently. Reapplying this
  // idempotent fixture clock change is safe after MySQL chooses it as a victim.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await executeUpdate(sql, [moduleAttemptId]);
    } catch (error) {
      const mysqlError = error as { code?: unknown; errno?: unknown };
      if ((mysqlError.code !== "ER_LOCK_DEADLOCK" && mysqlError.errno !== 1213) || attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  throw new Error("Unable to move the active module past its deadline.");
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

async function replaySatRecoveryResolution(
  page: import("@playwright/test").Page,
  scheduleId: string,
  attemptId: string,
  candidateId: string,
  request: SATRecoveryResolutionRequest
): Promise<SATRecoveryResolutionReceipt> {
  return page.evaluate(
    async ({
      scheduleId: id,
      attemptId: studentAttemptId,
      candidateId: studentId,
      request: resolution,
    }) => {
      const delivery = await import("/src/features/student-delivery/api/assessmentDeliveryApi.ts");
      delivery.configureAssessmentDeliveryAttempt(id, studentAttemptId, studentId);
      return delivery.assessmentDeliveryApi.resolveRecovery(id, studentAttemptId, resolution);
    },
    { scheduleId, attemptId, candidateId, request }
  );
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

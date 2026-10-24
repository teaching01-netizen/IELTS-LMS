import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { readBackendE2EManifest } from "./support/backendE2e";
import { executeUpdate, queryDb } from "./support/db";
import {
  newAdminControlContext,
  postProctorApi,
  proctorStartExam,
} from "./support/proctorControls";
import {
  completePreCheckIfPresent,
  openStudentSessionWithRetry,
  studentCheckIn,
  stubScreenDetails,
} from "./support/studentUi";

type TimelineRow = {
  attempt_id: string;
  section_key: string;
  state: string;
  started_at: string | null;
  deadline_at: string | null;
  paused_at: string | null;
  accumulated_paused_seconds: number;
};

async function timeline(attemptId: string, sectionKey = "listening") {
  const rows = await queryDb<TimelineRow>(
    `SELECT attempt_id, section_key, state, started_at, deadline_at, paused_at, accumulated_paused_seconds
     FROM ielts_attempt_section_timelines
     WHERE attempt_id = ? AND section_key = ?`,
    [attemptId, sectionKey]
  );
  return rows[0] ?? null;
}

async function openRoomSection(scheduleId: string, sectionKey: "reading" | "writing") {
  const order = sectionKey === "reading" ? 1 : 2;
  await executeUpdate(
    `UPDATE exam_session_runtime_sections
     SET status = CASE WHEN section_order < ? THEN 'completed' WHEN section_order = ? THEN 'live' ELSE 'locked' END,
         actual_start_at = CASE WHEN section_order <= ? THEN COALESCE(actual_start_at, UTC_TIMESTAMP(6)) ELSE NULL END,
         actual_end_at = CASE WHEN section_order < ? THEN COALESCE(actual_end_at, UTC_TIMESTAMP(6)) ELSE NULL END
     WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)`,
    [order, order, order, order, scheduleId]
  );
  await executeUpdate(
    `UPDATE exam_session_runtimes
     SET active_section_key = ?, current_section_key = ?, current_section_remaining_seconds = 60,
         waiting_for_next_section = FALSE
     WHERE schedule_id = ? AND status = 'live'`,
    [sectionKey, sectionKey, scheduleId]
  );
}

async function attemptIdFor(scheduleId: string, wcode: string) {
  const rows = await queryDb<{ id: string }>(
    "SELECT id FROM student_attempts WHERE schedule_id = ? AND wcode = ?",
    [scheduleId, wcode]
  );
  if (!rows[0]) throw new Error(`No attempt was created for ${wcode}.`);
  return rows[0].id;
}

async function responseFor(attemptId: string, questionId: string) {
  const rows = await queryDb<{ response: string }>(
    `SELECT CAST(response AS CHAR) AS response
     FROM attempt_responses_v2 WHERE attempt_id = ? AND question_id = ?`,
    [attemptId, questionId]
  );
  return rows[0]?.response ?? null;
}

test.describe("IELTS individual section timing", () => {
  test.describe.configure({ timeout: 600_000 });

  test("one candidate can start while another recovers, then keeps full time after room advance", async ({
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "The multi-candidate runtime scenario runs once in desktop Chromium."
    );

    const scheduleId = readBackendE2EManifest().student.ieltsPersonalTimingScheduleId;
    const runId = `${Date.now().toString(36).toUpperCase()}${process.pid.toString(36).toUpperCase()}`;
    const readyWcode = `IELTS-${runId}-READY`;
    const delayedWcode = `IELTS-${runId}-DELAYED`;
    const readyContext = await browser.newContext({ serviceWorkers: "block" });
    const delayedContext = await browser.newContext({ serviceWorkers: "block" });
    await Promise.all([stubScreenDetails(readyContext), stubScreenDetails(delayedContext)]);
    const readyPage = await readyContext.newPage();
    const delayedPage = await delayedContext.newPage();
    const adminContext = await newAdminControlContext(browser);
    let delayedReadyRequests = 0;
    const blockDelayedReadiness = async (route: import("@playwright/test").Route) => {
      delayedReadyRequests += 1;
      await route.abort("failed");
    };

    try {
      await executeUpdate(
        `UPDATE exam_schedules
         SET start_time = DATE_SUB(NOW(6), INTERVAL 1 HOUR),
             end_time = DATE_ADD(NOW(6), INTERVAL 4 HOUR)
         WHERE id = ?`,
        [scheduleId]
      );

      await studentCheckIn(readyPage, scheduleId, {
        wcode: readyWcode,
        email: `e2e+${readyWcode.toLowerCase()}@example.com`,
        fullName: "IELTS Ready Candidate",
      });
      await studentCheckIn(delayedPage, scheduleId, {
        wcode: delayedWcode,
        email: `e2e+${delayedWcode.toLowerCase()}@example.com`,
        fullName: "IELTS Delayed Candidate",
      });
      await Promise.all([
        openStudentSessionWithRetry(readyPage, scheduleId, readyWcode),
        openStudentSessionWithRetry(delayedPage, scheduleId, delayedWcode),
      ]);
      await Promise.all([
        completePreCheckIfPresent(readyPage),
        completePreCheckIfPresent(delayedPage),
      ]);

      await proctorStartExam(adminContext, scheduleId);
      await executeUpdate(
        `UPDATE exam_session_runtime_sections
         SET planned_duration_minutes = 1
         WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
           AND section_key IN ('listening', 'reading', 'writing')`,
        [scheduleId]
      );
      await executeUpdate(
        `UPDATE exam_session_runtimes
         SET current_section_remaining_seconds = 60
         WHERE schedule_id = ?`,
        [scheduleId]
      );

      await delayedPage.route("**/sections/*/ready", blockDelayedReadiness);
      await Promise.all([
        readyPage.reload({ waitUntil: "domcontentloaded" }),
        delayedPage.reload({ waitUntil: "domcontentloaded" }),
      ]);

      const readyAttemptId = await attemptIdFor(scheduleId, readyWcode);
      const delayedAttemptId = await attemptIdFor(scheduleId, delayedWcode);
      const listeningQuestionId = readBackendE2EManifest().student.questionId;
      await expect
        .poll(async () => (await timeline(readyAttemptId))?.state ?? null, {
          timeout: 30_000,
          message: "the ready candidate starts without waiting for the other candidate",
        })
        .toBe("active");
      await expect(readyPage.getByLabel(/Answer for question 1/i).first()).toBeVisible();
      await expect
        .poll(() => delayedReadyRequests, {
          timeout: 10_000,
          message: "the second candidate readiness failure is exercised",
        })
        .toBeGreaterThan(0);

      await delayedPage.waitForTimeout(40_000);
      await delayedPage.unroute("**/sections/*/ready", blockDelayedReadiness);

      await expect
        .poll(async () => (await timeline(delayedAttemptId))?.state ?? null, {
          timeout: 20_000,
          message: "the delayed candidate starts automatically after reconnecting",
        })
        .toBe("active");
      const firstReadyTimeline = await timeline(readyAttemptId);
      const firstDelayedTimeline = await timeline(delayedAttemptId);
      expect(firstReadyTimeline?.started_at).not.toBeNull();
      expect(firstReadyTimeline?.deadline_at).not.toBeNull();
      expect(firstDelayedTimeline?.started_at).not.toBeNull();
      expect(firstDelayedTimeline?.deadline_at).not.toBeNull();
      expect(
        Date.parse(firstDelayedTimeline!.deadline_at!) -
          Date.parse(firstDelayedTimeline!.started_at!)
      ).toBe(60_000);
      expect(
        Date.parse(firstDelayedTimeline!.started_at!) - Date.parse(firstReadyTimeline!.started_at!)
      ).toBeGreaterThanOrEqual(39_000);
      expect(
        Date.parse(firstDelayedTimeline!.started_at!) - Date.parse(firstReadyTimeline!.started_at!)
      ).toBeLessThan(50_000);
      const delayedControlEpoch = await queryDb<{ control_epoch: number }>(
        "SELECT control_epoch FROM student_attempts WHERE id = ?",
        [delayedAttemptId]
      );

      await delayedPage.reload({ waitUntil: "domcontentloaded" });
      await expect(delayedPage.getByLabel(/Answer for question 1/i).first()).toBeVisible();
      await expect
        .poll(
          async () => {
            const current = await timeline(delayedAttemptId);
            return [current?.started_at ?? null, current?.deadline_at ?? null];
          },
          { timeout: 15_000, message: "reloading resumes the original IELTS timeline" }
        )
        .toEqual([firstDelayedTimeline!.started_at, firstDelayedTimeline!.deadline_at]);

      await expect
        .poll(
          async () => {
            const rows = await queryDb<{ current_section_key: string | null }>(
              "SELECT current_section_key FROM exam_session_runtimes WHERE schedule_id = ?",
              [scheduleId]
            );
            return rows[0]?.current_section_key ?? null;
          },
          { timeout: 90_000, message: "the shared room advances to Reading" }
        )
        .toBe("reading");
      const controlEpochAfterRoomAdvance = await queryDb<{ control_epoch: number }>(
        "SELECT control_epoch FROM student_attempts WHERE id = ?",
        [delayedAttemptId]
      );
      expect(controlEpochAfterRoomAdvance[0]?.control_epoch).toBe(
        delayedControlEpoch[0]?.control_epoch
      );

      const delayedAnswer = `kept-after-room-advance-${Date.now()}`;
      await expect(delayedPage.getByLabel(/Answer for question 1/i).first()).toBeVisible();
      await delayedPage
        .getByLabel(/Answer for question 1/i)
        .first()
        .fill(delayedAnswer);
      await expect
        .poll(
          async () => {
            const rows = await queryDb<{ n: number }>(
              "SELECT COUNT(*) AS n FROM attempt_responses_v2 WHERE attempt_id = ?",
              [delayedAttemptId]
            );
            return Number(rows[0]?.n ?? 0);
          },
          {
            timeout: 20_000,
            message: "the delayed candidate can still save the active Listening section",
          }
        )
        .toBeGreaterThan(0);
      await expect(delayedPage.getByLabel(/Answer for question 1/i).first()).toHaveValue(
        delayedAnswer
      );

      // Keep the initial 60-second grant assertion above real, then move the
      // authoritative deadline forward in the fixture to exercise a stale
      // acknowledgement and the final boundary write without another minute.
      const transitionAnswer = `older-in-flight-at-boundary-${Date.now()}`;
      const latestTransitionAnswer = `latest-correction-at-boundary-${Date.now()}`;
      const finalBoundaryAnswer = `final-keystroke-at-boundary-${Date.now()}`;
      let resolveHeldWrite!: () => void;
      let releaseHeldWrite!: () => void;
      const heldWrite = new Promise<void>((resolve) => {
        resolveHeldWrite = resolve;
      });
      const allowWrite = new Promise<void>((resolve) => {
        releaseHeldWrite = resolve;
      });
      await delayedPage.route("**/v2/student/attempts/*/responses:batch", async (route) => {
        if ((route.request().postData() ?? "").includes(transitionAnswer)) {
          const response = await route.fetch();
          if (!response.ok()) {
            resolveHeldWrite();
            throw new Error(`The first boundary answer was not accepted: ${response.status()}`);
          }
          resolveHeldWrite();
          await allowWrite;
          await route.fulfill({ response });
          return;
        }
        await route.continue();
      });
      await executeUpdate(
        `UPDATE ielts_attempt_section_timelines
         SET deadline_at = DATE_ADD(NOW(6), INTERVAL 15 SECOND)
         WHERE attempt_id = ? AND section_key = 'listening'`,
        [delayedAttemptId]
      );
      await delayedPage.reload({ waitUntil: "domcontentloaded" });
      const boundaryAnswer = delayedPage.getByLabel(/Answer for question 1/i).first();
      await expect(boundaryAnswer).toBeVisible();
      await boundaryAnswer.fill(transitionAnswer);
      await expect(heldWrite).resolves.toBeUndefined();
      await boundaryAnswer.fill(latestTransitionAnswer);
      await expect(boundaryAnswer).toHaveValue(latestTransitionAnswer);
      releaseHeldWrite();
      await expect(boundaryAnswer).toHaveValue(latestTransitionAnswer);
      await expect
        .poll(() => responseFor(delayedAttemptId, listeningQuestionId), {
          timeout: 15_000,
          message: "the newer answer is delivered after the older acknowledgement arrives",
        })
        .toContain(latestTransitionAnswer);
      await delayedPage.unroute("**/v2/student/attempts/*/responses:batch");

      let resolveBoundaryWrite!: () => void;
      let releaseBoundaryWrite!: () => void;
      const boundaryWrite = new Promise<void>((resolve) => {
        resolveBoundaryWrite = resolve;
      });
      const allowBoundaryWrite = new Promise<void>((resolve) => {
        releaseBoundaryWrite = resolve;
      });
      await delayedPage.route("**/v2/student/attempts/*/responses:batch", async (route) => {
        if ((route.request().postData() ?? "").includes(finalBoundaryAnswer)) {
          resolveBoundaryWrite();
          await allowBoundaryWrite;
        }
        await route.continue();
      });
      await executeUpdate(
        `UPDATE ielts_attempt_section_timelines
         SET deadline_at = DATE_ADD(NOW(6), INTERVAL 2 SECOND)
         WHERE attempt_id = ? AND section_key = 'listening'`,
        [delayedAttemptId]
      );
      await delayedPage.reload({ waitUntil: "domcontentloaded" });
      await expect(boundaryAnswer).toBeVisible();
      await boundaryAnswer.fill(finalBoundaryAnswer);
      await expect(boundaryWrite).resolves.toBeUndefined();
      await expect
        .poll(
          async () => {
            const rows = await queryDb<{ expired: number }>(
              "SELECT deadline_at <= NOW(6) AS expired FROM ielts_attempt_section_timelines WHERE attempt_id = ? AND section_key = ?",
              [delayedAttemptId, "listening"]
            );
            return Number(rows[0]?.expired ?? 0);
          },
          {
            timeout: 5_000,
            message: "the final keystroke remains in flight beyond the candidate deadline",
          }
        )
        .toBe(1);
      releaseBoundaryWrite();
      await expect
        .poll(() => responseFor(delayedAttemptId, listeningQuestionId), {
          timeout: 15_000,
          message: "the final keystroke is accepted during the bounded save window",
        })
        .toContain(finalBoundaryAnswer);
      await delayedPage.unroute("**/v2/student/attempts/*/responses:batch");

      await expect
        .poll(async () => (await timeline(delayedAttemptId, "reading"))?.state ?? null, {
          timeout: 30_000,
          message: "Reading starts on the delayed candidate’s own timeline",
        })
        .toBe("active");
      const delayedReading = await timeline(delayedAttemptId, "reading");
      expect(delayedReading?.started_at).not.toBeNull();
      expect(delayedReading?.deadline_at).not.toBeNull();
      expect(
        Date.parse(delayedReading!.deadline_at!) - Date.parse(delayedReading!.started_at!)
      ).toBe(60_000);

      // Let the room's natural expiry reconciler finish the shared timeline
      // while this candidate still has a live personal Reading section.
      await executeUpdate(
        `UPDATE exam_session_runtime_sections
         SET status = CASE WHEN section_key = 'writing' THEN 'live' ELSE 'completed' END,
             actual_start_at = CASE WHEN section_key = 'writing' THEN DATE_SUB(NOW(6), INTERVAL 2 MINUTE) ELSE actual_start_at END,
             actual_end_at = CASE WHEN section_key = 'writing' THEN NULL ELSE COALESCE(actual_end_at, DATE_SUB(NOW(6), INTERVAL 2 MINUTE)) END
         WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
           AND section_key IN ('listening', 'reading', 'writing')`,
        [scheduleId]
      );
      await executeUpdate(
        `UPDATE exam_session_runtimes
         SET active_section_key = 'writing', current_section_key = 'writing',
             current_section_remaining_seconds = 0, waiting_for_next_section = FALSE
         WHERE schedule_id = ? AND status = 'live'`,
        [scheduleId]
      );
      await expect
        .poll(
          async () => {
            const rows = await queryDb<{ status: string; completion_reason: string | null }>(
              "SELECT status, completion_reason FROM exam_session_runtimes WHERE schedule_id = ?",
              [scheduleId]
            );
            return [rows[0]?.status, rows[0]?.completion_reason];
          },
          { timeout: 30_000, message: "the shared room completes through natural expiry" }
        )
        .toEqual(["completed", "time_expired"]);

      expect((await timeline(delayedAttemptId, "reading"))?.state).toBe("active");
      const delayedAfterRoomEnd = `saved-after-room-end-${Date.now()}`;
      const readingAnswer = delayedPage.getByLabel(/Answer for question 1/i).first();
      await expect(readingAnswer).toBeVisible();
      await readingAnswer.fill(delayedAfterRoomEnd);
      await expect
        .poll(
          async () => {
            const rows = await queryDb<{ response: string }>(
              `SELECT CAST(response AS CHAR) AS response FROM attempt_responses_v2
            WHERE attempt_id = ? AND question_id = 'reading-q1' LIMIT 1`,
              [delayedAttemptId]
            );
            return rows[0]?.response ?? "";
          },
          {
            timeout: 20_000,
            message: "the delayed candidate can save after normal room completion",
          }
        )
        .toContain(delayedAfterRoomEnd);
      const stillWorking = await queryDb<{ delivery_status: string; submitted_at: string | null }>(
        "SELECT delivery_status, submitted_at FROM student_attempts WHERE id = ?",
        [delayedAttemptId]
      );
      expect(stillWorking[0]?.delivery_status).toBe("running");
      expect(stillWorking[0]?.submitted_at).toBeNull();

      await executeUpdate(
        `UPDATE ielts_attempt_section_timelines
         SET deadline_at = DATE_ADD(NOW(6), INTERVAL 2 SECOND)
         WHERE attempt_id = ? AND section_key = 'reading'`,
        [delayedAttemptId]
      );
      await delayedPage.reload({ waitUntil: "domcontentloaded" });
      await expect
        .poll(async () => (await timeline(delayedAttemptId, "writing"))?.state ?? null, {
          timeout: 30_000,
          message: "the delayed candidate opens Writing after the room has completed",
        })
        .toBe("active");
      const delayedWriting = await timeline(delayedAttemptId, "writing");
      expect(
        Date.parse(delayedWriting!.deadline_at!) - Date.parse(delayedWriting!.started_at!)
      ).toBe(60_000);
      const beforeFinalDeadline = await queryDb<{
        delivery_status: string;
        submitted_at: string | null;
      }>("SELECT delivery_status, submitted_at FROM student_attempts WHERE id = ?", [
        delayedAttemptId,
      ]);
      expect(beforeFinalDeadline[0]?.delivery_status).toBe("running");
      expect(beforeFinalDeadline[0]?.submitted_at).toBeNull();

      await executeUpdate(
        `UPDATE ielts_attempt_section_timelines
         SET deadline_at = DATE_SUB(NOW(6), INTERVAL 1 SECOND)
         WHERE attempt_id = ? AND section_key = 'writing'`,
        [delayedAttemptId]
      );
      await delayedPage.reload({ waitUntil: "domcontentloaded" });
      await expect
        .poll(
          async () => {
            const rows = await queryDb<{ delivery_status: string; submitted_at: string | null }>(
              "SELECT delivery_status, submitted_at FROM student_attempts WHERE id = ?",
              [delayedAttemptId]
            );
            return rows[0]?.delivery_status === "submitted" && rows[0]?.submitted_at !== null;
          },
          { timeout: 30_000, message: "submission waits for the candidate’s own final section" }
        )
        .toBe(true);
    } finally {
      await adminContext.close();
      await Promise.all([readyContext.close(), delayedContext.close()]);
    }
  });

  test("preparation timeout is visible and preserves a completed section answer", async ({
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "The database-backed preparation recovery scenario runs once in desktop Chromium."
    );

    const scheduleId = readBackendE2EManifest().student.ieltsPersonalRecoveryScheduleId;
    const wcode = `IELTS-${Date.now().toString(36).toUpperCase()}${process.pid.toString(36).toUpperCase()}-UNABLE`;
    const context = await browser.newContext({ serviceWorkers: "block" });
    await stubScreenDetails(context);
    const page = await context.newPage();
    const adminContext = await newAdminControlContext(browser);

    try {
      await executeUpdate(
        `UPDATE exam_schedules
         SET start_time = DATE_SUB(NOW(6), INTERVAL 1 HOUR),
             end_time = DATE_ADD(NOW(6), INTERVAL 4 HOUR)
         WHERE id = ?`,
        [scheduleId]
      );
      await studentCheckIn(page, scheduleId, {
        wcode,
        email: `e2e+${wcode.toLowerCase()}@example.com`,
        fullName: "IELTS Recovery Candidate",
      });
      await openStudentSessionWithRetry(page, scheduleId, wcode);
      await completePreCheckIfPresent(page);
      await proctorStartExam(adminContext, scheduleId);
      await executeUpdate(
        `UPDATE exam_session_runtime_sections
         SET planned_duration_minutes = 1
         WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
           AND section_key IN ('listening', 'reading', 'writing')`,
        [scheduleId]
      );
      await executeUpdate(
        `UPDATE exam_session_runtimes
         SET current_section_remaining_seconds = 60, ielts_preparation_seconds = 120
         WHERE schedule_id = ?`,
        [scheduleId]
      );

      const attemptId = await attemptIdFor(scheduleId, wcode);
      await expect
        .poll(async () => (await timeline(attemptId))?.state ?? null, {
          timeout: 30_000,
          message: "the candidate starts Listening before recording recovery work",
        })
        .toBe("active");
      const savedAnswer = `preserved-before-timeout-${Date.now()}`;
      const answer = page.getByLabel(/Answer for question 1/i).first();
      await expect(answer).toBeVisible();
      await answer.fill(savedAnswer);
      await expect
        .poll(
          async () => {
            const rows = await queryDb<{ response: string }>(
              "SELECT CAST(response AS CHAR) AS response FROM attempt_responses_v2 WHERE attempt_id = ? LIMIT 1",
              [attemptId]
            );
            return rows[0]?.response ?? "";
          },
          { timeout: 20_000, message: "the Listening answer is confirmed before recovery fails" }
        )
        .toContain(savedAnswer);

      await executeUpdate(
        `UPDATE exam_session_runtimes
         SET ielts_preparation_seconds = 3
         WHERE schedule_id = ?`,
        [scheduleId]
      );
      await executeUpdate(
        `UPDATE ielts_attempt_section_timelines
         SET deadline_at = DATE_ADD(NOW(6), INTERVAL 2 SECOND)
         WHERE attempt_id = ? AND section_key = 'listening'`,
        [attemptId]
      );
      await openRoomSection(scheduleId, "reading");
      await page.route("**/sections/reading/ready", async (route) => {
        const requestBody = route.request().postDataJSON() as Record<string, unknown>;
        await route.continue({
          postData: JSON.stringify({ ...requestBody, contentReady: false }),
          headers: { ...route.request().headers(), "content-type": "application/json" },
        });
      });
      await page.reload({ waitUntil: "domcontentloaded" });

      await expect
        .poll(async () => (await timeline(attemptId, "reading"))?.state ?? null, {
          timeout: 25_000,
          message: "the preparation allowance expires into an explicit unable state",
        })
        .toBe("unable");
      await expect(page.getByRole("heading", { name: "Could not start" })).toBeVisible();

      const attempts = await queryDb<{ delivery_status: string; submitted_at: string | null }>(
        "SELECT delivery_status, submitted_at FROM student_attempts WHERE id = ?",
        [attemptId]
      );
      expect(attempts[0]?.delivery_status).toBe("running");
      expect(attempts[0]?.submitted_at).toBeNull();
      const savedResponses = await queryDb<{ response: string }>(
        "SELECT CAST(response AS CHAR) AS response FROM attempt_responses_v2 WHERE attempt_id = ? LIMIT 1",
        [attemptId]
      );
      expect(savedResponses[0]?.response).toContain(savedAnswer);
      const incidents = await queryDb<{ count: number }>(
        `SELECT COUNT(*) AS count FROM session_audit_logs
         WHERE schedule_id = ? AND target_student_id = ? AND action_type = 'IELTS_PREPARATION_UNABLE'`,
        [scheduleId, attemptId]
      );
      expect(Number(incidents[0]?.count ?? 0)).toBe(1);

      const loginResponse = await adminContext.request.post(
        "http://127.0.0.1:4000/api/v1/auth/login",
        {
          data: { email: "e2e.admin.operator@example.com", password: "Password123!" },
        }
      );
      expect(loginResponse.status()).toBe(200);
      const proctorDetailResponse = await adminContext.request.get(
        `http://127.0.0.1:4000/api/v1/proctor/sessions/${scheduleId}`
      );
      expect(proctorDetailResponse.status()).toBe(200);
      const proctorDetail = (await proctorDetailResponse.json()) as {
        sessions?: Array<{
          attemptId: string;
          ieltsPersonalStatus?: string;
          ieltsPersonalSectionKey?: string;
        }>;
      };
      const proctorCandidate = proctorDetail.sessions?.find(
        (session) => session.attemptId === attemptId
      );
      expect(proctorCandidate?.ieltsPersonalStatus).toBe("unable");
      expect(proctorCandidate?.ieltsPersonalSectionKey).toBe("reading");
    } finally {
      await adminContext.close();
      await context.close();
    }
  });

  test("a mid-section disconnect keeps its deadline and storage failure blocks unprotected answers", async ({
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "The real-time durability scenario runs once in desktop Chromium."
    );

    const scheduleId = readBackendE2EManifest().student.ieltsPersonalResilienceScheduleId;
    const runId = `${Date.now().toString(36).toUpperCase()}${process.pid.toString(36).toUpperCase()}`;
    const offlineWcode = `IELTS-${runId}-OFFLINE`;
    const storageWcode = `IELTS-${runId}-STORAGE`;
    const offlineContext = await browser.newContext({ serviceWorkers: "block" });
    const storageContext = await browser.newContext({ serviceWorkers: "block" });
    await Promise.all([stubScreenDetails(offlineContext), stubScreenDetails(storageContext)]);
    const offlinePage = await offlineContext.newPage();
    const storagePage = await storageContext.newPage();
    const adminContext = await newAdminControlContext(browser);

    try {
      await executeUpdate(
        `UPDATE exam_schedules
         SET start_time = DATE_SUB(NOW(6), INTERVAL 1 HOUR),
             end_time = DATE_ADD(NOW(6), INTERVAL 4 HOUR)
         WHERE id = ?`,
        [scheduleId]
      );
      await Promise.all([
        studentCheckIn(offlinePage, scheduleId, {
          wcode: offlineWcode,
          email: `e2e+${offlineWcode.toLowerCase()}@example.com`,
          fullName: "IELTS Offline Candidate",
        }),
        studentCheckIn(storagePage, scheduleId, {
          wcode: storageWcode,
          email: `e2e+${storageWcode.toLowerCase()}@example.com`,
          fullName: "IELTS Storage Candidate",
        }),
      ]);
      await Promise.all([
        openStudentSessionWithRetry(offlinePage, scheduleId, offlineWcode),
        openStudentSessionWithRetry(storagePage, scheduleId, storageWcode),
      ]);
      await Promise.all([
        completePreCheckIfPresent(offlinePage),
        completePreCheckIfPresent(storagePage),
      ]);
      await proctorStartExam(adminContext, scheduleId);
      await executeUpdate(
        `UPDATE exam_session_runtime_sections
         SET planned_duration_minutes = 1
         WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
           AND section_key IN ('listening', 'reading', 'writing')`,
        [scheduleId]
      );
      await Promise.all([
        offlinePage.reload({ waitUntil: "domcontentloaded" }),
        storagePage.reload({ waitUntil: "domcontentloaded" }),
      ]);

      const offlineAttempt = await attemptIdFor(scheduleId, offlineWcode);
      const storageAttempt = await attemptIdFor(scheduleId, storageWcode);
      const questionId = readBackendE2EManifest().student.questionId;
      await expect
        .poll(async () => (await timeline(offlineAttempt))?.state ?? null, {
          timeout: 30_000,
          message: "the offline candidate starts Listening with a personal deadline",
        })
        .toBe("active");
      await expect
        .poll(async () => (await timeline(storageAttempt))?.state ?? null, {
          timeout: 30_000,
          message: "the storage candidate starts Listening independently",
        })
        .toBe("active");

      const confirmedBeforeDisconnect = `confirmed-before-disconnect-${Date.now()}`;
      const offlineAnswer = offlinePage.getByLabel(/Answer for question 1/i).first();
      await offlineAnswer.fill(confirmedBeforeDisconnect);
      await expect
        .poll(() => responseFor(offlineAttempt, questionId), {
          timeout: 20_000,
          message: "the answer is server-confirmed before the connection drops",
        })
        .toContain(confirmedBeforeDisconnect);
      const originalOfflineTimeline = await timeline(offlineAttempt);
      const unsyncedAnswer = `kept-on-device-${Date.now()}`;
      await offlineContext.setOffline(true);
      await offlineAnswer.fill(unsyncedAnswer);
      await expect(offlinePage.getByTestId("student-auto-save-status")).toContainText(
        "Saved on this device · awaiting server",
        { timeout: 20_000 }
      );
      await expect(offlineAnswer).toHaveValue(unsyncedAnswer);
      await offlinePage.waitForTimeout(2_500);
      expect(await responseFor(offlineAttempt, questionId)).toContain(confirmedBeforeDisconnect);
      expect(await timeline(offlineAttempt)).toEqual(originalOfflineTimeline);
      await offlineContext.setOffline(false);
      await expect
        .poll(() => responseFor(offlineAttempt, questionId), {
          timeout: 30_000,
          message: "the local draft synchronizes after reconnection",
        })
        .toContain(unsyncedAnswer);
      await expect(offlinePage.getByTestId("student-auto-save-status")).toHaveText("Saved");
      await expect(offlineAnswer).toHaveValue(unsyncedAnswer);
      expect(await timeline(offlineAttempt)).toEqual(originalOfflineTimeline);

      const confirmedBeforeStorageFault = `confirmed-before-storage-fault-${Date.now()}`;
      const storageAnswer = storagePage.getByLabel(/Answer for question 1/i).first();
      await storageAnswer.fill(confirmedBeforeStorageFault);
      await expect
        .poll(() => responseFor(storageAttempt, questionId), {
          timeout: 20_000,
          message: "the storage candidate starts from a confirmed answer",
        })
        .toContain(confirmedBeforeStorageFault);
      await storagePage.evaluate(() => {
        const quotaError = () => {
          throw new DOMException("E2E quota exceeded", "QuotaExceededError");
        };
        try {
          window.localStorage.setItem = quotaError as typeof window.localStorage.setItem;
        } catch {
          // The IndexedDB transaction fault below still prevents durable writes.
        }
        try {
          const databasePrototype = window.IDBDatabase?.prototype as unknown as
            Record<string, unknown> | undefined;
          if (databasePrototype) {
            databasePrototype["transaction"] = () => {
              throw new Error("E2E IndexedDB transaction failed");
            };
          }
        } catch {
          // Keep the other browser storage write path faulted when possible.
        }
      });
      const unprotectedAnswer = `must-not-be-accepted-${Date.now()}`;
      await storageAnswer.fill(unprotectedAnswer).catch(() => undefined);
      await expect(
        storagePage.getByRole("heading", { name: "Answer storage unavailable" })
      ).toBeVisible({ timeout: 20_000 });
      await expect(storagePage.getByRole("alertdialog")).toContainText(
        /cannot safely store new answers/i
      );
      await storagePage.waitForTimeout(1_500);
      expect(await responseFor(storageAttempt, questionId)).toContain(confirmedBeforeStorageFault);
      expect(await responseFor(storageAttempt, questionId)).not.toContain(unprotectedAnswer);
    } finally {
      await adminContext.close();
      await Promise.all([offlineContext.close(), storageContext.close()]);
    }
  });

  test("final Writing correction survives a lost submission response and reload", async ({
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "The final submission receipt scenario runs once in desktop Chromium."
    );

    const scheduleId = readBackendE2EManifest().student.ieltsPersonalSubmissionScheduleId;
    const wcode = `IELTS-${Date.now().toString(36).toUpperCase()}${process.pid.toString(36).toUpperCase()}-SUBMIT`;
    const context = await browser.newContext({ serviceWorkers: "block" });
    await stubScreenDetails(context);
    const page = await context.newPage();
    const adminContext = await newAdminControlContext(browser);
    let lostSubmissionResponse = false;
    let submissionRequests = 0;

    try {
      await executeUpdate(
        `UPDATE exam_schedules
         SET start_time = DATE_SUB(NOW(6), INTERVAL 1 HOUR),
             end_time = DATE_ADD(NOW(6), INTERVAL 4 HOUR)
         WHERE id = ?`,
        [scheduleId]
      );
      await studentCheckIn(page, scheduleId, {
        wcode,
        email: `e2e+${wcode.toLowerCase()}@example.com`,
        fullName: "IELTS Submission Recovery Candidate",
      });
      await openStudentSessionWithRetry(page, scheduleId, wcode);
      await completePreCheckIfPresent(page);
      await proctorStartExam(adminContext, scheduleId);
      await executeUpdate(
        `UPDATE exam_session_runtime_sections
         SET planned_duration_minutes = 1
         WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
           AND section_key IN ('listening', 'reading', 'writing')`,
        [scheduleId]
      );
      await executeUpdate(
        `UPDATE exam_session_runtimes
         SET current_section_remaining_seconds = 60
         WHERE schedule_id = ?`,
        [scheduleId]
      );
      await page.reload({ waitUntil: "domcontentloaded" });

      const attemptId = await attemptIdFor(scheduleId, wcode);
      await expect
        .poll(async () => (await timeline(attemptId, "listening"))?.state ?? null, {
          timeout: 30_000,
          message: "Listening starts on the candidate's personal timeline",
        })
        .toBe("active");
      await executeUpdate(
        `UPDATE ielts_attempt_section_timelines
         SET deadline_at = DATE_SUB(NOW(6), INTERVAL 1 SECOND)
         WHERE attempt_id = ? AND section_key = 'listening'`,
        [attemptId]
      );
      await openRoomSection(scheduleId, "reading");
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect
        .poll(async () => (await timeline(attemptId, "reading"))?.state ?? null, {
          timeout: 30_000,
          message: "the candidate starts Reading after the shared room opens it",
        })
        .toBe("active");
      await executeUpdate(
        `UPDATE ielts_attempt_section_timelines
         SET deadline_at = DATE_SUB(NOW(6), INTERVAL 1 SECOND)
         WHERE attempt_id = ? AND section_key = 'reading'`,
        [attemptId]
      );
      await openRoomSection(scheduleId, "writing");
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect
        .poll(async () => (await timeline(attemptId, "writing"))?.state ?? null, {
          timeout: 30_000,
          message: "the candidate starts Writing after the shared room opens it",
        })
        .toBe("active");

      const writingAnswer = page.getByLabel("Writing response").first();
      await expect(writingAnswer).toBeVisible();
      const writingTaskId = await writingAnswer.getAttribute("data-task-id");
      expect(writingTaskId).toBeTruthy();
      const initialWriting = `A candidate response written before the final correction ${Date.now()}.`;
      let initialCredentialRejected = false;
      let transientRefreshFailureInjected = false;
      let credentialRefreshRequests = 0;
      await page.route("**/v2/student/attempts/*/responses:batch", async (route) => {
        if (
          !initialCredentialRejected &&
          (route.request().postData() ?? "").includes(initialWriting)
        ) {
          initialCredentialRejected = true;
          const headers = route.request().headers();
          delete headers.authorization;
          await route.continue({ headers });
          return;
        }
        await route.fallback();
      });
      await page.route("**/student/sessions/**", async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get("refreshAttemptCredential") !== "true") {
          await route.fallback();
          return;
        }
        credentialRefreshRequests += 1;
        if (!transientRefreshFailureInjected) {
          transientRefreshFailureInjected = true;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              success: false,
              error: {
                code: "SERVICE_UNAVAILABLE",
                message: "Database budget exhausted; please retry.",
              },
            }),
          });
          return;
        }
        await route.fallback();
      });
      await writingAnswer.fill(initialWriting);
      await expect
        .poll(() => responseFor(attemptId, writingTaskId!), {
          timeout: 20_000,
          message: "the Writing response is confirmed before its final correction",
        })
        .toContain(initialWriting);
      expect(initialCredentialRejected).toBe(true);
      expect(transientRefreshFailureInjected).toBe(true);
      expect(credentialRefreshRequests).toBeGreaterThanOrEqual(2);

      const finalWritingCorrection = `${initialWriting} The final sentence is included.`;
      await executeUpdate(
        `UPDATE ielts_attempt_section_timelines
         SET deadline_at = DATE_ADD(NOW(6), INTERVAL 15 SECOND)
         WHERE attempt_id = ? AND section_key = 'writing'`,
        [attemptId]
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      const boundaryWritingAnswer = page.getByLabel("Writing response").first();
      await expect(boundaryWritingAnswer).toBeVisible();

      let resolveHeldCorrection!: () => void;
      let releaseHeldCorrection!: () => void;
      const heldCorrection = new Promise<void>((resolve) => {
        resolveHeldCorrection = resolve;
      });
      const allowCorrection = new Promise<void>((resolve) => {
        releaseHeldCorrection = resolve;
      });
      await page.route("**/v2/student/attempts/*/responses:batch", async (route) => {
        if ((route.request().postData() ?? "").includes(finalWritingCorrection)) {
          resolveHeldCorrection();
          await allowCorrection;
        }
        await route.fallback();
      });
      await page.route("**/v2/student/attempts/*/submit", async (route) => {
        submissionRequests += 1;
        const response = await route.fetch();
        if (response.ok() && !lostSubmissionResponse) {
          lostSubmissionResponse = true;
          await route.abort("failed");
          return;
        }
        await route.abort("failed");
      });
      await boundaryWritingAnswer.fill(finalWritingCorrection);
      await expect(heldCorrection).resolves.toBeUndefined();
      await expect
        .poll(
          async () => {
            const rows = await queryDb<{ expired: number }>(
              "SELECT deadline_at <= NOW(6) AS expired FROM ielts_attempt_section_timelines WHERE attempt_id = ? AND section_key = 'writing'",
              [attemptId]
            );
            return Number(rows[0]?.expired ?? 0);
          },
          {
            timeout: 20_000,
            message: "the last Writing correction is in flight at the personal deadline",
          }
        )
        .toBe(1);
      releaseHeldCorrection();

      await expect
        .poll(() => responseFor(attemptId, writingTaskId!), {
          timeout: 20_000,
          message: "the frozen Writing correction is accepted after the deadline",
        })
        .toContain(finalWritingCorrection);

      // The reload rehydrates the expired final personal section from the server;
      // its committed receipt response is then intentionally dropped below.
      await page.reload({ waitUntil: "domcontentloaded" });

      await expect
        .poll(() => submissionRequests, {
          timeout: 10_000,
          message: "the candidate automatically submits after the final personal deadline",
        })
        .toBeGreaterThan(0);

      await expect
        .poll(
          async () => {
            const rows = await queryDb<{ count: number }>(
              "SELECT COUNT(*) AS count FROM attempt_submissions_v2 WHERE attempt_id = ?",
              [attemptId]
            );
            return Number(rows[0]?.count ?? 0);
          },
          { timeout: 30_000, message: "the server commits exactly one final submission receipt" }
        )
        .toBe(1);
      expect(lostSubmissionResponse).toBe(true);
      expect(submissionRequests).toBeGreaterThan(0);

      const sealedAttempt = await queryDb<{
        delivery_status: string;
        submitted_at: string | null;
        final_submission: string | null;
      }>(
        "SELECT delivery_status, submitted_at, CAST(final_submission AS CHAR) AS final_submission FROM student_attempts WHERE id = ?",
        [attemptId]
      );
      expect(sealedAttempt[0]?.delivery_status).toBe("submitted");
      expect(sealedAttempt[0]?.submitted_at).not.toBeNull();
      expect(sealedAttempt[0]?.final_submission).toContain(finalWritingCorrection);

      await page.unroute("**/v2/student/attempts/*/responses:batch");
      await page.unroute("**/v2/student/attempts/*/submit");
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "IELTS Examination Complete!" })).toBeVisible({
        timeout: 30_000,
      });
      expect(
        Number(
          (
            await queryDb<{ count: number }>(
              "SELECT COUNT(*) AS count FROM attempt_submissions_v2 WHERE attempt_id = ?",
              [attemptId]
            )
          )[0]?.count ?? 0
        )
      ).toBe(1);
    } finally {
      await adminContext.close();
      await context.close();
    }
  });

  test("authorized candidate pause freezes personal time and resume preserves the full section", async ({
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "The personal-timeline pause scenario runs once in desktop Chromium."
    );

    const scheduleId = readBackendE2EManifest().student.ieltsPersonalControlsScheduleId;
    const wcode = `IELTS-${Date.now().toString(36).toUpperCase()}${process.pid.toString(36).toUpperCase()}-PAUSE`;
    const context = await browser.newContext({ serviceWorkers: "block" });
    await stubScreenDetails(context);
    const page = await context.newPage();
    const adminContext = await newAdminControlContext(browser);

    try {
      await executeUpdate(
        `UPDATE exam_schedules
         SET start_time = DATE_SUB(NOW(6), INTERVAL 1 HOUR),
             end_time = DATE_ADD(NOW(6), INTERVAL 4 HOUR)
         WHERE id = ?`,
        [scheduleId]
      );
      await studentCheckIn(page, scheduleId, {
        wcode,
        email: `e2e+${wcode.toLowerCase()}@example.com`,
        fullName: "IELTS Pause Control Candidate",
      });
      await openStudentSessionWithRetry(page, scheduleId, wcode);
      await completePreCheckIfPresent(page);
      await proctorStartExam(adminContext, scheduleId);
      await executeUpdate(
        `UPDATE exam_session_runtime_sections
         SET planned_duration_minutes = 1
         WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
           AND section_key IN ('listening', 'reading', 'writing')`,
        [scheduleId]
      );
      await page.reload({ waitUntil: "domcontentloaded" });

      const attemptId = await attemptIdFor(scheduleId, wcode);
      await expect
        .poll(async () => (await timeline(attemptId))?.state ?? null, {
          timeout: 30_000,
          message: "the candidate begins the personal Listening section",
        })
        .toBe("active");
      const beforePause = await timeline(attemptId);
      expect(beforePause?.started_at).not.toBeNull();
      expect(beforePause?.deadline_at).not.toBeNull();

      const controlUrl = `/api/v1/proctor/sessions/${scheduleId}/attempts/${attemptId}`;
      const pause = await postProctorApi(adminContext, `${controlUrl}/pause`, {
        reason: "e2e pause freezes this candidate's IELTS timeline",
      });
      expect(pause.status, pause.body).toBe(200);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Individual session paused" })).toBeVisible({
        timeout: 30_000,
      });
      const pausedTimeline = await timeline(attemptId);
      expect(pausedTimeline?.paused_at).not.toBeNull();
      await page.waitForTimeout(1_500);
      const stillPaused = await timeline(attemptId);
      expect(stillPaused?.started_at).toBe(beforePause?.started_at);
      expect(stillPaused?.deadline_at).toBe(beforePause?.deadline_at);
      expect(stillPaused?.paused_at).toBe(pausedTimeline?.paused_at);

      const resume = await postProctorApi(adminContext, `${controlUrl}/resume`, {
        reason: "e2e resume preserves the remaining IELTS time",
      });
      expect(resume.status, resume.body).toBe(200);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Individual session paused" })).toHaveCount(0);
      await expect
        .poll(async () => (await timeline(attemptId))?.paused_at ?? null, {
          timeout: 15_000,
          message: "resume closes the personal pause interval",
        })
        .toBeNull();
      const resumedTimeline = await timeline(attemptId);
      expect(resumedTimeline?.started_at).not.toBeNull();
      expect(resumedTimeline?.deadline_at).not.toBeNull();
      expect(
        Date.parse(resumedTimeline!.deadline_at!) - Date.parse(beforePause!.deadline_at!)
      ).toBeGreaterThanOrEqual(1_000);
      expect(
        Date.parse(resumedTimeline!.deadline_at!) - Date.parse(resumedTimeline!.started_at!)
      ).toBe(60_000);
      expect(resumedTimeline?.accumulated_paused_seconds).toBeGreaterThanOrEqual(1);

      const terminate = await postProctorApi(adminContext, `${controlUrl}/terminate`, {
        reason: "e2e termination remains authoritative for personal IELTS timing",
      });
      expect(terminate.status, terminate.body).toBe(200);
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Session terminated" })).toBeVisible({
        timeout: 30_000,
      });
      const terminal = await queryDb<{ proctor_status: string; delivery_status: string }>(
        "SELECT proctor_status, delivery_status FROM student_attempts WHERE id = ?",
        [attemptId]
      );
      expect(terminal[0]).toEqual({ proctor_status: "terminated", delivery_status: "terminated" });
    } finally {
      await adminContext.close();
      await context.close();
    }
  });

  // eslint-disable-next-line no-empty-pattern
  test("500 concurrent candidates transition, reconnect, and submit with personal timing", async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "The 500-candidate local start, transition, and submission scenario runs once in desktop Chromium."
    );
    testInfo.setTimeout(720_000);

    const scheduleId = readBackendE2EManifest().student.ieltsPersonalLoadScheduleId;
    const generatedDirectory = path.resolve(process.cwd(), "e2e/.generated");
    const runId = `${Date.now().toString(36).toUpperCase()}${process.pid.toString(36).toUpperCase()}`;
    const students = Array.from({ length: 500 }, (_, index) => {
      const number = String(index + 1).padStart(6, "0");
      return {
        wcode: `W${runId}${number}`,
        email: `ielts-${runId.toLowerCase()}-${number}@example.com`,
        fullName: `IELTS Load Candidate ${number}`,
      };
    });
    const targetPath = path.join(generatedDirectory, "ielts-personal-load-target.json");
    const credsPath = path.join(generatedDirectory, "ielts-personal-load-creds.json");
    mkdirSync(generatedDirectory, { recursive: true });
    writeFileSync(
      targetPath,
      JSON.stringify({
        baseURL: "http://127.0.0.1:4000",
        scheduleId,
        students,
        delayedWcode: students[0]!.wcode,
        listeningQuestionId: readBackendE2EManifest().student.questionId,
        readingQuestionId: "reading-q1",
        writingTaskId: "task1",
        sectionSeconds: 60,
        admissionJitterSeconds: 60,
        runtimeReadyDelaySeconds: 10,
        readinessJitterSeconds: 15,
      })
    );
    writeFileSync(
      credsPath,
      JSON.stringify({
        editor: { email: "e2e.admin.operator@example.com", password: "Password123!" },
      })
    );
    await executeUpdate(
      `UPDATE exam_schedules
       SET start_time = DATE_SUB(NOW(6), INTERVAL 1 HOUR),
           end_time = DATE_ADD(NOW(6), INTERVAL 4 HOUR)
       WHERE id = ?`,
      [scheduleId]
    );
    const output: string[] = [];
    const k6OutputPath = path.join(generatedDirectory, `ielts-personal-load-${runId}.log`);
    const k6Log = createWriteStream(k6OutputPath, { flags: "w" });
    const k6Process = spawn("k6", ["run", "k6/ielts-personal-timing-500.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        K6_BASE_URL: "http://127.0.0.1:4000",
        K6_SCHEDULE_ID: scheduleId,
        K6_TARGET_PATH: targetPath,
        K6_CREDS_PATH: credsPath,
        K6_STUDENTS: "500",
        K6_DELAYED_SECONDS: "30",
        K6_WAIT_FOR_LIVE_SECONDS: "180",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    k6Process.stdout.setEncoding("utf8");
    k6Process.stderr.setEncoding("utf8");
    const captureK6Output = (chunk: string) => {
      output.push(chunk);
      k6Log.write(chunk);
    };
    k6Process.stdout.on("data", captureK6Output);
    k6Process.stderr.on("data", captureK6Output);
    let runtimeDurationUpdateError: unknown;
    const runtimeDurationUpdate = (async () => {
      await expect
        .poll(
          async () => {
            const rows = await queryDb<{ id: string }>(
              "SELECT id FROM exam_session_runtimes WHERE schedule_id = ? AND status = 'live'",
              [scheduleId]
            );
            return rows[0]?.id ?? null;
          },
          {
            timeout: 180_000,
            message: "the proctor starts the IELTS room after candidate check-in",
          }
        )
        .not.toBeNull();
      expect(
        await executeUpdate(
          `UPDATE exam_session_runtime_sections
           SET planned_duration_minutes = 1
           WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
             AND section_key IN ('listening', 'reading', 'writing')`,
          [scheduleId]
        )
      ).toBe(3);
      expect(
        await executeUpdate(
          `UPDATE exam_session_runtimes
           SET current_section_remaining_seconds = 60
           WHERE schedule_id = ? AND status = 'live'`,
          [scheduleId]
        )
      ).toBe(1);
    })().catch((error: unknown) => {
      runtimeDurationUpdateError = error;
    });
    const exitCode = await new Promise<number>((resolve, reject) => {
      k6Process.once("error", reject);
      k6Process.once("close", (code) => resolve(code ?? 1));
    });
    await new Promise<void>((resolve) => k6Log.end(resolve));
    await runtimeDurationUpdate;
    await testInfo.attach("IELTS 500 candidate k6 output", {
      body: output.join(""),
      contentType: "text/plain",
    });
    const k6Output = output.join("");
    const phaseFailures = k6Output
      .split(/\r?\n/)
      .filter((line) =>
        /IELTS_LOAD_ENTRY_FAILURE|IELTS_LOAD_BOOTSTRAP_FAILURE|IELTS_LOAD_PRECHECK_FAILURE|IELTS_LOAD_CONTROL_START_FAILURE|Student entry failed|Bootstrap failed|Precheck failed|Only \d+\/\d+|readiness failed/.test(
          line
        )
      )
      .slice(0, 25)
      .join("\n");
    expect(
      exitCode,
      `k6 failed; phase diagnostics:\n${phaseFailures}\noutput tail:\n${k6Output.slice(-6_000)}`
    ).toBe(0);

    expect(runtimeDurationUpdateError).toBeUndefined();

    const loadWcodes = students.map((student) => student.wcode);
    const startedTimelines = await queryDb<{
      wcode: string;
      section_key: string;
      state: string;
      started_at: string | null;
      deadline_at: string | null;
      room_started_at: string | null;
      start_offset_ms: number | string | null;
      expected_start_at: string | null;
      preparation_deadline_at: string | null;
      allocated_seconds: number | string;
      expected_seconds: number | string;
    }>(
      `SELECT a.wcode, t.section_key, t.state, t.started_at, t.deadline_at,
              rt.actual_start_at AS room_started_at,
              TIMESTAMPDIFF(MICROSECOND, rt.actual_start_at, t.started_at) / 1000 AS start_offset_ms,
              t.expected_start_at, t.preparation_deadline_at,
              TIMESTAMPDIFF(SECOND, t.started_at, t.deadline_at) AS allocated_seconds,
              (rs.planned_duration_minutes + COALESCE(rs.extension_minutes, 0)
                 + COALESCE(reg.extra_time_minutes, 0)) * 60 AS expected_seconds
       FROM student_attempts a
       JOIN ielts_attempt_section_timelines t ON t.attempt_id = a.id
       JOIN exam_session_runtimes rt ON rt.id = t.runtime_id
       JOIN exam_session_runtime_sections rs ON rs.runtime_id = t.runtime_id AND rs.section_key = t.section_key
       LEFT JOIN schedule_registrations reg ON reg.id = a.registration_id
       WHERE a.schedule_id = ? AND t.section_key IN ('listening', 'reading', 'writing')
         AND a.wcode IN (${loadWcodes.map(() => "?").join(", ")})`,
      [scheduleId, ...loadWcodes]
    );
    expect(startedTimelines).toHaveLength(1_500);
    expect(
      startedTimelines.every(
        (row) =>
          row.expected_start_at !== null &&
          row.preparation_deadline_at !== null &&
          row.room_started_at !== null &&
          row.start_offset_ms !== null
      )
    ).toBe(true);
    expect(
      startedTimelines.every(
        (row) => Number(row.allocated_seconds) === Number(row.expected_seconds)
      )
    ).toBe(true);
    expect(
      startedTimelines.every(
        (row) => row.state === "completed" && row.started_at !== null && row.deadline_at !== null
      )
    ).toBe(true);
    const listeningRows = startedTimelines.filter((row) => row.section_key === "listening");
    const delayedTimeline = listeningRows.find((row) => row.wcode === students[0]?.wcode);
    const otherTimelines = listeningRows.filter((row) => row.wcode !== students[0]?.wcode);
    expect(otherTimelines).toHaveLength(499);
    expect(
      otherTimelines.every(
        (row) => row.state === "completed" && row.started_at !== null && row.deadline_at !== null
      )
    ).toBe(true);
    const readyStartOffsets = otherTimelines
      .map((row) => Number(row.start_offset_ms))
      .sort((left, right) => left - right);
    const readyP99Offset = readyStartOffsets[Math.ceil(readyStartOffsets.length * 0.99) - 1];
    expect(readyStartOffsets.every((offset) => Number.isFinite(offset) && offset >= 0)).toBe(true);
    expect(readyP99Offset).toBeLessThan(45_000);
    const delayedStartOffset = Number(delayedTimeline?.start_offset_ms);
    expect(delayedStartOffset).toBeGreaterThanOrEqual(30_000);
    expect(delayedStartOffset).toBeLessThan(60_000);
    const latestReadyStart = Math.max(...otherTimelines.map((row) => Date.parse(row.started_at!)));
    expect(latestReadyStart).toBeLessThan(Date.parse(delayedTimeline!.started_at!));

    const receipts = await queryDb<{ total: number; attempts: number }>(
      `SELECT COUNT(*) AS total, COUNT(DISTINCT r.attempt_id) AS attempts
       FROM attempt_submissions_v2 r
       JOIN student_attempts a ON a.id = r.attempt_id
       WHERE a.schedule_id = ? AND a.wcode IN (${loadWcodes.map(() => "?").join(", ")})`,
      [scheduleId, ...loadWcodes]
    );
    expect(Number(receipts[0]?.total ?? 0)).toBe(500);
    expect(Number(receipts[0]?.attempts ?? 0)).toBe(500);

    const submittedAttempts = await queryDb<{ total: number; submitted: number }>(
      `SELECT COUNT(*) AS total,
              SUM(delivery_status = 'submitted' AND submitted_at IS NOT NULL) AS submitted
       FROM student_attempts
       WHERE schedule_id = ? AND wcode IN (${loadWcodes.map(() => "?").join(", ")})`,
      [scheduleId, ...loadWcodes]
    );
    expect(Number(submittedAttempts[0]?.total ?? 0)).toBe(500);
    expect(Number(submittedAttempts[0]?.submitted ?? 0)).toBe(500);

    const responseRows = await queryDb<{ total: number; attempts: number }>(
      `SELECT COUNT(*) AS total, COUNT(DISTINCT r.attempt_id) AS attempts
       FROM attempt_responses_v2 r
       JOIN student_attempts a ON a.id = r.attempt_id
       WHERE a.schedule_id = ? AND a.wcode IN (${loadWcodes.map(() => "?").join(", ")})
         AND r.question_id IN (?, ?, ?)`,
      [scheduleId, ...loadWcodes, "listening-q1", "reading-q1", "task1"]
    );
    expect(Number(responseRows[0]?.total ?? 0)).toBe(1_500);
    expect(Number(responseRows[0]?.attempts ?? 0)).toBe(500);

    const room = await queryDb<{ status: string; completion_reason: string | null }>(
      "SELECT status, completion_reason FROM exam_session_runtimes WHERE schedule_id = ?",
      [scheduleId]
    );
    expect(room[0]).toEqual({ status: "completed", completion_reason: "time_expired" });
    const delayedWriting = startedTimelines.find(
      (row) => row.wcode === students[0]?.wcode && row.section_key === "writing"
    );
    const roomEnd = await queryDb<{ actual_end_at: string | null }>(
      "SELECT actual_end_at FROM exam_session_runtimes WHERE schedule_id = ?",
      [scheduleId]
    );
    expect(delayedWriting?.deadline_at).not.toBeNull();
    expect(roomEnd[0]?.actual_end_at).not.toBeNull();
    expect(Date.parse(delayedWriting!.deadline_at!)).toBeGreaterThan(
      Date.parse(roomEnd[0]!.actual_end_at!)
    );
  });
});

import { expect, test } from "@playwright/test";
import { readBackendE2EManifest } from "./support/backendE2e";
import { closeDb, executeUpdate, queryDb } from "./support/db";
import {
  newAdminControlContext,
  proctorEndSection,
  proctorStartExam,
} from "./support/proctorControls";
import {
  completePreCheckIfPresent,
  deterministicWcode,
  openStudentSessionWithRetry,
  studentCheckIn,
  stubScreenDetails,
} from "./support/studentUi";

interface RuntimeStateRow {
  status: string;
  active_section_key: string | null;
  revision: number | string;
  committed_at_ms: number | string;
}

async function readRuntimeState(scheduleId: string): Promise<RuntimeStateRow | null> {
  const rows = await queryDb<RuntimeStateRow>(
    `SELECT status, active_section_key, revision,
            ROUND(UNIX_TIMESTAMP(updated_at) * 1000) AS committed_at_ms
       FROM exam_session_runtimes
      WHERE schedule_id = ?`,
    [scheduleId]
  );
  return rows[0] ?? null;
}

async function waitForRuntimeRevision(scheduleId: string, previousRevision: number) {
  let latest: RuntimeStateRow | null = null;
  await expect
    .poll(
      async () => {
        latest = await readRuntimeState(scheduleId);
        return Number(latest?.revision ?? -1);
      },
      { timeout: 30_000, intervals: [100, 250, 500], message: "runtime transition commits" }
    )
    .toBeGreaterThan(previousRevision);
  if (!latest) throw new Error(`Runtime not found after transition for ${scheduleId}.`);
  return latest;
}

async function waitForActiveSection(scheduleId: string, sectionKey: string) {
  let latest: RuntimeStateRow | null = null;
  await expect
    .poll(
      async () => {
        latest = await readRuntimeState(scheduleId);
        return latest?.active_section_key ?? null;
      },
      { timeout: 30_000, intervals: [100, 250, 500], message: `runtime enters ${sectionKey}` }
    )
    .toBe(sectionKey);
  if (!latest) throw new Error(`Runtime not found after entering ${sectionKey}.`);
  return latest;
}

async function waitForPersistedAnswer(
  scheduleId: string,
  email: string,
  answer: string,
  transportDiagnostics: () => string
) {
  try {
    await expect
      .poll(
      async () => {
        const rows = await queryDb<{ response: unknown }>(
          `SELECT CAST(r.response AS CHAR) AS response
             FROM attempt_responses_v2 r
             JOIN student_attempts a ON a.id = r.attempt_id
            WHERE a.schedule_id = ? AND a.candidate_email = ?`,
          [scheduleId, email]
        );
        return rows.some((row) => String(row.response).includes(answer));
      },
        { timeout: 15_000, message: "the acknowledged Listening answer is persisted" }
      )
      .toBe(true);
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n` +
        `IELTS response transport: ${transportDiagnostics()}`
    );
  }
}

async function expectTransitionVisibleWithinFiveSeconds(
  surface: import("@playwright/test").Locator,
  committedAtMs: number | string,
  transition: string
) {
  await expect(surface, `${transition} becomes visible to the student`).toBeVisible({ timeout: 30_000 });
  const elapsedMs = Date.now() - Number(committedAtMs);
  expect(elapsedMs, `${transition} took ${elapsedMs}ms from runtime commit`).toBeLessThanOrEqual(5_000);
}

async function waitForSavedBanner(page: import("@playwright/test").Page) {
  await expect
    .poll(
      async () => {
        const banner = page.getByRole("banner");
        return banner
          .getByText("Saved")
          .isVisible()
          .catch(() => false);
      },
      { timeout: 30_000, message: "student answer is acknowledged as saved" }
    )
    .toBe(true);
}

test.describe("Student submission flow (Go runtime)", () => {
  test.describe.configure({ timeout: 240_000 });

  test.afterAll(async () => {
    await closeDb();
  });

  test("saved IELTS answers survive a listening timeout before Reading and final auto-submit", async ({
    browser,
  }, testInfo) => {
    test.skip(
      (process.env["VITE_STUDENT_REALTIME"] ?? "websocket").trim().toLowerCase() !== "websocket",
      "This recovery scenario requires the connected WebSocket transport."
    );

    const manifest = readBackendE2EManifest();
    const scheduleId = manifest.student.submissionScheduleId;
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    const email = `submission-${wcode.toLowerCase()}@example.com`;

    const adminContext = await newAdminControlContext(browser);
    const studentContext = await browser.newContext();
    await stubScreenDetails(studentContext);
    const studentPage = await studentContext.newPage();
    let websocketHandshakeReceived = false;
    let dropScheduleRuntimeFrames = false;
    let droppedScheduleRuntimeFrames = 0;
    const responseTransportDiagnostics: string[] = [];
    studentPage.on("response", (response) => {
      if (response.request().method() !== "POST" || !response.url().includes("/responses:batch")) {
        return;
      }
      void response
        .text()
        .then((body) => responseTransportDiagnostics.push(`${response.status()} ${body.slice(0, 300)}`))
        .catch(() => responseTransportDiagnostics.push(`${response.status()} <empty response>`));
    });
    studentPage.on("requestfailed", (request) => {
      if (request.url().includes("/responses:batch")) {
        responseTransportDiagnostics.push(`failed ${request.failure()?.errorText ?? "unknown"}`);
      }
    });
    await studentPage.routeWebSocket("**/api/v1/ws/live*", (pageSocket) => {
      const serverSocket = pageSocket.connectToServer();
      pageSocket.onMessage((message) => serverSocket.send(message));
      serverSocket.onMessage((message) => {
        if (typeof message === "string") {
          try {
            const frame = JSON.parse(message) as Record<string, unknown>;
            if (frame["type"] === "connected") websocketHandshakeReceived = true;
            if (
              dropScheduleRuntimeFrames &&
              frame["kind"] === "schedule_runtime" &&
              frame["id"] === scheduleId
            ) {
              droppedScheduleRuntimeFrames += 1;
              return;
            }
          } catch {
            // Forward non-JSON server frames unchanged.
          }
        }
        pageSocket.send(message);
      });
    });

    await studentCheckIn(studentPage, scheduleId, {
      wcode,
      email,
      fullName: "Submission Flow Candidate",
    });
    await completePreCheckIfPresent(studentPage);
    await openStudentSessionWithRetry(studentPage, scheduleId, wcode);
    await expect(studentPage.getByRole("heading", { name: "Waiting for the exam to start" })).toBeVisible();
    await expect.poll(() => websocketHandshakeReceived, { timeout: 15_000 }).toBe(true);

    const runtimeBeforeStart = await readRuntimeState(scheduleId);
    const droppedBeforeStart = droppedScheduleRuntimeFrames;
    dropScheduleRuntimeFrames = true;
    await proctorStartExam(adminContext, scheduleId);
    const startedRuntime = await waitForRuntimeRevision(
      scheduleId,
      Number(runtimeBeforeStart?.revision ?? 0)
    );
    expect(startedRuntime.status).toBe("live");
    expect(startedRuntime.active_section_key).toBe("listening");
    await expectTransitionVisibleWithinFiveSeconds(
      studentPage.getByLabel("Answer for question 1"),
      startedRuntime.committed_at_ms,
      "Proctor Start"
    );
    await expect
      .poll(() => droppedScheduleRuntimeFrames, { timeout: 10_000 })
      .toBeGreaterThan(droppedBeforeStart);

    const startedListening = await executeUpdate(
      `UPDATE exam_session_runtime_sections rs
       JOIN exam_session_runtimes r ON r.id = rs.runtime_id
          SET rs.status = 'live',
              rs.actual_start_at = UTC_TIMESTAMP(6),
              rs.planned_duration_minutes = 1,
              rs.extension_minutes = 0,
              rs.accumulated_paused_seconds = 0
        WHERE r.schedule_id = ?
          AND r.status = 'live'
          AND r.active_section_key = 'listening'
          AND rs.section_key = 'listening'`,
      [scheduleId]
    );
    expect(startedListening).toBe(1);
    await studentPage.getByLabel("Answer for question 1").fill("saved before proctor submit");
    await waitForPersistedAnswer(
      scheduleId,
      email,
      "saved before proctor submit",
      () => responseTransportDiagnostics.join(" | ") || "no V2 response batch observed"
    );
    await waitForSavedBanner(studentPage);

    // Expire the active Listening section without a proctor command. The worker
    // must reconcile the server-owned deadline, preserve the acknowledged answer,
    // and move the same student session into Reading.
    const expiredListeningSection = await executeUpdate(
      `UPDATE exam_session_runtime_sections rs
       JOIN exam_session_runtimes r ON r.id = rs.runtime_id
          SET rs.status = 'live',
              rs.actual_start_at = UTC_TIMESTAMP(6) - INTERVAL 1 MINUTE,
              rs.planned_duration_minutes = 1,
              rs.extension_minutes = 0,
              rs.accumulated_paused_seconds = 0
        WHERE r.schedule_id = ?
          AND r.status = 'live'
          AND r.active_section_key = 'listening'
          AND rs.section_key = 'listening'
      `,
      [scheduleId]
    );
    expect(expiredListeningSection).toBe(1);
    const listeningDeadline = await queryDb<{ deadline_at_ms: number | string }>(
      `SELECT ROUND(UNIX_TIMESTAMP(
                DATE_ADD(rs.actual_start_at, INTERVAL rs.planned_duration_minutes MINUTE)
              ) * 1000) AS deadline_at_ms
         FROM exam_session_runtime_sections rs
         JOIN exam_session_runtimes r ON r.id = rs.runtime_id
        WHERE r.schedule_id = ? AND rs.section_key = 'listening'`,
      [scheduleId]
    );

    const droppedBeforeTimeout = droppedScheduleRuntimeFrames;
    const readingRuntime = await waitForActiveSection(scheduleId, "reading");
    expect(
      Number(readingRuntime.committed_at_ms) - Number(listeningDeadline[0]?.deadline_at_ms),
      "automatic timeout preserves the 3-second answer-save grace"
    ).toBeGreaterThanOrEqual(3_000);
    await expectTransitionVisibleWithinFiveSeconds(
      studentPage.getByText("Write the missing word from the passage."),
      readingRuntime.committed_at_ms,
      "Automatic Listening timeout to Reading"
    );
    await expect
      .poll(() => droppedScheduleRuntimeFrames, { timeout: 10_000 })
      .toBeGreaterThan(droppedBeforeTimeout);
    await waitForPersistedAnswer(
      scheduleId,
      email,
      "saved before proctor submit",
      () => responseTransportDiagnostics.join(" | ") || "no V2 response batch observed"
    );

    // Runtime-backed IELTS delivery has no student Finish action. The
    // authoritative submit is the proctor's final section transition.
    await expect(studentPage.getByRole("button", { name: "Finish" })).toHaveCount(0);
    const runtimeBeforeWriting = await readRuntimeState(scheduleId);
    expect(runtimeBeforeWriting).not.toBeNull();
    const droppedBeforeWriting = droppedScheduleRuntimeFrames;
    await proctorEndSection(adminContext, scheduleId, "reading", "advance reading");
    const writingRuntime = await waitForRuntimeRevision(
      scheduleId,
      Number(runtimeBeforeWriting?.revision ?? 0)
    );
    await expectTransitionVisibleWithinFiveSeconds(
      studentPage.getByText(/Task 1: Summarise/).first(),
      writingRuntime.committed_at_ms,
      "Proctor next-section command to Writing"
    );
    await expect
      .poll(() => droppedScheduleRuntimeFrames, { timeout: 10_000 })
      .toBeGreaterThan(droppedBeforeWriting);

    const runtimeBeforeCompletion = await readRuntimeState(scheduleId);
    expect(runtimeBeforeCompletion).not.toBeNull();
    const droppedBeforeCompletion = droppedScheduleRuntimeFrames;
    await proctorEndSection(adminContext, scheduleId, "writing", "complete exam");

    const completedRuntime = await waitForRuntimeRevision(
      scheduleId,
      Number(runtimeBeforeCompletion?.revision ?? 0)
    );
    expect(completedRuntime.status).toBe("completed");
    await expectTransitionVisibleWithinFiveSeconds(
      studentPage.getByText(/Examination Complete!/i),
      completedRuntime.committed_at_ms,
      "Final section completion"
    );
    await expect
      .poll(() => droppedScheduleRuntimeFrames, { timeout: 10_000 })
      .toBeGreaterThan(droppedBeforeCompletion);
    await expect
      .poll(
        async () => {
          const rows = await queryDb<{ phase: string; submitted_at: string | null }>(
            "SELECT phase, submitted_at FROM student_attempts WHERE schedule_id = ? AND candidate_email = ?",
            [scheduleId, email]
          );
          return (
            rows.length === 1 && rows[0]?.phase === "post-exam" && rows[0].submitted_at !== null
          );
        },
        { timeout: 120_000, message: "Go worker auto-submits the student attempt" }
      )
      .toBe(true);

    await studentContext.close();
    await adminContext.close();
  });
});

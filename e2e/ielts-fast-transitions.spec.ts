import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readBackendE2EManifest } from "./support/backendE2e";
import { executeUpdate, queryDb } from "./support/db";
import { newAdminControlContext, proctorStartExam } from "./support/proctorControls";
import {
  completePreCheckIfPresent,
  openStudentSessionWithRetry,
  studentCheckIn,
  stubScreenDetails,
} from "./support/studentUi";

// Real automatic expiry (plan 2026-10-30 step 7 / PERF-1): deadlines are
// aligned by SQL, but no section is opened by SQL. The worker reconciler
// releases Reading and each browser activates it through /ready. Requires
// VITE_IELTS_FAST_TRANSITIONS=true and an isolated backend fixture database.

type Metric = { name: string; reason?: string | null; latencyMs?: number | null; at: number };
// Epoch milliseconds from SQL. These are TIMESTAMP columns and the helper
// session uses the server's zone, so writes use NOW(6), never UTC_TIMESTAMP().
type Timeline = { state: string; started_ms: number | null; deadline_ms: number | null };

async function timeline(attemptId: string, sectionKey: string): Promise<Timeline | null> {
  const rows = await queryDb<Timeline>(
    `SELECT state,
            ROUND(UNIX_TIMESTAMP(started_at) * 1000) AS started_ms,
            ROUND(UNIX_TIMESTAMP(deadline_at) * 1000) AS deadline_ms
     FROM ielts_attempt_section_timelines
     WHERE attempt_id = ? AND section_key = ?`,
    [attemptId, sectionKey]
  );
  return rows[0] ?? null;
}

async function attemptIdFor(scheduleId: string, wcode: string) {
  const rows = await queryDb<{ id: string }>(
    "SELECT id FROM student_attempts WHERE schedule_id = ? AND wcode = ?",
    [scheduleId, wcode]
  );
  if (!rows[0]) throw new Error(`No attempt was created for ${wcode}.`);
  return rows[0].id;
}

async function collectMetrics(context: BrowserContext) {
  await context.addInitScript(() => {
    const w = window as unknown as { __ieltsMetrics: unknown[] };
    w.__ieltsMetrics = [];
    window.addEventListener("student-observability-metric", (event) => {
      w.__ieltsMetrics.push({ ...(event as CustomEvent).detail, at: Date.now() });
    });
  });
}

async function readMetrics(page: Page): Promise<Metric[]> {
  return page.evaluate(
    () => (window as unknown as { __ieltsMetrics?: Metric[] }).__ieltsMetrics ?? []
  );
}

// The seed's Listening audio is a zero-sample WAV that WebKit never reports
// as playable; swap in 0.1s of 8 kHz 8-bit silence for this run's fixture.
const SEED_AUDIO = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
function silentWavDataUri(samples = 800): string {
  const wav = Buffer.alloc(44 + samples, 0x80);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples, 40);
  return `data:audio/wav;base64,${wav.toString("base64")}`;
}

const ms = (value: number | string | null | undefined) =>
  value === null || value === undefined ? Number.NaN : Number(value);

test.describe("IELTS fast section transitions", () => {
  test.describe.configure({ timeout: 300_000 });

  test("real expiry: a warmed candidate reaches Reading within budget without waiting for a delayed one", async ({
    browser,
  }, testInfo) => {
    const scheduleId = readBackendE2EManifest().student.ieltsPersonalTimingScheduleId;
    const runId = `${Date.now().toString(36).toUpperCase()}${process.pid.toString(36).toUpperCase()}`;
    const fastWcode = `IELTS-${runId}-FAST`;
    const slowWcode = `IELTS-${runId}-SLOW`;
    const fastContext = await browser.newContext({ serviceWorkers: "block" });
    const slowContext = await browser.newContext({ serviceWorkers: "block" });
    await Promise.all([stubScreenDetails(fastContext), stubScreenDetails(slowContext)]);
    await Promise.all([collectMetrics(fastContext), collectMetrics(slowContext)]);
    const fastPage = await fastContext.newPage();
    const slowPage = await slowContext.newPage();
    const adminContext = await newAdminControlContext(browser);
    let slowBlockedReadiness = 0;
    const blockSlowReading = async (route: import("@playwright/test").Route) => {
      slowBlockedReadiness += 1;
      await route.abort("failed");
    };

    try {
      await executeUpdate(
        `UPDATE exam_schedules
         SET start_time = DATE_SUB(NOW(6), INTERVAL 1 HOUR), end_time = DATE_ADD(NOW(6), INTERVAL 4 HOUR)
         WHERE id = ?`,
        [scheduleId]
      );
      await executeUpdate(
        `UPDATE exam_versions
         SET content_snapshot = CAST(REPLACE(CAST(content_snapshot AS CHAR), ?, ?) AS JSON)
         WHERE id = (SELECT published_version_id FROM exam_schedules WHERE id = ?)`,
        [SEED_AUDIO, silentWavDataUri(), scheduleId]
      );
      for (const [page, wcode, name] of [
        [fastPage, fastWcode, "IELTS Fast Candidate"],
        [slowPage, slowWcode, "IELTS Slow Candidate"],
      ] as const) {
        await studentCheckIn(page, scheduleId, {
          wcode,
          email: `e2e+${wcode.toLowerCase()}@example.com`,
          fullName: name,
        });
      }
      await Promise.all([
        openStudentSessionWithRetry(fastPage, scheduleId, fastWcode),
        openStudentSessionWithRetry(slowPage, scheduleId, slowWcode),
      ]);
      await Promise.all([completePreCheckIfPresent(fastPage), completePreCheckIfPresent(slowPage)]);

      await proctorStartExam(adminContext, scheduleId);
      await executeUpdate(
        `UPDATE exam_session_runtime_sections SET planned_duration_minutes = 1
         WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)`,
        [scheduleId]
      );
      await Promise.all([
        fastPage.reload({ waitUntil: "domcontentloaded" }),
        slowPage.reload({ waitUntil: "domcontentloaded" }),
      ]);
      const fastAttemptId = await attemptIdFor(scheduleId, fastWcode);
      const slowAttemptId = await attemptIdFor(scheduleId, slowWcode);
      for (const attemptId of [fastAttemptId, slowAttemptId]) {
        await expect
          .poll(async () => (await timeline(attemptId, "listening"))?.state ?? null, {
            timeout: 30_000,
            message: "Listening starts for both candidates",
          })
          .toBe("active");
      }

      // Align the room and both personal Listening deadlines 25s out, so the
      // 15s preparation window happens on the warmed (reloaded) page.
      await executeUpdate(
        `UPDATE exam_session_runtime_sections
         SET actual_start_at = DATE_SUB(DATE_ADD(NOW(6), INTERVAL 25 SECOND), INTERVAL 60 SECOND)
         WHERE runtime_id = (SELECT id FROM exam_session_runtimes WHERE schedule_id = ?)
           AND section_key = 'listening'`,
        [scheduleId]
      );
      await executeUpdate(
        `UPDATE ielts_attempt_section_timelines t
         JOIN exam_session_runtime_sections rs
           ON rs.runtime_id = t.runtime_id AND rs.section_key = t.section_key
         SET t.deadline_at = DATE_ADD(rs.actual_start_at, INTERVAL 60 SECOND)
         WHERE t.attempt_id IN (?, ?) AND t.section_key = 'listening'`,
        [fastAttemptId, slowAttemptId]
      );
      const alignedDeadline = ms((await timeline(fastAttemptId, "listening"))?.deadline_ms);
      expect(alignedDeadline - Date.now(), "Listening deadline is still ahead").toBeGreaterThan(10_000);
      await slowPage.route("**/sections/reading/ready", blockSlowReading);
      await Promise.all([
        fastPage.reload({ waitUntil: "domcontentloaded" }),
        slowPage.reload({ waitUntil: "domcontentloaded" }),
      ]);

      await expect
        .poll(async () => (await timeline(fastAttemptId, "reading"))?.state ?? null, {
          timeout: 60_000,
          message: "the warmed candidate activates Reading after real expiry",
        })
        .toBe("active");
      const fastAnswer = fastPage.getByLabel(/Answer for question 1/i).first();
      await expect(fastAnswer).toBeVisible({ timeout: 15_000 });
      const usableAtTest = Date.now();

      // Fairness: the delayed candidate had not started when the warmed one did.
      expect((await timeline(slowAttemptId, "reading"))?.state ?? null).not.toBe("active");

      const fastListening = await timeline(fastAttemptId, "listening");
      const fastReading = await timeline(fastAttemptId, "reading");
      const deadline = ms(fastListening?.deadline_ms);
      const started = ms(fastReading?.started_ms);
      expect(ms(fastReading?.deadline_ms) - started, "full assigned Reading duration").toBe(60_000);
      expect(started - deadline, "activation honours the 3s save grace").toBeGreaterThanOrEqual(3_000);

      const metrics = await readMetrics(fastPage);
      const first = (name: string, reason?: string) =>
        metrics.find((m) => m.name === name && (reason === undefined || m.reason === reason))?.at ??
        null;
      const expiryAt = first("ielts_section_expiry", "listening");
      const phases = {
        expiryClient: expiryAt,
        listeningDeadlineServer: deadline,
        boundarySaved: first("ielts_section_boundary_save", "saved"),
        firstReadyRequest: first("ielts_section_ready_request", "reading"),
        activationObserved: first("ielts_section_activation_observed", "reading"),
        firstUsableFrame: first("ielts_section_first_usable_frame", "reading"),
        readingStartedServer: started,
        usableAtTest,
      };
      const relative = Object.fromEntries(
        Object.entries(phases).map(([key, at]) => [key, at === null ? null : at - deadline])
      );
      const report = {
        browser: testInfo.project.name,
        relativeToServerDeadlineMs: relative,
        expiryToUsableMs:
          expiryAt !== null && phases.firstUsableFrame !== null
            ? phases.firstUsableFrame - expiryAt
            : null,
        metrics,
      };
      const out = path.join(testInfo.outputDir, "ielts-transition-trace.json");
      mkdirSync(testInfo.outputDir, { recursive: true });
      writeFileSync(out, JSON.stringify(report, null, 2));
      await testInfo.attach("ielts-transition-trace", { path: out, contentType: "application/json" });
      console.log(`[ielts-transition-trace] ${JSON.stringify({ browser: report.browser, ...relative, expiryToUsableMs: report.expiryToUsableMs })}`);

      for (const key of ["expiryClient", "boundarySaved", "firstReadyRequest", "activationObserved", "firstUsableFrame"] as const) {
        expect(phases[key], `${key} metric recorded`).not.toBeNull();
      }
      // PERF-1 measures the first visible usable surface, not the Playwright
      // polling observation (which can add nearly one poll interval).
      expect(
        phases.firstUsableFrame! - phases.expiryClient!,
        "expiry -> first usable Reading frame",
      ).toBeLessThanOrEqual(5_000);

      // The delayed candidate really was attempting (and blocked) meanwhile.
      await expect
        .poll(() => slowBlockedReadiness, {
          timeout: 20_000,
          message: "the delayed candidate's readiness is exercised while blocked",
        })
        .toBeGreaterThan(0);
      expect((await timeline(slowAttemptId, "reading"))?.state ?? null).not.toBe("active");

      // The delayed candidate then recovers and still gets its full duration.
      await slowPage.unroute("**/sections/reading/ready", blockSlowReading);
      await expect
        .poll(async () => (await timeline(slowAttemptId, "reading"))?.state ?? null, {
          timeout: 30_000,
          message: "the delayed candidate starts Reading after recovering",
        })
        .toBe("active");
      const slowReading = await timeline(slowAttemptId, "reading");
      expect(ms(slowReading?.deadline_ms) - ms(slowReading?.started_ms)).toBe(60_000);
    } finally {
      await adminContext.close();
      await Promise.all([fastContext.close(), slowContext.close()]);
    }
  });
});

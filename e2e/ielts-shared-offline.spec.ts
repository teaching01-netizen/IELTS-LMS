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

// Production-build offline continuity for the shared IELTS timetable
// (docs/superpowers/plans/2026-10-30-ielts-shared-clock-offline-continuity.md
// Task 8). The committed timetable is shortened by SQL before the package is
// prepared, so a real listening -> reading boundary happens with the network
// disabled and a hard page reload. Run through playwright.ielts-offline.config.ts
// (vite preview, service-worker capable origin), never the dev server.

type Metric = { name: string; reason?: string | null; at: number };

async function collectMetrics(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const target = window as unknown as { __ieltsOfflineMetrics: unknown[] };
    target.__ieltsOfflineMetrics = [];
    window.addEventListener("student-observability-metric", (event) => {
      target.__ieltsOfflineMetrics.push({ ...(event as CustomEvent).detail, at: Date.now() });
    });
  });
}

async function metrics(page: Page): Promise<Metric[]> {
  return page.evaluate(
    () => (window as unknown as { __ieltsOfflineMetrics?: Metric[] }).__ieltsOfflineMetrics ?? []
  );
}

async function committedWindows(scheduleId: string): Promise<Array<{ sectionKey: string; startAt: string; deadlineAt: string; saveUntil: string }>> {
  const rows = await queryDb<{ schedule: string }>(
    "SELECT CAST(ielts_shared_schedule AS CHAR) AS schedule FROM exam_session_runtimes WHERE schedule_id = ?",
    [scheduleId]
  );
  if (!rows[0]) return [];
  return (JSON.parse(rows[0].schedule) as { windows: Array<{ sectionKey: string; startAt: string; deadlineAt: string; saveUntil: string }> }).windows;
}

const iso = (at: number) => new Date(at).toISOString();

// The seed's Listening audio is a zero-sample WAV that some engines never
// report as playable; the package refuses unverified audio, so swap in 0.1s of
// 8 kHz 8-bit silence before the student loads the content.
const SEED_AUDIO = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";
function silentWavDataUri(samples = 800): string {
  const wav = Buffer.alloc(44 + samples, 0x80);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + samples, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples, 40);
  return `data:audio/wav;base64,${wav.toString("base64")}`;
}

/** The package the page persisted for this attempt has the expected first deadline. */
async function storedPackageDeadline(page: Page, deadlineAt: string): Promise<boolean> {
  return page.evaluate(async (expected) => {
    const database = await new Promise<IDBDatabase | null>((resolve) => {
      const open = indexedDB.open("warwick_durable_drafts_v1", 1);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => resolve(null);
      open.onblocked = () => resolve(null);
    });
    if (!database) return false;
    const records = await new Promise<Array<{ key: string; value?: { manifest?: { schedule?: { windows?: Array<{ deadlineAt?: string }> } } } }>>((resolve, reject) => {
      const request = database.transaction("drafts", "readonly").objectStore("drafts").getAll();
      request.onsuccess = () => resolve(request.result as typeof records);
      request.onerror = () => reject(request.error);
    });
    database.close();
    const wanted = Date.parse(expected);
    return records.some(
      (record) =>
        record.key.startsWith("ielts-offline-package:") &&
        Date.parse(record.value?.manifest?.schedule?.windows?.[0]?.deadlineAt ?? "") === wanted
    );
  }, deadlineAt);
}

test.describe("IELTS shared timetable offline continuity", () => {
  test.describe.configure({ timeout: 300_000 });

  test("a prepared device crosses a real boundary after an offline hard reload without resetting a clock", async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const scheduleId = manifest.student.ieltsSharedScheduleId;
    test.skip(!scheduleId, "Seed the shared IELTS schedule fixture before running this profile.");

    const runId = `${Date.now().toString(36).toUpperCase()}${process.pid.toString(36).toUpperCase()}`;
    const wcode = `IELTS-OFF-${runId}`;
    const context = await browser.newContext({ serviceWorkers: "allow" });
    await stubScreenDetails(context);
    await collectMetrics(context);
    const page = await context.newPage();
    const adminContext = await newAdminControlContext(browser);
    try {
      await executeUpdate(
        `UPDATE exam_versions
         SET content_snapshot = CAST(REPLACE(CAST(content_snapshot AS CHAR), ?, ?) AS JSON)
         WHERE id = (SELECT published_version_id FROM exam_schedules WHERE id = ?)`,
        [SEED_AUDIO, silentWavDataUri(), scheduleId]
      );
      await studentCheckIn(page, scheduleId, {
        wcode,
        email: `e2e+${wcode.toLowerCase()}@example.com`,
        fullName: "IELTS Offline Candidate",
      });
      await openStudentSessionWithRetry(page, scheduleId, wcode);
      await completePreCheckIfPresent(page);
      await proctorStartExam(adminContext, scheduleId);

      await expect
        .poll(async () => (await committedWindows(scheduleId)).length, {
          timeout: 60_000,
          message: "the room commits its shared timetable at start",
        })
        .toBe(3);
      await expect
        .poll(
          async () => {
            const seen = await metrics(page);
            const preparation = seen.find((m) => m.name === "ielts_offline_preparation");
            if (preparation) return preparation.reason ?? "unknown";
            return seen.find((m) => m.name === "ielts_offline_manifest")?.reason ?? "waiting";
          },
          { timeout: 60_000, message: "the device verifies its initial offline package" }
        )
        .toBe("prepared");

      // Shorten the committed windows, then reload online so the package
      // stores exactly these windows before the network is disabled.
      const now = Date.now();
      const windows = [
        { startAt: iso(now - 5 * 60_000), deadlineAt: iso(now + 25_000), saveUntil: iso(now + 28_000) },
        { startAt: iso(now + 28_000), deadlineAt: iso(now + 88_000), saveUntil: iso(now + 91_000) },
        { startAt: iso(now + 91_000), deadlineAt: iso(now + 151_000), saveUntil: iso(now + 154_000) },
      ];
      for (const [index, window] of windows.entries()) {
        await executeUpdate(
          `UPDATE exam_session_runtimes
           SET ielts_shared_schedule = JSON_SET(
             ielts_shared_schedule,
             '$.scheduleRevision', CAST(JSON_EXTRACT(ielts_shared_schedule, '$.scheduleRevision') AS UNSIGNED) + 1,
             CONCAT('$.windows[', ?, '].startAt'), ?,
             CONCAT('$.windows[', ?, '].deadlineAt'), ?,
             CONCAT('$.windows[', ?, '].saveUntil'), ?
           )
           WHERE schedule_id = ?`,
          [index, window.startAt, index, window.deadlineAt, index, window.saveUntil, scheduleId]
        );
      }

      // Reload online once: the live snapshot now carries the shortened
      // timetable, so the prepared package persists exactly those windows.
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect
        .poll(async () => storedPackageDeadline(page, windows[0]!.deadlineAt), {
          timeout: 30_000,
          message: "the persisted package adopts the amended timetable",
        })
        .toBe(true);
      const answer = page.getByLabel(/Answer for question 1/i).first();
      await expect(answer).toBeVisible({ timeout: 30_000 });
      await answer.fill("offline-retained answer");
      await expect
        .poll(
          async () =>
            (await queryDb<{ revision: number }>(
              "SELECT response_revision AS revision FROM student_attempts WHERE schedule_id = ? AND wcode = ?",
              [scheduleId, wcode]
            ))[0]?.revision ?? 0,
          { timeout: 30_000, message: "the typed answer reaches the server" }
        )
        .toBeGreaterThan(0);

      await expect
        .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker?.controller)), {
          timeout: 30_000,
          message: "the offline shell controls this navigation",
        })
        .toBe(true);
      const remainingBefore = await page.getByTestId("student-time-remaining").first().textContent();
      const secondsBefore = Number((remainingBefore ?? "0:00").split(":").at(-1)) || 0;
      expect(secondsBefore).toBeLessThanOrEqual(60);

      await context.setOffline(true);
      await page.reload({ waitUntil: "domcontentloaded" });

      await expect(page.getByTestId("ielts-offline-status")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText(/offline/i).first()).toBeVisible();
      await expect(answer).toHaveValue("offline-retained answer");
      // A download failure is silent. Only real offline/save state may appear;
      // there is no failure copy and no student retry control.
      await expect(page.getByRole("button", { name: /try again/i })).toHaveCount(0);
      await expect(page.getByText(/isn't ready to work offline|couldn't be saved on this device/i)).toHaveCount(0);
      const remainingAfter = await page.getByTestId("student-time-remaining").first().textContent();
      const secondsAfter = Number((remainingAfter ?? "0:00").split(":").at(-1)) || 0;
      expect(secondsAfter, "the offline reload never restarts the committed clock").toBeLessThanOrEqual(
        secondsBefore + 5
      );

      // The cached timetable opens Reading at the committed instant with the
      // network disabled: no /ready, no new duration, no server round trip.
      await expect(page.getByText("Backend E2E Passage")).toBeVisible({ timeout: 90_000 });
      await expect(page.getByLabel(/Answer for question 1/i).first()).toBeVisible();
      expect((await committedWindows(scheduleId))[1]?.sectionKey).toBe("reading");
      expect((await metrics(page)).some((m) => m.name === "ielts_clock_uncertain")).toBe(true);

      await testInfo.attach("offline-continuity-metrics", {
        body: JSON.stringify(await metrics(page), null, 2),
        contentType: "application/json",
      });
    } finally {
      await context.setOffline(false).catch(() => undefined);
      await adminContext.close();
      await context.close();
    }
  });
});

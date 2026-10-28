import { expect, test, type Page } from "@playwright/test";
import { appendFileSync } from "node:fs";
import { installStaffParityTransport, PARITY_NOW, scaledProctorRoom } from "./support/staffParityTransport";

/**
 * Staff interaction profile (rewrite plan, Package 8).
 *
 * Runs the three representative staff interactions against a production
 * build with 4x CPU throttling and the database-free fixture transport, and
 * records long-task time, the slowest input event (an INP proxy), and API
 * requests per interaction. Run it on the Package 0 commit and on HEAD with
 * STAFF_PERF_OUT set to compare; the budgets below only catch gross regressions.
 */

const ROOM_SIZE = 300;
const TYPED = "The passage argues that coastal cities must adapt.";

interface Sample {
  scenario: string;
  longTaskMs: number;
  maxEventMs: number;
  requests: number;
}

async function instrument(page: Page) {
  await page.addInitScript(() => {
    const perf = { longTaskMs: 0, maxEventMs: 0 };
    (window as unknown as { __staffPerf: typeof perf }).__staffPerf = perf;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) perf.longTaskMs += entry.duration;
    }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) perf.maxEventMs = Math.max(perf.maxEventMs, entry.duration);
    }).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
  });
}

async function measure(page: Page, requests: string[], scenario: string, interact: () => Promise<void>): Promise<Sample> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.evaluate(() => {
    const perf = (window as unknown as { __staffPerf: { longTaskMs: number; maxEventMs: number } }).__staffPerf;
    perf.longTaskMs = 0;
    perf.maxEventMs = 0;
  });
  const before = requests.length;
  await interact();
  // Let debounced saves, polls, and trailing renders land inside the window.
  await page.waitForTimeout(2_000);
  const perf = await page.evaluate(() => (window as unknown as { __staffPerf: { longTaskMs: number; maxEventMs: number } }).__staffPerf);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const sample = { scenario, longTaskMs: Math.round(perf.longTaskMs), maxEventMs: Math.round(perf.maxEventMs), requests: requests.length - before };
  if (process.env.STAFF_PERF_OUT) appendFileSync(process.env.STAFF_PERF_OUT, `${JSON.stringify(sample)}\n`);
  return sample;
}

async function open(page: Page, path: string, ready: string) {
  await page.clock.setFixedTime(new Date(PARITY_NOW));
  await instrument(page);
  const transport = await installStaffParityTransport(page, "admin");
  await page.setViewportSize({ width: 1440, height: 900 });
  return { transport, go: async () => {
    await page.goto(path);
    await expect(page.getByText(ready).locator("visible=true").first()).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState("networkidle").catch(() => undefined);
  } };
}

test.describe("staff interaction profile", () => {
  test("SAT authoring typing", async ({ page }) => {
    const { transport, go } = await open(page, "/sat/exams/sat-exam-1", "Question 1");
    await go();
    const editor = page.locator('[contenteditable="true"]').locator("visible=true").first();
    await editor.click();
    const sample = await measure(page, transport.requests, "sat-authoring-typing", () => editor.pressSequentially(TYPED));
    await expect(editor).toContainText(TYPED);
    expect(sample.maxEventMs).toBeLessThan(500);
  });

  test("large-room proctor monitoring", async ({ page }) => {
    const { transport, go } = await open(page, "/proctor", "Cohorts and students");
    await page.route((url) => url.pathname === "/api/v1/proctor/sessions/ielts-schedule-1", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: scaledProctorRoom("ielts", ROOM_SIZE) }));
    await go();
    await page.getByText("Monitor Session").locator("visible=true").first().click();
    await expect(page.getByText(`${ROOM_SIZE} visible students`).locator("visible=true").first()).toBeVisible({ timeout: 30_000 });
    const search = page.getByRole("textbox", { name: "Search students" });
    const sample = await measure(page, transport.requests, "proctor-room-300-search", async () => {
      await search.pressSequentially("Student 29");
      await search.fill("");
    });
    expect(sample.maxEventMs).toBeLessThan(1_000);
  });

  test("grading review typing", async ({ page }) => {
    const { transport, go } = await open(page, "/admin/grading", "Grading Queue");
    await go();
    await page.getByRole("button", { name: "Open grading session for IELTS Academic Mock 04" }).first().click();
    await page.getByRole("button", { name: "Review" }).first().click();
    const feedback = page.getByPlaceholder("Summary feedback visible to student...");
    await feedback.fill("");
    const sample = await measure(page, transport.requests, "grading-review-typing", () => feedback.pressSequentially(TYPED));
    await expect(feedback).toHaveValue(TYPED);
    expect(sample.maxEventMs).toBeLessThan(500);
  });
});

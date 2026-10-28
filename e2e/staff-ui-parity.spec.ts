import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { installStaffParityTransport, PARITY_NOW, type StaffRole } from "./support/staffParityTransport";

/**
 * Staff UI parity references (rewrite plan, Package 0).
 *
 * Freezes the rendered staff design before state/orchestration work so any
 * visual drift fails loudly. Data, clock, timezone, browser, and motion are
 * pinned by `playwright.staff-parity.config.ts` and the fixture transport.
 * A design difference fails the slice; never update these references to
 * accept one silently.
 *
 * Excluded on purpose: `/builder/:examId/preview` renders the student
 * delivery surface, which has its own visual suites.
 */

interface Surface {
  name: string;
  path: string;
  role?: StaffRole;
  /** Text that proves the populated page (not a loading/error state) rendered. */
  ready: string | RegExp;
  /** Optional drill-in after the page loads. */
  open?: (page: Page) => Promise<void>;
}

const SURFACES: Surface[] = [
  // IELTS administration
  { name: "ielts-exams", path: "/admin/exams", ready: "IELTS Academic Mock 04" },
  { name: "ielts-library", path: "/admin/library", ready: "Content Library" },
  { name: "ielts-scheduling", path: "/admin/scheduling", ready: "Cohort A — Morning" },
  { name: "ielts-grading-queue", path: "/admin/grading", ready: "Grading Queue" },
  {
    name: "ielts-grading-session",
    path: "/admin/grading",
    ready: "Grading Queue",
    open: async (page) => {
      await page.getByRole("button", { name: "Open grading session for IELTS Academic Mock 04" }).first().click();
      await expect(visibleText(page, "Becky Tran")).toBeVisible();
    },
  },
  {
    name: "ielts-grading-review",
    path: "/admin/grading",
    ready: "Grading Queue",
    open: async (page) => {
      await page.getByRole("button", { name: "Open grading session for IELTS Academic Mock 04" }).first().click();
      await page.getByRole("button", { name: "Review" }).first().click();
      await expect(visibleText(page, "Ananda Srisuk")).toBeVisible();
    },
  },
  { name: "ielts-results", path: "/admin/results", ready: "Results & Analytics" },
  { name: "ielts-settings", path: "/admin/settings", ready: "Global Exam Defaults" },
  // IELTS authoring
  { name: "ielts-config", path: "/builder/ielts-exam-1", ready: "Exam Configuration" },
  { name: "ielts-builder", path: "/builder/ielts-exam-1/builder", ready: "CONTENT AUTHORING" },
  { name: "ielts-review", path: "/builder/ielts-exam-1/review", ready: "Review & Publish" },
  // IELTS proctoring
  { name: "ielts-proctor", path: "/proctor", ready: "Cohorts and students" },
  {
    name: "ielts-proctor-cohort",
    path: "/proctor",
    ready: "Cohorts and students",
    open: async (page) => {
      await visibleText(page, "Monitor Session").click();
      await expect(visibleText(page, "3 visible students")).toBeVisible();
    },
  },
  // SAT workspace
  { name: "sat-exams", path: "/sat/exams", ready: "Author Digital SAT practice exams" },
  { name: "sat-rooms", path: "/sat/sessions", ready: "Every room across exams" },
  { name: "sat-room", path: "/sat/sessions/sat-schedule-1", ready: "Ananda S." },
  { name: "sat-responses", path: "/sat/results", ready: "Review student attempts" },
  { name: "sat-forms", path: "/sat/forms", ready: "Registration, section entry and Eva SIM responses" },
  { name: "sat-score-conversion", path: "/sat/score-conversion", ready: "Global SAT settings" },
  { name: "sat-authoring", path: "/sat/exams/sat-exam-1", ready: "Question 1" },
  { name: "sat-exam-settings", path: "/sat/exams/sat-exam-1/settings", ready: "Module timing" },
  { name: "sat-exam-rooms", path: "/sat/exams/sat-exam-1/access", ready: "No rooms yet" },
  { name: "sat-exam-responses", path: "/sat/exams/sat-exam-1/responses", ready: "Download room responses" },
];

const WIDTHS = [390, 768, 1440] as const;

/** First visible match: several staff views keep print-only copies of names. */
function visibleText(page: Page, text: string | RegExp) {
  return page.getByText(text).locator("visible=true").first();
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // Let in-flight fixture reads and entry transitions finish before capture.
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(400);
}

async function openSurface(page: Page, surface: Surface, width: number) {
  await page.clock.setFixedTime(new Date(PARITY_NOW));
  const transport = await installStaffParityTransport(page, surface.role ?? "admin");
  await page.setViewportSize({ width, height: 900 });
  await page.goto(surface.path);
  await expect(visibleText(page, surface.ready)).toBeVisible({ timeout: 20_000 });
  if (surface.open) await surface.open(page);
  await settle(page);
  return transport;
}

test.describe("staff UI parity", () => {
  for (const surface of SURFACES) {
    for (const width of WIDTHS) {
      test(`${surface.name} @${width}`, async ({ page }) => {
        await openSurface(page, surface, width);
        await expect(page).toHaveScreenshot(`${surface.name}-${width}.png`, { fullPage: true });
      });
    }
  }
});

test.describe("staff UI parity: critical dialogs", () => {
  test("IELTS create exam dialog", async ({ page }) => {
    await openSurface(page, SURFACES.find((surface) => surface.name === "ielts-exams")!, 1440);
    await page.getByRole("button", { name: "Create Exam" }).first().click();
    await expect(page.getByRole("heading", { name: "Create New Exam" })).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot("dialog-ielts-create-exam-1440.png");
  });

  test("SAT room end-exam confirmation", async ({ page }) => {
    await openSurface(page, SURFACES.find((surface) => surface.name === "sat-room")!, 1440);
    await page.getByRole("button", { name: "More" }).first().click();
    await page.getByRole("menuitem", { name: "End exam" }).click();
    await expect(page.getByRole("dialog").or(page.getByRole("alertdialog")).first()).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot("dialog-sat-room-end-exam-1440.png");
  });

  test("SAT create exam sheet", async ({ page }) => {
    await openSurface(page, SURFACES.find((surface) => surface.name === "sat-exams")!, 1440);
    await page.getByRole("button", { name: "Create exam" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await settle(page);
    await expect(page).toHaveScreenshot("dialog-sat-create-exam-1440.png");
  });
});

test.describe("staff UI parity: reflow and focus", () => {
  // 200% zoom of a 1440px window lays out at 720 CSS px.
  for (const name of ["ielts-grading-review", "ielts-proctor-cohort", "sat-room", "sat-authoring"]) {
    test(`${name} @200% zoom reflow`, async ({ page }) => {
      const surface = SURFACES.find((candidate) => candidate.name === name)!;
      await openSurface(page, surface, 720);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${name} must not scroll horizontally at 200% zoom`).toBeLessThanOrEqual(1);
      await expect(page).toHaveScreenshot(`${name}-zoom200.png`, { fullPage: true });
    });
  }

  for (const name of ["ielts-grading-queue", "ielts-proctor", "sat-rooms"]) {
    test(`${name} first keyboard focus`, async ({ page }) => {
      await openSurface(page, SURFACES.find((candidate) => candidate.name === name)!, 1440);
      await page.keyboard.press("Tab");
      const focused = page.locator(":focus");
      await expect(focused).toHaveCount(1);
      await expect(page).toHaveScreenshot(`${name}-first-focus.png`);
    });
  }
});

test.describe("staff UI parity: network baseline", () => {
  // The set of reads and the exact writes a plain visit makes are part of
  // the reference: new, removed, or duplicated calls show up as a diff.
  for (const surface of SURFACES) {
    test(`${surface.name} requests`, async ({ page }) => {
      const transport = await openSurface(page, surface, 1440);
      const reads = [...new Set(transport.requests.filter((request) => request.startsWith("GET ")).map((request) => request.split("?")[0]))].sort();
      const writes = transport.requests.filter((request) => !request.startsWith("GET ")).map((request) => request.split("?")[0]);
      expect(`reads:\n${reads.join("\n")}\nwrites:\n${writes.join("\n")}\n`).toMatchSnapshot(`${surface.name}-requests.txt`);
      expect(transport.unhandled).toEqual([]);
    });
  }
});

test("ielts-config preserves and resolves a concurrent edit through the existing retry surface", async ({ page }) => {
  const state = JSON.parse(readFileSync(resolve(process.cwd(), "e2e/fixtures/staff-parity/ielts-exam-state.json"), "utf8"));
  let version = {
    id: "ielts-version-2", examId: "ielts-exam-1", versionNumber: 2, parentVersionId: "ielts-version-1",
    contentSnapshot: state, configSnapshot: state.config, createdBy: "admin-1", createdAt: PARITY_NOW,
    isDraft: true, isPublished: false, revision: 3,
  };
  const revisions: number[] = [];
  await page.clock.setFixedTime(new Date(PARITY_NOW));
  await installStaffParityTransport(page, "admin");
  await page.route("**/api/v1/versions/ielts-version-2", async (route) => {
    await route.fulfill({ json: { success: true, data: version } });
  });
  await page.route("**/api/v1/exams/ielts-exam-1/draft", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    const body = route.request().postDataJSON();
    revisions.push(body.revision);
    if (revisions.length === 1) {
      const remoteConfig = { ...state.config, general: { ...state.config.general, title: "Remote title" } };
      version = { ...version, revision: 4, configSnapshot: remoteConfig, contentSnapshot: { ...state, config: remoteConfig } };
      await route.fulfill({ status: 409, json: { success: false, error: { code: "CONFLICT", message: "Draft changed while you were editing" } } });
      return;
    }
    version = { ...version, revision: 5, configSnapshot: body.configSnapshot, contentSnapshot: body.contentSnapshot };
    await route.fulfill({ json: { success: true, data: version } });
  });
  await page.goto("/builder/ielts-exam-1");
  const title = page.getByPlaceholder("e.g. Academic Practice Test 5");
  await title.fill("Local title");
  await page.getByRole("button", { name: "Save Draft" }).click();
  await expect(page.getByText("Draft changed while you were editing")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText(/Configuration changed elsewhere/)).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(title).toHaveValue("Local title");
  await title.fill("Remote title");
  await title.fill("Chosen title");
  await page.getByRole("button", { name: "Save Draft" }).click();
  await expect.poll(() => revisions).toEqual([3, 4]);
  await expect(title).toHaveValue("Chosen title");
});

/**
 * Route accounting (Package 7 gate): every staff route in the route/role
 * matrix either has a parity reference above or must at least render here
 * without a page error or the route error boundary. No screenshots: these
 * routes had no pre-change reference to compare against.
 */
const UNREFERENCED_ROUTES: Array<{ path: string; role?: StaffRole }> = [
  { path: "/admin" },
  { path: "/admin/answer-history/submission-1" },
  { path: "/sat" },
  { path: "/sat/results/attempts/sat-attempt-1" },
  { path: "/sat/results/result-1" },
  { path: "/sat/exams/sat-exam-1/release" },
  { path: "/sat/exams/sat-exam-1/preview" },
  { path: "/builder/ielts-exam-1/answer-key" },
  { path: "/proctor/answer-history/sat-attempt-1" },
];

test.describe("staff routes: every matrix entry renders", () => {
  for (const route of UNREFERENCED_ROUTES) {
    test(`${route.path} renders without a route error`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await page.clock.setFixedTime(new Date(PARITY_NOW));
      await installStaffParityTransport(page, route.role ?? "admin");
      await page.goto(route.path);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await expect(page.locator("main, [role='main'], #root > *").first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);
      expect(page.url()).not.toContain("/login");
      expect(pageErrors).toEqual([]);
    });
  }
});

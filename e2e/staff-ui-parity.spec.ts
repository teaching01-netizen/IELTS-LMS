import { expect, test, type Page } from "@playwright/test";
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

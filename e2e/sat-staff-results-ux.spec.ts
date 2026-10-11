import { expect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeViolations } from "./support/axeAudit";

const TEST_START = "2026-10-11T02:05:00.000Z";
const EXAM_ID = "sat-results-ux-1";
const SCHEDULE_ID = "sat-results-room-1";
const ATTEMPT_ID = "sat-results-attempt-1";

const ACCESS_GROUP = {
  scheduleId: SCHEDULE_ID,
  accessLinkId: "sat-results-link-1",
  accessLinkName: "Morning room",
  accessLinkState: "active",
  examId: EXAM_ID,
  examTitle: "Practice Test 06",
  versionNumber: 3,
  cohortName: "Monday group",
  attemptCount: 1,
  submittedCount: 0,
  scoredCount: 0,
  pendingCount: 0,
  invalidatedCount: 0,
  latestSubmittedAt: null,
  latestTestStartedAt: TEST_START,
  earliestTestStartedAt: TEST_START,
  completedCount: 0,
  runningCount: 1,
  endedCount: 0,
  otherCount: 0,
};

const ATTEMPT_PAGE = {
  items: [{
    resultId: null,
    attemptId: ATTEMPT_ID,
    attemptStatus: "running",
    outcomeStatus: "unscored",
    releaseStatus: "",
    totalScore: null,
    scheduleId: SCHEDULE_ID,
    examId: EXAM_ID,
    examTitle: "Practice Test 06",
    versionNumber: 3,
    studentId: "candidate-1",
    studentName: "Ananda S.",
    studentEmail: null,
    cohortName: "Monday group",
    submittedAt: null,
    testStartedAt: TEST_START,
  }],
  total: 1,
  offset: 0,
  limit: 50,
  hasMore: false,
};

const SAVED_ANSWERS = {
  attemptId: ATTEMPT_ID,
  examTitle: "Practice Test 06",
  versionNumber: 3,
  studentId: "candidate-1",
  studentName: "Ananda S.",
  cohortName: "Monday group",
  status: "running",
  protocolVersion: 2,
  responseRevision: 4,
  savedAnswerCount: 1,
  lastSavedAt: TEST_START,
  testStartedAt: TEST_START,
  questions: [{
    questionId: "sat-question-1",
    sectionKey: "reading-writing",
    moduleKey: "rw-module-1",
    displayOrder: 1,
    response: "B",
    markedForReview: false,
  }],
};

interface ResultsRecording {
  attemptRequests: URL[];
  answerRequests: number;
  pageErrors: string[];
}

async function installResultsTransport(page: Page, role = "grader"): Promise<ResultsRecording> {
  const recording: ResultsRecording = { attemptRequests: [], answerRequests: 0, pageErrors: [] };
  page.on("pageerror", (error) => recording.pageErrors.push(error.message));

  // The result routes use the shipped query/cache and inspector; only the
  // transport is replaced so this browser test stays independent of a DB.
  await page.route("**/api/v1/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "x-csrf-token": "csrf-results-ux" },
    body: JSON.stringify({ success: true, data: {} }),
  }));
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "x-csrf-token": "csrf-results-ux" },
    body: JSON.stringify({
      success: true,
      data: {
        user: { id: `${role}-1`, email: `${role}@example.test`, displayName: `Dana ${role}`, role, state: "active" },
        csrfToken: "csrf-results-ux",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    }),
  }));
  await page.route("**/api/v1/results/sat/access-groups", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, data: [ACCESS_GROUP] }),
  }));
  await page.route("**/api/v1/results/sat/attempts?**", async (route) => {
    recording.attemptRequests.push(new URL(route.request().url()));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: ATTEMPT_PAGE }),
    });
  });
  await page.route(`**/api/v1/results/sat/attempts/${ATTEMPT_ID}/answers`, async (route) => {
    recording.answerRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: SAVED_ANSWERS }),
    });
  });
  return recording;
}

test.describe("SAT staff response review", () => {
  for (const access of [
    { role: "admin", visible: ["Exams", "Rooms", "Responses"], hidden: [] },
    { role: "builder", visible: ["Exams"], hidden: ["Rooms", "Responses"] },
    { role: "proctor", visible: ["Rooms", "Responses"], hidden: ["Exams"] },
    { role: "grader", visible: ["Responses"], hidden: ["Exams", "Rooms"] },
  ]) {
    test(`${access.role} sees only the role-appropriate SAT destinations`, async ({ page }) => {
      await installResultsTransport(page, access.role);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/sat/results");

      for (const label of access.visible) {
        await expect(page.getByRole("link", { name: label, exact: true })).toBeVisible();
      }
      for (const label of access.hidden) {
        await expect(page.getByRole("link", { name: label, exact: true })).toHaveCount(0);
      }
    });
  }

  test("preserves response filters when inspecting an attempt and when refreshing a shared URL", async ({ page }) => {
    const recording = await installResultsTransport(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    const listUrl = new URL("/sat/results", "http://127.0.0.1:3000");
    listUrl.searchParams.set("exam", EXAM_ID);
    listUrl.searchParams.set("access", SCHEDULE_ID);
    listUrl.searchParams.set("status", "running");
    listUrl.searchParams.set("from", "2026-10-11");
    listUrl.searchParams.set("to", "2026-10-11");
    await page.goto(listUrl.pathname + listUrl.search);

    await expect(page.getByRole("heading", { level: 1, name: "Morning room" })).toBeVisible();
    const studentSearch = page.getByRole("searchbox", { name: "Search students" });
    await studentSearch.fill("Ananda");
    const row = page.getByRole("button", { name: /View saved answers for Ananda S\., In progress/ });
    await expect(row).toBeVisible();
    await expectNoSeriousAxeViolations(page, "SAT filtered responses list");

    const filteredRequest = recording.attemptRequests.find((request) => request.searchParams.get("q") === "Ananda");
    expect(filteredRequest?.searchParams.get("status")).toBe("running");
    expect(filteredRequest?.searchParams.get("from")).toBe("2026-10-10T17:00:00.000Z");
    expect(filteredRequest?.searchParams.get("to")).toBe("2026-10-11T17:00:00.000Z");

    await row.click();
    const inspector = page.getByRole("dialog", { name: "Student response" });
    await expect(inspector).toBeVisible();
    await expect(inspector).toContainText("Ananda S.");
    await expect(inspector).toContainText("1 answer");
    await expect(inspector).toContainText("B");
    await expectNoSeriousAxeViolations(page, "SAT response inspector");
    const shareUrl = page.url();
    const shared = new URL(shareUrl);
    expect(shared.searchParams.get("q")).toBe("Ananda");
    expect(shared.searchParams.get("status")).toBe("running");
    expect(shared.searchParams.get("from")).toBe("2026-10-11");
    expect(shared.searchParams.get("to")).toBe("2026-10-11");
    expect(shared.searchParams.get("attempt")).toBe(ATTEMPT_ID);

    await page.reload();
    const refreshedInspector = page.getByRole("dialog", { name: "Student response" });
    await expect(refreshedInspector).toBeVisible();
    await expect(refreshedInspector).toContainText("Ananda S.");
    await page.keyboard.press("Escape");
    await expect(refreshedInspector).toHaveCount(0);

    const returned = new URL(page.url());
    expect(returned.searchParams.get("exam")).toBe(EXAM_ID);
    expect(returned.searchParams.get("access")).toBe(SCHEDULE_ID);
    expect(returned.searchParams.get("q")).toBe("Ananda");
    expect(returned.searchParams.get("status")).toBe("running");
    expect(returned.searchParams.get("from")).toBe("2026-10-11");
    expect(returned.searchParams.get("to")).toBe("2026-10-11");
    await expect(row).toBeFocused();
    expect(recording.answerRequests).toBeGreaterThanOrEqual(2);
    expect(recording.pageErrors).toEqual([]);
  });
});

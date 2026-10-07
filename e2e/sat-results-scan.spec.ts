import { expect, test, type Route } from "@playwright/test";

test.use({ timezoneId: "UTC" });

type AttemptFixture = {
  resultId: string | null;
  attemptId: string;
  outcomeStatus: "scored" | "invalidated_proctor" | "unscored";
  attemptStatus: string;
  releaseStatus: string;
  totalScore: number | null;
  scheduleId: string;
  examId: string;
  examTitle: string;
  versionNumber: number;
  studentId: string;
  studentName: string;
  studentEmail: string | null;
  cohortName: string;
  submittedAt: string | null;
  testStartedAt: string | null;
};

const attempts: AttemptFixture[] = [
  { resultId: "result-mina", attemptId: "attempt-mina", outcomeStatus: "scored", attemptStatus: "submitted", releaseStatus: "ready", totalScore: null, scheduleId: "access-e2e", examId: "exam-e2e", examTitle: "SAT Practice 04", versionNumber: 3, studentId: "ST-1042", studentName: "Mina Chen", studentEmail: null, cohortName: "Class A", submittedAt: "2026-10-07T11:18:00Z", testStartedAt: "2026-10-07T09:03:00Z" },
  { resultId: null, attemptId: "attempt-mina-second", outcomeStatus: "unscored", attemptStatus: "running", releaseStatus: "", totalScore: null, scheduleId: "access-e2e", examId: "exam-e2e", examTitle: "SAT Practice 04", versionNumber: 3, studentId: "ST-1042", studentName: "Mina Chen", studentEmail: null, cohortName: "Class A", submittedAt: null, testStartedAt: "2026-10-06T09:01:00Z" },
  { resultId: "result-lee", attemptId: "attempt-lee", outcomeStatus: "invalidated_proctor", attemptStatus: "terminated", releaseStatus: "invalidated", totalScore: null, scheduleId: "access-e2e", examId: "exam-e2e", examTitle: "SAT Practice 04", versionNumber: 3, studentId: "ST-1043", studentName: "Arun Lee", studentEmail: null, cohortName: "Class A", submittedAt: "2026-10-06T10:15:00Z", testStartedAt: "2026-10-06T09:05:00Z" },
];

async function fulfillJson(route: Route, data: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", json: { success: true, data } });
}

function matchesStatus(attempt: AttemptFixture, status: string): boolean {
  if (!status || status === "all") return true;
  if (status === "completed") return attempt.submittedAt !== null;
  if (status === "running") return attempt.attemptStatus === "running" || attempt.attemptStatus === "paused";
  if (status === "ended") return attempt.attemptStatus === "terminated" || attempt.attemptStatus === "locked" || attempt.outcomeStatus.startsWith("invalidated_");
  return false;
}

function matchesRequest(attempt: AttemptFixture, url: URL): boolean {
  const needle = (url.searchParams.get("q") ?? "").toLocaleLowerCase();
  const start = attempt.testStartedAt ? Date.parse(attempt.testStartedAt) : null;
  const from = url.searchParams.has("from") ? Date.parse(url.searchParams.get("from") ?? "") : null;
  const to = url.searchParams.has("to") ? Date.parse(url.searchParams.get("to") ?? "") : null;
  return (needle === "" || `${attempt.studentName} ${attempt.studentId} ${attempt.cohortName}`.toLocaleLowerCase().includes(needle)) &&
    matchesStatus(attempt, url.searchParams.get("status") ?? "all") &&
    (from === null || (start !== null && start >= from)) &&
    (to === null || (start !== null && start < to));
}

test("SAT results scan, filter, review saved answers, and return with list state intact", async ({ page }) => {
  const requestUrls: string[] = [];
  await page.route("**/api/v1/auth/session", (route) => fulfillJson(route, {
    user: { id: "e2e-admin", email: "sat-results@example.test", displayName: "SAT Results E2E", role: "admin", state: "active" },
    csrfToken: "e2e-csrf-token",
    expiresAt: "2099-01-01T00:00:00Z",
  }));
  await page.route("**/api/v1/results/sat/access-groups", (route) => fulfillJson(route, [{
    scheduleId: "access-e2e", accessLinkId: "link-e2e", accessLinkName: "Wednesday morning", accessLinkState: "active",
    examId: "exam-e2e", examTitle: "SAT Practice 04", versionNumber: 3, cohortName: "Class A",
    attemptCount: 3, submittedCount: 2, scoredCount: 1, pendingCount: 0, invalidatedCount: 1,
    latestSubmittedAt: "2026-10-07T11:18:00Z", latestTestStartedAt: "2026-10-07T09:03:00Z", earliestTestStartedAt: "2026-10-06T09:01:00Z",
    completedCount: 1, runningCount: 1, endedCount: 1, otherCount: 0,
  }]));
  await page.route("**/api/v1/results/sat/attempts?**", async (route) => {
    const url = new URL(route.request().url());
    requestUrls.push(url.toString());
    const filtered = attempts.filter((attempt) => matchesRequest(attempt, url));
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    await fulfillJson(route, { items: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit, hasMore: offset + limit < filtered.length });
  });
  await page.route("**/api/v1/results/sat/attempts/attempt-mina-second/answers", (route) => fulfillJson(route, {
    attemptId: "attempt-mina-second", examTitle: "SAT Practice 04", versionNumber: 3, studentId: "ST-1042", studentName: "Mina Chen", cohortName: "Class A",
    status: "running", protocolVersion: 2, responseRevision: 4, savedAnswerCount: 1, lastSavedAt: "2026-10-06T10:00:00Z",
    testStartedAt: "2026-10-06T09:01:00Z", submittedAt: null,
    questions: [{ questionId: "RW-12", sectionKey: "reading-writing", moduleKey: "rw-module-1", displayOrder: 12, response: "B", markedForReview: false }],
  }));

  await page.goto("/sat/results");
  await expect(page.getByRole("heading", { name: "SAT results" })).toBeVisible();
  await expect(page.getByText("Latest test", { exact: true })).toBeVisible();
  await expect(page.getByText("Wed, 7 Oct 2026")).toBeVisible();
  await page.getByRole("button", { name: /SAT Practice 04/ }).click();
  await expect(page.getByRole("heading", { name: "SAT Practice 04" })).toBeVisible();
  await expect(page.getByText(/1 completed · 1 running · 1 ended/)).toBeVisible();
  await page.getByRole("button", { name: /Wednesday morning/ }).click();

  await expect(page.getByRole("heading", { name: "Wednesday morning" })).toBeVisible();
  await expect(page.getByText("Test dates: Tue, 6 Oct 2026 – Wed, 7 Oct 2026")).toBeVisible();
  await expect(page.getByText("Test started", { exact: true })).toBeVisible();
  await expect(page.getByText("3 attempts")).toBeVisible();
  await page.getByLabel("Search students").fill("Mina");
  await page.getByLabel("Status").selectOption("running");
  await page.getByLabel("Test date from").fill("2026-10-06");
  await page.getByLabel("Test date to").fill("2026-10-06");

  await expect(page.getByRole("button", { name: /Mina Chen.*ST-1042.*In progress/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Arun Lee/ })).toHaveCount(0);
  await expect(page.getByText("1–1 of 1 matching attempts")).toBeVisible();
  await expect.poll(() => new URL(requestUrls.at(-1) ?? "http://localhost").searchParams.get("status")).toBe("running");
  const filteredUrl = new URL(requestUrls.at(-1) ?? "http://localhost");
  expect(filteredUrl.searchParams.get("q")).toBe("Mina");
  expect(filteredUrl.searchParams.get("from")).toBeTruthy();
  expect(filteredUrl.searchParams.get("to")).toBeTruthy();

  await page.getByRole("button", { name: /Mina Chen.*In progress/ }).click();
  await expect(page.getByRole("heading", { name: "Mina Chen" })).toBeVisible();
  await expect(page.getByText("Test started: Tue, 6 Oct 2026 · 09:01")).toBeVisible();
  await expect(page.getByText("Submitted: Not submitted")).toBeVisible();
  await expect(page.getByText("Only answers accepted by the server appear here.")).toBeVisible();
  await page.getByRole("button", { name: "Back to SAT results" }).click();
  await expect(page).toHaveURL(/\/sat\/results\?exam=exam-e2e&access=access-e2e&q=Mina&status=running&from=2026-10-06&to=2026-10-06/);
  await expect(page.getByText("1–1 of 1 matching attempts")).toBeVisible();
});

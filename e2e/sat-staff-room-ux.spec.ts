import { expect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeViolations } from "./support/axeAudit";

const NOW = "2026-10-11T02:05:00.000Z";
const SCHEDULE = {
  id: "sched-ux-1",
  examId: "sat-ux-1",
  providerKey: "sat",
  examTitle: "Practice Test 06",
  publishedVersionId: "version-3",
  publishScope: "full",
  cohortName: "Morning room",
  startTime: "2026-10-11T02:00:00.000Z",
  endTime: "2026-10-11T06:00:00.000Z",
  plannedDurationMinutes: 180,
  deliveryMode: "proctor_start",
  recurrenceType: "none",
  recurrenceInterval: 1,
  recurrenceEndDate: null,
  bufferBeforeMinutes: null,
  bufferAfterMinutes: null,
  autoStart: false,
  autoStop: false,
  status: "live",
  createdAt: NOW,
  createdBy: "staff-1",
  updatedAt: NOW,
  revision: 7,
};
const RUNTIME = {
  id: "runtime-ux-1",
  scheduleId: SCHEDULE.id,
  examId: SCHEDULE.examId,
  providerKey: "sat",
  status: "live",
  timingModel: "cohort_section_v3",
  revision: 7,
  actualStartAt: NOW,
  actualEndAt: null,
  activeSectionKey: "reading-writing",
  currentSectionKey: "reading-writing",
  currentSectionRemainingSeconds: 1500,
  currentSectionDeadlineAt: "2026-10-11T02:30:00.000Z",
  nextSectionStartAt: null,
  serverNow: NOW,
  waitingForNextSection: false,
  isOverrun: false,
  totalPausedSeconds: 0,
  createdAt: NOW,
  updatedAt: NOW,
  sections: [{
    sectionKey: "reading-writing",
    label: "Reading & Writing",
    sectionOrder: 0,
    plannedDurationMinutes: 64,
    gapAfterMinutes: 10,
    status: "live",
    availableAt: NOW,
    actualStartAt: NOW,
    actualEndAt: null,
    pausedAt: null,
    accumulatedPausedSeconds: 0,
    extensionMinutes: 0,
    projectedStartAt: NOW,
    projectedEndAt: "2026-10-11T03:04:00.000Z",
  }],
  examPlan: [{
    sectionKey: "reading-writing",
    label: "Reading & Writing",
    order: 0,
    durationMinutes: 64,
    gapAfterMinutes: 10,
    modules: [{ moduleKey: "rw-m1", title: "Module 1", adaptiveRole: "base", durationMinutes: 32 }],
  }],
};
const STUDENT = {
  attemptId: "attempt-ux-1",
  studentId: "student-ux-1",
  studentName: "Ananda S.",
  studentEmail: "ananda@example.test",
  scheduleId: SCHEDULE.id,
  status: "active",
  currentSection: "reading-writing",
  timeRemaining: 1500,
  runtimeStatus: "live",
  runtimeCurrentSection: "reading-writing",
  runtimeTimeRemainingSeconds: 1500,
  runtimeDeadlineAt: "2026-10-11T02:30:00.000Z",
  runtimeServerNow: NOW,
  runtimeModuleRole: "base",
  runtimeModuleDeadlineAt: "2026-10-11T02:18:00.000Z",
  runtimeModuleRemainingSeconds: 780,
  runtimeSectionStatus: "live",
  attemptRevision: 1,
  runtimeCurrentModuleId: "rw-m1",
  runtimeModuleAttemptId: "module-attempt-ux-1",
  runtimeModuleAttemptRevision: 1,
  runtimeWaiting: false,
  violations: [],
  warnings: 0,
  lastActivity: NOW,
  examId: SCHEDULE.examId,
  examName: SCHEDULE.examTitle,
};

const SETUP_EXAM = {
  id: "sat-room-setup-exam",
  slug: "sat-room-setup-exam",
  title: "SAT Practice 03",
  providerKey: "sat",
  examType: "Academic",
  status: "published",
  visibility: "organization",
  ownerId: "admin-1",
  createdAt: NOW,
  updatedAt: NOW,
  currentDraftVersionId: null,
  currentPublishedVersionId: "published-v3",
  currentPublishedScope: "full",
  currentPublishedVersionNumber: 3,
  canEdit: true,
  canPublish: true,
  canDelete: true,
  schemaVersion: 4,
  revision: 11,
};

const SETUP_PUBLISHED_VERSION = {
  id: "published-v3",
  versionNumber: 3,
  revision: 11,
  publishNotes: null,
  publishScope: "full",
  createdAt: NOW,
};

async function installRoomTransport(page: Page): Promise<void> {
  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "x-csrf-token": "csrf-room-ux" },
    body: JSON.stringify({
      success: true,
      data: {
        user: { id: "proctor-1", email: "proctor@example.test", displayName: "Dana Proctor", role: "proctor", state: "active" },
        csrfToken: "csrf-room-ux",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    }),
  }));

  await page.route("**/api/v1/proctor/sessions**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/proctor/sessions" && url.searchParams.get("providerKey") === "sat") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: [{ schedule: SCHEDULE, runtime: RUNTIME, studentCount: 1, activeCount: 1, joinReadyCount: 1, joinTotalCount: 1, degradedLiveMode: false }] }),
      });
      return;
    }
    if (url.pathname === `/api/v1/proctor/sessions/${SCHEDULE.id}` && url.searchParams.get("mode") === "dashboard") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: { schedule: SCHEDULE, runtime: RUNTIME, sessions: [STUDENT], alerts: [], auditLogs: [], notes: [], presence: [], violationRules: [], degradedLiveMode: false },
        }),
      });
      return;
    }
    if (url.pathname.endsWith("/device-transfers")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: {} }) });
  });
}

async function installGuidedRoomSetupTransport(page: Page) {
  const createdRequests: unknown[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  let createdLink: Record<string, unknown> | null = null;
  let createdSchedule: Record<string, unknown> | null = null;
  const createdRuntime = {
    ...RUNTIME,
    id: "runtime-room-created",
    scheduleId: "sat-room-created",
    examId: SETUP_EXAM.id,
    status: "not_started",
    actualStartAt: null,
    actualEndAt: null,
    activeSectionKey: null,
    currentSectionKey: null,
    currentSectionRemainingSeconds: 0,
    currentSectionDeadlineAt: null,
    waitingForNextSection: false,
    sections: [],
  };

  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  // Room task state is exercised through REST; close the unused live feed
  // cleanly so this mocked suite does not depend on the proctor WebSocket.
  await page.routeWebSocket("**/api/v1/ws/live**", (socket) => {
    void socket.close({ code: 1000, reason: "REST-only room setup test" });
  });

  // The specific API routes below model the workflow; this fallback keeps
  // unrelated polling requests deterministic in the standalone browser suite.
  await page.route("**/api/v1/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "x-csrf-token": "csrf-room-setup" },
    body: JSON.stringify({ success: true, data: {} }),
  }));

  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "x-csrf-token": "csrf-room-setup" },
    body: JSON.stringify({
      success: true,
      data: {
        user: { id: "admin-1", email: "admin@example.test", displayName: "Dana Admin", role: "admin", state: "active" },
        csrfToken: "csrf-room-setup",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    }),
  }));

  await page.route("**/api/v1/exams?providerKey=sat", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify([SETUP_EXAM]),
  }));

  await page.route("**/api/v1/exams/sat-room-setup-exam", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(SETUP_EXAM),
  }));

  await page.route("**/api/v1/assessment-release/exams/sat-room-setup-exam", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      examId: SETUP_EXAM.id,
      providerKey: "sat",
      state: "published_current",
      currentPublishedVersion: {
        ...SETUP_PUBLISHED_VERSION,
        publishedAt: NOW,
      },
      workingDraft: null,
      summary: { candidateDurationSeconds: 4800, authoredQuestionCount: 54, deliveredQuestionCount: 54 },
      access: { totalLinks: 0, liveLinks: 0, upcomingLinks: 0, linksOnCurrentRelease: 0, liveLinksOnPreviousReleases: 0 },
    }),
  }));

  await page.route("**/api/v1/assessment-access/exams/sat-room-setup-exam/overview", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "x-csrf-token": "csrf-room-setup" },
    body: JSON.stringify({
      currentPublishedVersion: SETUP_PUBLISHED_VERSION,
      links: createdLink ? [createdLink] : [],
    }),
  }));

  await page.route("**/api/v1/assessment-access/exams/sat-room-setup-exam/links", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
      return;
    }
    const request = route.request().postDataJSON() as Record<string, unknown>;
    createdRequests.push(request);
    createdLink = {
      id: "link-room-created",
      examId: SETUP_EXAM.id,
      examTitle: SETUP_EXAM.title,
      providerKey: "sat",
      publishedVersionId: request.publishedVersionId,
      versionNumber: 3,
      publishScope: "full",
      scheduleId: "sat-room-created",
      name: request.name,
      enabledSections: request.enabledSections,
      audienceType: request.audienceType,
      audienceLabel: request.audienceLabel,
      accessMode: request.accessMode,
      availabilityType: request.availabilityType,
      opensAt: request.opensAt,
      closesAt: request.closesAt,
      lifecycleState: "active",
      status: "live",
      selectedStudentCount: 0,
      metrics: { registered: 0, started: 0, submitted: 0 },
      isCurrentRelease: true,
      hasParticipation: false,
      revision: 1,
      createdAt: NOW,
      updatedAt: NOW,
    };
    createdSchedule = {
      ...SCHEDULE,
      id: "sat-room-created",
      examId: SETUP_EXAM.id,
      examTitle: SETUP_EXAM.title,
      publishedVersionId: SETUP_PUBLISHED_VERSION.id,
      cohortName: String(request.name),
      startTime: "2026-11-01T04:00:00.000Z",
      endTime: "2026-11-01T07:00:00.000Z",
      status: "upcoming",
      createdBy: "admin-1",
      revision: 1,
    };
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      headers: { "x-csrf-token": "csrf-room-setup" },
      body: JSON.stringify(createdLink),
    });
  });

  await page.route("**/api/v1/proctor/sessions**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/v1/proctor/sessions" && url.searchParams.get("providerKey") === "sat") {
      const summaries = createdSchedule ? [{
        schedule: createdSchedule,
        runtime: createdRuntime,
        studentCount: 0,
        activeCount: 0,
        joinReadyCount: 0,
        joinTotalCount: 0,
        degradedLiveMode: false,
      }] : [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: summaries }) });
      return;
    }
    if (url.pathname.endsWith("/sat-room-created") && url.searchParams.get("mode") === "dashboard") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          success: true,
          data: {
            schedule: createdSchedule,
            runtime: createdRuntime,
            sessions: [],
            alerts: [],
            auditLogs: [],
            notes: [],
            presence: [],
            violationRules: [],
            degradedLiveMode: false,
          },
        }),
      });
      return;
    }
    if (url.pathname.endsWith("/device-transfers")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: [] }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: {} }) });
  });

  return { createdRequests, consoleErrors, pageErrors };
}

test.describe("SAT staff live-room UX", () => {
  for (const width of [320, 390, 768]) {
    test(`keeps room state, roster, and essential controls usable at ${width} CSS px`, async ({ page }) => {
      await installRoomTransport(page);
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/sat/sessions/sched-ux-1");

      await expect(page.getByRole("heading", { level: 1, name: "Morning room" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Pause exam" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Students" })).toBeVisible();
      await expect(page.getByRole("option", { name: /Open Ananda S\./ })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await expectNoSeriousAxeViolations(page, `SAT live room at ${width} CSS px`);
    });
  }

  test("keyboard users can reach room controls, review the consequence, and cancel safely", async ({ page }) => {
    await installRoomTransport(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/sat/sessions/sched-ux-1");
    await expect(page.getByRole("button", { name: "End exam" })).toBeVisible();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#sat-main")).toBeFocused();

    let foundEndExam = false;
    for (let index = 0; index < 40; index += 1) {
      if (await page.evaluate(() => document.activeElement?.textContent?.trim() === "End exam")) {
        foundEndExam = true;
        break;
      }
      await page.keyboard.press("Tab");
    }
    expect(foundEndExam).toBe(true);
    await page.keyboard.press("Enter");

    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toContainText("End the exam for everyone in this room?");
    await expect(confirmation).toContainText("Affects every student in this room.");
    await expect(confirmation.getByRole("button", { name: "Cancel" })).toBeFocused();
    await expectNoSeriousAxeViolations(page, "SAT live-room confirmation");
    await page.keyboard.press("Escape");
    await expect(confirmation).toHaveCount(0);
    await expect(page.getByRole("button", { name: "End exam" })).toBeFocused();
  });
});

test.describe("SAT guided room setup", () => {
  test("reviews, edits, and creates a room pinned to the published version", async ({ page }) => {
    const recording = await installGuidedRoomSetupTransport(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/sat/sessions");

    await page.getByRole("button", { name: "Create room" }).click();
    const examChoice = page.getByRole("dialog", { name: "Create room" });
    await expect(examChoice.getByRole("progressbar", { name: "Room setup progress" })).toHaveAttribute("aria-valuenow", "1");
    await expect(examChoice.getByLabel("Exam")).toHaveValue("sat-room-setup-exam");
    await examChoice.getByRole("button", { name: "Continue" }).click();

    const setupProgress = page.getByRole("progressbar", { name: "Room setup progress" });
    await expect(setupProgress).toHaveAttribute("aria-valuenow", "2");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Give this room a name people will recognize.")).toBeVisible();
    await page.getByRole("textbox", { name: "Room name" }).fill("October morning mock");
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(setupProgress).toHaveAttribute("aria-valuenow", "3");
    await expect(page.getByRole("group", { name: "Audience" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(setupProgress).toHaveAttribute("aria-valuenow", "4");
    await expect(page.getByRole("group", { name: "Check-in window" })).toBeVisible();
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(setupProgress).toHaveAttribute("aria-valuenow", "5");
    await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
    await expect(page.getByText("SAT Practice 03 · Version 3", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("October morning mock", { exact: true })).toBeVisible();
    await expect(page.getByText("The proctor starts the exam.", { exact: true })).toBeVisible();
    await expectNoSeriousAxeViolations(page, "SAT guided room setup review");

    await page.getByRole("button", { name: "Back" }).click();
    await expect(setupProgress).toHaveAttribute("aria-valuenow", "4");
    await page.getByRole("button", { name: "Back" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(setupProgress).toHaveAttribute("aria-valuenow", "2");
    await expect(page.getByRole("textbox", { name: "Room name" })).toHaveValue("October morning mock");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(setupProgress).toHaveAttribute("aria-valuenow", "5");

    await page.getByRole("button", { name: "Create room" }).click();
    await expect(page).toHaveURL(/\/sat\/sessions\/sat-room-created$/);
    await expect(page.getByRole("heading", { level: 1, name: "October morning mock" })).toBeVisible();
    expect(recording.createdRequests).toHaveLength(1);
    expect(recording.createdRequests[0]).toMatchObject({
      name: "October morning mock",
      publishedVersionId: "published-v3",
      audienceType: "anyone",
      accessMode: "student_code",
      availabilityType: "anytime",
      opensAt: null,
      closesAt: null,
    });
    expect(recording.consoleErrors).toEqual([]);
    expect(recording.pageErrors).toEqual([]);
  });

  test("exam Rooms starts the same guided setup with its version already pinned", async ({ page }) => {
    const recording = await installGuidedRoomSetupTransport(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/sat/exams/sat-room-setup-exam/access");

    const header = page.getByTestId("exam-workspace-header");
    await expect(header.getByRole("heading", { name: "SAT Practice 03" })).toBeVisible();
    await header.getByRole("button", { name: "Create room" }).click();
    const progress = page.getByRole("progressbar", { name: "Room setup progress" });
    await expect(progress).toHaveAttribute("aria-valuenow", "1");
    await expect(page.getByText("This room uses Version 3 of SAT Practice 03.")).toBeVisible();
    await page.getByRole("textbox", { name: "Room name" }).fill("Exam Rooms tab setup");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(progress).toHaveAttribute("aria-valuenow", "4");
    await expect(page.getByRole("heading", { name: "Summary" })).toBeVisible();
    await expect(page.getByText("SAT Practice 03 · Version 3", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("Exam Rooms tab setup", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expectNoSeriousAxeViolations(page, "SAT exam Rooms guided setup review");

    await page.getByRole("button", { name: "Create room", exact: true }).last().click();
    await expect(page).toHaveURL(/\/sat\/sessions\/sat-room-created$/);
    expect(recording.createdRequests).toHaveLength(1);
    expect(recording.createdRequests[0]).toMatchObject({
      name: "Exam Rooms tab setup",
      publishedVersionId: "published-v3",
      audienceType: "anyone",
      availabilityType: "anytime",
    });
    expect(recording.consoleErrors).toEqual([]);
    expect(recording.pageErrors).toEqual([]);
  });
});

test.describe("SAT staff room at 200% zoom-equivalent reflow", () => {
  test.use({ viewport: { width: 640, height: 900 }, deviceScaleFactor: 2 });

  test("keeps the room task readable and operable at a 640 CSS px, 2× viewport", async ({ page }) => {
    await installRoomTransport(page);
    await page.goto("/sat/sessions/sched-ux-1");

    expect(await page.evaluate(() => ({ width: window.innerWidth, scale: window.devicePixelRatio }))).toEqual({ width: 640, scale: 2 });
    await expect(page.getByRole("heading", { level: 1, name: "Morning room" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pause exam" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Students" })).toBeVisible();
    await expect(page.getByRole("option", { name: /Open Ananda S\./ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(640);
    await expectNoSeriousAxeViolations(page, "SAT live room at 200% zoom-equivalent reflow");
  });
});

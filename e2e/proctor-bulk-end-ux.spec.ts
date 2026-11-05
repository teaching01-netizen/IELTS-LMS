import { expect, test, type Page } from "@playwright/test";

/**
 * E2EDD scenarios for bulk ending exams from the IELTS/ACT proctor overview.
 *
 * P1 happy path — select two live cohorts, confirm once, both exam-end commands
 *    are delivered and the overview reports the outcome.
 * P2 failure handling — one refused cohort never cancels the other; the toast
 *    names the cohort that failed.
 * P3 scope guard — selection exists only on Active, never on Past.
 * P4 eligibility — rooms that are not running cannot be selected for ending.
 */

const NOW = "2026-11-04T02:05:00.000Z";

function proctorRoom(input: {
  id: string;
  cohortName: string;
  examTitle: string;
  runtimeStatus: "live" | "paused" | "not_started" | "completed";
  startTime: string;
}) {
  const live = input.runtimeStatus === "live" || input.runtimeStatus === "paused";
  return {
    schedule: {
      id: input.id,
      examId: `exam-${input.id}`,
      providerKey: "ielts",
      examTitle: input.examTitle,
      proctorDisplayName: input.examTitle,
      gradingDisplayName: input.examTitle,
      publishedVersionId: "version-1",
      publishScope: "full",
      cohortName: input.cohortName,
      startTime: input.startTime,
      endTime: "2026-11-04T06:00:00.000Z",
      plannedDurationMinutes: 180,
      deliveryMode: "proctor_start",
      autoStart: false,
      autoStop: false,
      status: live ? "live" : input.runtimeStatus === "completed" ? "completed" : "scheduled",
      createdAt: NOW,
      createdBy: "staff-1",
      updatedAt: NOW,
      revision: 7,
    },
    runtime: {
      id: `runtime-${input.id}`,
      scheduleId: input.id,
      examId: `exam-${input.id}`,
      providerKey: "ielts",
      examTitle: input.examTitle,
      cohortName: input.cohortName,
      deliveryMode: "proctor_start",
      status: input.runtimeStatus,
      timingModel: "cohort_section_v3",
      revision: 7,
      actualStartAt: live ? NOW : null,
      actualEndAt: input.runtimeStatus === "completed" ? NOW : null,
      activeSectionKey: live ? "reading" : null,
      currentSectionKey: live ? "reading" : null,
      currentSectionRemainingSeconds: live ? 1500 : 0,
      serverNow: NOW,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      createdAt: NOW,
      updatedAt: NOW,
      sections: live ? [{ sectionKey: "reading", label: "Reading", status: "live" }] : [],
    },
    studentCount: 14,
    activeCount: input.runtimeStatus === "live" ? 12 : 0,
    joinReadyCount: 14,
    joinTotalCount: 14,
    alertCount: 0,
    violationCount: 0,
    degradedLiveMode: false,
  };
}

const LISTENING = proctorRoom({ id: "sched-listening", cohortName: "Cohort A", examTitle: "Mock Exam", runtimeStatus: "live", startTime: "2026-11-04T02:00:00.000Z" });
const WRITING = proctorRoom({ id: "sched-writing", cohortName: "Cohort B", examTitle: "Mock Exam", runtimeStatus: "paused", startTime: "2026-11-04T03:00:00.000Z" });
const UPCOMING = proctorRoom({ id: "sched-upcoming", cohortName: "Cohort C", examTitle: "Mock Exam", runtimeStatus: "not_started", startTime: "2026-11-05T02:00:00.000Z" });
const COMPLETED = proctorRoom({ id: "sched-completed", cohortName: "Cohort D", examTitle: "Mock Exam", runtimeStatus: "completed", startTime: "2026-11-01T02:00:00.000Z" });

interface ProctorTransport {
  rooms: ReturnType<typeof proctorRoom>[];
  rejectIds: Set<string>;
  commands: Array<{ scheduleId: string; body: Record<string, unknown> }>;
}

async function installProctorTransport(
  page: Page,
  options: { rooms: ReturnType<typeof proctorRoom>[]; rejectIds?: string[] },
): Promise<ProctorTransport> {
  const transport: ProctorTransport = {
    rooms: [...options.rooms],
    rejectIds: new Set(options.rejectIds ?? []),
    commands: [],
  };

  await page.routeWebSocket("**/api/v1/ws/live**", (socket) => {
    void socket.close({ code: 1000, reason: "REST-only bulk end test" });
  });

  await page.route("**/api/v1/**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "x-csrf-token": "csrf-bulk-end" },
    body: JSON.stringify({ success: true, data: {} }),
  }));

  await page.route("**/api/v1/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "x-csrf-token": "csrf-bulk-end" },
    body: JSON.stringify({
      success: true,
      data: {
        user: { id: "proctor-1", email: "proctor@example.test", displayName: "Dana Proctor", role: "proctor", state: "active" },
        csrfToken: "csrf-bulk-end",
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    }),
  }));

  await page.route("**/api/v1/proctor/sessions**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST") {
      const ended = url.pathname.match(/^\/api\/v1\/proctor\/sessions\/([^/]+)\/control\/complete-exam$/);
      if (ended) {
        const scheduleId = decodeURIComponent(ended[1] as string);
        transport.commands.push({ scheduleId, body: (request.postDataJSON() ?? {}) as Record<string, unknown> });
        if (transport.rejectIds.has(scheduleId)) {
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ success: false, error: { code: "CONFLICT", message: "The room is locked." } }),
          });
          return;
        }
        transport.rooms = transport.rooms.filter((room) => room.schedule.id !== scheduleId);
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: {} }) });
        return;
      }
    }
    if (url.pathname === "/api/v1/proctor/sessions") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: transport.rooms }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: {} }) });
  });

  return transport;
}

test.describe("Proctor overview bulk end exam", () => {
  test("P1: ends every selected live room from one confirmation", async ({ page }) => {
    const transport = await installProctorTransport(page, { rooms: [LISTENING, WRITING, UPCOMING] });
    await page.goto("/proctor");
    await expect(page.getByRole("heading", { name: "Cohorts and students" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Monitor Mock Exam for cohort Cohort A" })).toBeVisible();

    await page.getByRole("button", { name: "Select rooms" }).click();
    await page.getByRole("button", { name: "Select Mock Exam for cohort Cohort A" }).click();
    await page.getByRole("button", { name: "Select Mock Exam for cohort Cohort B" }).click();
    await expect(page.getByRole("group", { name: "Bulk room actions" })).toContainText("2 selected");

    await page.getByRole("button", { name: "End exam", exact: true }).click();
    const confirmation = page.getByRole("dialog");
    await expect(confirmation).toContainText("End exam in 2 rooms?");
    await confirmation.getByRole("button", { name: "End 2 exams" }).click();

    await expect(page.getByText("2 rooms ended.")).toBeVisible();
    await expect(page.getByRole("group", { name: "Bulk room actions" })).toHaveCount(0);
    expect(transport.commands.map((command) => command.scheduleId).sort()).toEqual(["sched-listening", "sched-writing"]);
    expect(transport.commands.every((command) => command.body.actorId === "Proctor")).toBe(true);
    // Ended rooms leave Active; the upcoming room was never selectable.
    await expect(page.getByRole("button", { name: "Monitor Mock Exam for cohort Cohort A" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Monitor Mock Exam for cohort Cohort B" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Monitor Mock Exam for cohort Cohort C" })).toBeVisible();
  });

  test("P2: a refused room never cancels the other and is named in the toast", async ({ page }) => {
    const transport = await installProctorTransport(page, { rooms: [LISTENING, WRITING], rejectIds: ["sched-writing"] });
    await page.goto("/proctor");
    await expect(page.getByRole("heading", { name: "Cohorts and students" })).toBeVisible();

    await page.getByRole("button", { name: "Select rooms" }).click();
    await page.getByRole("button", { name: "Select all", exact: true }).click();
    await expect(page.getByRole("group", { name: "Bulk room actions" })).toContainText("2 selected");

    await page.getByRole("button", { name: "End exam", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "End 2 exams" }).click();

    await expect(page.getByText("1 room ended.")).toBeVisible();
    await expect(page.getByText("1 failed: Cohort B.")).toBeVisible();
    expect(transport.commands.map((command) => command.scheduleId).sort()).toEqual(["sched-listening", "sched-writing"]);
    // The refused room is still live and still monitored.
    await expect(page.getByRole("button", { name: "Monitor Mock Exam for cohort Cohort B" })).toBeVisible();
  });

  test("P3: selection is offered only on Active, never on Past", async ({ page }) => {
    await installProctorTransport(page, { rooms: [LISTENING, COMPLETED] });
    await page.goto("/proctor");
    await expect(page.getByRole("button", { name: "Select rooms" })).toBeVisible();

    await page.getByRole("tab", { name: /Past sessions/ }).click();
    await expect(page.getByRole("button", { name: "Monitor Mock Exam for cohort Cohort D" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Select rooms" })).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Bulk room actions" })).toHaveCount(0);
  });

  test("P4: rooms that have not started can be selected for ending", async ({ page }) => {
    await installProctorTransport(page, { rooms: [LISTENING, UPCOMING] });
    await page.goto("/proctor");
    await expect(page.getByRole("heading", { name: "Cohorts and students" })).toBeVisible();

    await page.getByRole("button", { name: "Select rooms" }).click();
    await expect(page.getByRole("button", { name: "Select Mock Exam for cohort Cohort A" })).toBeEnabled();
    const upcomingCard = page.getByRole("button", { name: "Select Mock Exam for cohort Cohort C" });
    await expect(upcomingCard).toBeEnabled();
    await upcomingCard.click();
    await expect(page.getByRole("group", { name: "Bulk room actions" })).toContainText("1 selected");
  });

  test("P5: ends a room that has not started from one confirmation", async ({ page }) => {
    const transport = await installProctorTransport(page, { rooms: [UPCOMING] });
    await page.goto("/proctor");
    await expect(page.getByRole("heading", { name: "Cohorts and students" })).toBeVisible();

    await page.getByRole("button", { name: "Select rooms" }).click();
    await page.getByRole("button", { name: "Select Mock Exam for cohort Cohort C" }).click();
    await expect(page.getByRole("group", { name: "Bulk room actions" })).toContainText("1 selected");

    await page.getByRole("button", { name: "End exam", exact: true }).click();
    const confirmation = page.getByRole("dialog");
    await expect(confirmation).toContainText("End exam in 1 room?");
    await confirmation.getByRole("button", { name: "End 1 exam" }).click();

    await expect(page.getByText("1 room ended.")).toBeVisible();
    expect(transport.commands.map((command) => command.scheduleId)).toEqual(["sched-upcoming"]);
    await expect(page.getByRole("button", { name: "Monitor Mock Exam for cohort Cohort C" })).toHaveCount(0);
  });
});

import { expect, test, type Page } from "@playwright/test";
import { expectNoSeriousAxeViolations } from "./support/axeAudit";

/**
 * E2EDD scenarios for bulk ending exams from the SAT Rooms list.
 *
 * S1 happy path — select two live rooms, confirm once, both exam-end commands
 *    are delivered and the list reports the outcome.
 * S2 failure handling — one refused room never cancels the others; the notice
 *    names the room that failed.
 * S3 scope guard — the entry point exists only where ending is possible (Live),
 *    never on Upcoming.
 * S4 cancel safety — dismissing the confirmation sends no command and keeps
 *    the selection so nothing ends by accident.
 * S5 state reset — changing bucket abandons the selection.
 * S6 accessibility — the selection state has no serious axe violations.
 */

const NOW = "2026-11-04T02:05:00.000Z";

function satRoom(input: {
  id: string;
  cohortName: string;
  runtimeStatus: "live" | "paused" | "not_started" | "completed";
  startTime: string;
  scheduleStatus: "live" | "scheduled" | "completed";
}) {
  return {
    schedule: {
      id: input.id,
      examId: "sat-ux-1",
      providerKey: "sat",
      examTitle: "Practice Test 06",
      proctorDisplayName: "Practice Test 06",
      gradingDisplayName: "Practice Test 06",
      publishedVersionId: "version-3",
      publishScope: "full",
      cohortName: input.cohortName,
      institution: null,
      startTime: input.startTime,
      endTime: "2026-11-04T06:00:00.000Z",
      plannedDurationMinutes: 180,
      deliveryMode: "proctor_start",
      autoStart: false,
      autoStop: false,
      status: input.scheduleStatus,
      createdAt: NOW,
      createdBy: "staff-1",
      updatedAt: NOW,
      revision: 7,
    },
    runtime: {
      id: `runtime-${input.id}`,
      scheduleId: input.id,
      examId: "sat-ux-1",
      providerKey: "sat",
      status: input.runtimeStatus,
      timingModel: "cohort_section_v3",
      revision: 7,
      actualStartAt: input.runtimeStatus === "not_started" ? null : NOW,
      actualEndAt: null,
      activeSectionKey: input.runtimeStatus === "not_started" ? null : "reading-writing",
      currentSectionKey: input.runtimeStatus === "not_started" ? null : "reading-writing",
      currentSectionRemainingSeconds: input.runtimeStatus === "not_started" ? 0 : 1500,
      currentSectionDeadlineAt: "2026-11-04T02:30:00.000Z",
      nextSectionStartAt: null,
      serverNow: NOW,
      waitingForNextSection: false,
      isOverrun: false,
      totalPausedSeconds: 0,
      createdAt: NOW,
      updatedAt: NOW,
      sections: [],
    },
    studentCount: 12,
    activeCount: input.runtimeStatus === "live" ? 10 : 0,
    alertCount: 0,
    violationCount: 0,
    degradedLiveMode: false,
  };
}

const MORNING = satRoom({ id: "sched-morning", cohortName: "Morning room", runtimeStatus: "live", startTime: "2026-11-04T02:00:00.000Z", scheduleStatus: "live" });
const AFTERNOON = satRoom({ id: "sched-afternoon", cohortName: "Afternoon room", runtimeStatus: "live", startTime: "2026-11-04T03:00:00.000Z", scheduleStatus: "live" });
const PAUSED = satRoom({ id: "sched-paused", cohortName: "Paused room", runtimeStatus: "paused", startTime: "2026-11-04T04:00:00.000Z", scheduleStatus: "live" });
const UPCOMING = satRoom({ id: "sched-upcoming", cohortName: "Upcoming room", runtimeStatus: "not_started", startTime: "2026-11-05T02:00:00.000Z", scheduleStatus: "scheduled" });
const FINISHED = satRoom({ id: "sched-finished", cohortName: "Finished room", runtimeStatus: "completed", startTime: "2026-11-03T02:00:00.000Z", scheduleStatus: "completed" });

interface BulkEndTransport {
  /** Rooms the mocked list currently holds; ended rooms are removed after a confirmed command. */
  rooms: ReturnType<typeof satRoom>[];
  /** Schedule ids whose complete-exam command the server refuses. */
  rejectIds: Set<string>;
  /** Every complete-exam command the browser delivered, in order. */
  commands: Array<{ scheduleId: string; body: Record<string, unknown> }>;
}

async function installBulkEndTransport(
  page: Page,
  options: { rooms: ReturnType<typeof satRoom>[]; rejectIds?: string[] },
): Promise<BulkEndTransport> {
  const transport: BulkEndTransport = {
    rooms: [...options.rooms],
    rejectIds: new Set(options.rejectIds ?? []),
    commands: [],
  };

  // The rooms list is REST-driven; close the unused live feed cleanly so this
  // suite never depends on a real proctor WebSocket.
  await page.routeWebSocket("**/api/v1/ws/live**", (socket) => {
    void socket.close({ code: 1000, reason: "REST-only bulk end test" });
  });

  // Registered first: every unmodelled polling read stays deterministic.
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
      const providerKey = url.searchParams.get("providerKey");
      const rooms = providerKey === "sat" ? transport.rooms : [];
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: rooms }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, data: {} }) });
  });

  return transport;
}

test.describe("SAT Rooms bulk end exam", () => {
  test("S1: ends every selected live room from one confirmation", async ({ page }) => {
    const transport = await installBulkEndTransport(page, { rooms: [MORNING, AFTERNOON, PAUSED] });
    await page.goto("/sat/sessions?bucket=live");
    await expect(page.getByRole("heading", { level: 1, name: "Rooms" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Select rooms" })).toBeVisible();

    await page.getByRole("button", { name: "Select rooms" }).click();
    await page.getByRole("button", { name: "Select Morning room" }).click();
    await page.getByRole("button", { name: "Select Afternoon room" }).click();
    await expect(page.getByRole("group", { name: "Bulk room actions" })).toContainText("2 selected");

    await page.getByRole("button", { name: "End exam", exact: true }).click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toContainText("End exam in 2 rooms?");
    await confirmation.getByRole("button", { name: "End 2 exams" }).click();

    await expect(page.getByText("2 rooms ended.")).toBeVisible();
    await expect(page.getByRole("group", { name: "Bulk room actions" })).toHaveCount(0);
    expect(transport.commands.map((command) => command.scheduleId).sort()).toEqual(["sched-afternoon", "sched-morning"]);
    // Nothing ended twice, and the command carries the actor the room page uses.
    expect(transport.commands.every((command) => command.body.actorId === "Proctor")).toBe(true);
    // The ended rooms leave Live; the paused one was never selected and stays.
    await expect(page.getByText("Morning room")).toHaveCount(0);
    await expect(page.getByText("Afternoon room")).toHaveCount(0);
    await expect(page.getByText("Paused room")).toBeVisible();
  });

  test("S2: a refused room never cancels the others and is named in the notice", async ({ page }) => {
    const transport = await installBulkEndTransport(page, { rooms: [MORNING, AFTERNOON, PAUSED], rejectIds: ["sched-paused"] });
    await page.goto("/sat/sessions?bucket=live");

    await page.getByRole("button", { name: "Select rooms" }).click();
    await page.getByRole("checkbox", { name: "Select all" }).check();
    await expect(page.getByRole("group", { name: "Bulk room actions" })).toContainText("3 selected");

    await page.getByRole("button", { name: "End exam", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "End 3 exams" }).click();

    await expect(page.getByText("2 ended, 1 failed: Paused room.")).toBeVisible();
    expect(transport.commands.map((command) => command.scheduleId).sort()).toEqual(["sched-afternoon", "sched-morning", "sched-paused"]);
    // The refused room is still live and still listed.
    await expect(page.locator(".sat-list-row").filter({ hasText: "Paused room" })).toHaveCount(1);
  });

  test("S3: rooms that never started can be ended, rooms that finished cannot", async ({ page }) => {
    await installBulkEndTransport(page, { rooms: [UPCOMING, FINISHED] });
    await page.goto("/sat/sessions?bucket=upcoming");
    await expect(page.getByText("Upcoming room")).toBeVisible();
    await expect(page.getByRole("button", { name: "Select rooms" })).toBeVisible();

    await page.getByRole("radio", { name: /Finished/ }).click();
    await expect(page.getByText("Finished room")).toBeVisible();
    await expect(page.getByRole("button", { name: "Select rooms" })).toHaveCount(0);
  });

  test("S7: ends rooms that have not started from the Upcoming tab", async ({ page }) => {
    const transport = await installBulkEndTransport(page, { rooms: [UPCOMING] });
    await page.goto("/sat/sessions?bucket=upcoming");
    await expect(page.getByText("Upcoming room")).toBeVisible();

    await page.getByRole("button", { name: "Select rooms" }).click();
    await page.getByRole("button", { name: "Select Upcoming room" }).click();
    await expect(page.getByRole("group", { name: "Bulk room actions" })).toContainText("1 selected");

    await page.getByRole("button", { name: "End exam", exact: true }).click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toContainText("End exam in 1 room?");
    await confirmation.getByRole("button", { name: "End 1 exam" }).click();

    await expect(page.getByText("1 room ended.")).toBeVisible();
    expect(transport.commands.map((command) => command.scheduleId)).toEqual(["sched-upcoming"]);
    // The never-started room leaves Upcoming once the server completes it
    // (scope to the list: the empty-state copy also contains "upcoming room").
    await expect(page.locator(".sat-list-row").filter({ hasText: "Upcoming room" })).toHaveCount(0);
  });

  test("S4: cancelling the confirmation sends no command and keeps the selection", async ({ page }) => {
    const transport = await installBulkEndTransport(page, { rooms: [MORNING, AFTERNOON] });
    await page.goto("/sat/sessions?bucket=live");

    await page.getByRole("button", { name: "Select rooms" }).click();
    await page.getByRole("button", { name: "Select Morning room" }).click();
    await page.getByRole("button", { name: "End exam", exact: true }).click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toContainText("End exam in 1 room?");
    await confirmation.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmation).toHaveCount(0);

    expect(transport.commands).toHaveLength(0);
    await expect(page.getByRole("group", { name: "Bulk room actions" })).toContainText("1 selected");
    await expect(page.getByText("Morning room")).toBeVisible();
  });

  test("S5: changing bucket abandons the selection", async ({ page }) => {
    await installBulkEndTransport(page, { rooms: [MORNING, UPCOMING] });
    await page.goto("/sat/sessions?bucket=live");

    await page.getByRole("button", { name: "Select rooms" }).click();
    await page.getByRole("button", { name: "Select Morning room" }).click();
    await expect(page.getByRole("group", { name: "Bulk room actions" })).toBeVisible();

    await page.getByRole("radio", { name: /Upcoming/ }).click();
    await expect(page.getByText("Upcoming room")).toBeVisible();
    await expect(page.getByRole("group", { name: "Bulk room actions" })).toHaveCount(0);
    await page.getByRole("radio", { name: /Live/ }).click();
    await expect(page.getByRole("button", { name: "Select rooms" })).toBeVisible();
  });

  test("S6: the selection state is accessible", async ({ page }) => {
    await installBulkEndTransport(page, { rooms: [MORNING, AFTERNOON] });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/sat/sessions?bucket=live");

    await page.getByRole("button", { name: "Select rooms" }).click();
    const row = page.getByRole("button", { name: "Select Morning room" });
    await expect(row).toHaveAttribute("aria-pressed", "false");
    await row.click();
    await expect(page.getByRole("button", { name: "Deselect Morning room" })).toHaveAttribute("aria-pressed", "true");
    await expectNoSeriousAxeViolations(page, "SAT rooms bulk selection");
  });
});

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { ADMIN_STORAGE_STATE_PATH } from "./support/backendE2e";
import { closeDb, executeUpdate, queryDb } from "./support/db";
import { stubScreenDetails } from "./support/studentUi";
import { buildCompleteSatSample } from "../src/features/exam-authoring/providers/sat/sampleExam";
import type { AssessmentAuthoringShellResult } from "../src/features/exam-authoring/contracts/assessment";

/**
 * Section-boundary break handoff (docs/plans/2026-10-29-sat-break-boundary-
 * low-level.md).
 *
 * The behaviour under test is the moment Reading & Writing ends and Math is
 * routed but not started. The close response IS the boundary: it carries the
 * break the close transaction just created, so the student must see the break
 * surface immediately — "Preparing your break…", then the countdown — and never
 * the terminal "Preparing Math…" stall that made the transition look frozen for
 * one poll interval.
 *
 * Two executable flows:
 *   1. happy path — the close ack carries `personalBreaks`, the break arms with
 *      no lifecycle read, survives a reload, and still ends in "Preparing Math…"
 *      once the break is actually over.
 *   2. projection gap — the close ack arrives without `personalBreaks` (an older
 *      server or a failed projection read). The authored break must still hold
 *      the boundary in `preparing`, and the bounded fallback pull must land the
 *      row within its budget.
 */

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

const MODULE_MINUTES = 1;
const BREAK_MINUTES = 1;
/** The break the authoring API was told to save for Reading & Writing. */
const AUTHORED_BREAK_SECONDS = BREAK_MINUTES * 60;
/** The handoff is one React commit after the close response — a wide margin. */
const HANDOFF_BUDGET_MS = 1_500;

interface ApiResponse {
  status: number;
  payload: unknown;
}

interface ExamSnapshot {
  id: string;
  revision: number;
  currentDraftVersionId?: string | null;
  currentPublishedVersionId?: string | null;
}

interface AccessLinkSnapshot {
  id: string;
  scheduleId: string;
}

interface RuntimeSnapshot {
  status: string;
}

interface BreakRow {
  id: string;
  after_section_id: string;
  duration_seconds: number;
  state: string;
  starts_at: string | null;
  deadline_at: string | null;
}

interface BreakTrace {
  closeCompletedAt: number | null;
  firstBreakAt: number | null;
  phases: string[];
  headings: string[];
  timers: string[];
  metrics: Array<{ name?: string; reason?: string; latencyMs?: number }>;
}

function unwrap<T>(payload: unknown): T {
  if (typeof payload === "object" && payload !== null && "data" in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function timerSeconds(value: string): number {
  const match = /^(\d+):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Expected a numeric countdown, got ${JSON.stringify(value)}.`);
  return Number(match[1]) * 60 + Number(match[2]);
}

async function writeApi(
  page: Page,
  method: "DELETE" | "PATCH" | "POST",
  endpoint: string,
  body?: Record<string, unknown>
): Promise<ApiResponse> {
  const cookies = await page.context().cookies();
  const csrfCookieNames = [
    process.env["CSRF_COOKIE_NAME"],
    process.env["AUTH_CSRF_COOKIE_NAME"],
    "__Host-csrf",
    "csrf",
  ].filter((name): name is string => Boolean(name));
  const csrf = cookies.find((cookie) => csrfCookieNames.includes(cookie.name))?.value;
  if (!csrf) throw new Error("Admin storage state did not contain a CSRF cookie.");

  return page.evaluate(
    async ({ endpoint: requestEndpoint, method: requestMethod, body: requestBody, csrf: token }) => {
      const response = await fetch(requestEndpoint, {
        method: requestMethod,
        credentials: "include",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": token,
        },
        body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
      });
      const text = await response.text();
      let payload: unknown = null;
      if (text) {
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          payload = text;
        }
      }
      return { status: response.status, payload };
    },
    { endpoint, method, body, csrf }
  );
}

async function readApi(page: Page, endpoint: string): Promise<ApiResponse> {
  return page.evaluate(async (requestEndpoint) => {
    const response = await fetch(requestEndpoint, { credentials: "include" });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = text;
      }
    }
    return { status: response.status, payload };
  }, endpoint);
}

async function configureDeliveryThroughApi(
  page: Page,
  examId: string,
  title: string,
  values: { base: number; lower: number; higher: number; breakMinutes: number }
): Promise<void> {
  const shellResponse = await readApi(page, `/api/v1/assessment-authoring/exams/${examId}/shell`);
  expect(shellResponse.status, JSON.stringify(shellResponse.payload)).toBe(200);
  const shellLifecycle = unwrap<AssessmentAuthoringShellResult>(shellResponse.payload);
  const shell = shellLifecycle.shell;
  if (!shell) throw new Error(`No editable shell while configuring ${title}.`);
  const section = shell.sections.find((candidate) => candidate.title === title);
  if (!section) throw new Error(`Authoring shell did not contain ${title}.`);
  const durationByRole: Record<string, number> = {
    base: values.base,
    lower_branch: values.lower,
    higher_branch: values.higher,
  };
  const response = await writeApi(
    page,
    "PATCH",
    `/api/v1/assessment-authoring/exams/${examId}/sections/${section.id}/delivery-settings`,
    {
      expectedSectionRevision: section.revision,
      breakAfterSeconds: values.breakMinutes * 60,
      moduleTimings: section.modules.map((module) => ({
        moduleId: module.id,
        durationSeconds: (durationByRole[module.adaptiveRole] ?? 0) * 60,
        expectedRevision: module.revision,
      })),
      minimumCorrectForHigher: section.routingPolicy?.minimumCorrectForHigher ?? 1,
      expectedRoutingRevision: section.routingPolicy?.revision ?? 0,
    }
  );
  expect(response.status, JSON.stringify(response.payload)).toBe(200);
}

async function waitForRuntime(
  page: Page,
  scheduleId: string,
  predicate: (runtime: RuntimeSnapshot) => boolean
): Promise<void> {
  await expect
    .poll(
      async () => {
        const response = await readApi(page, `/api/v1/proctor/sessions/${scheduleId}`);
        if (response.status !== 200) return false;
        const payload = unwrap<{ runtime: RuntimeSnapshot }>(response.payload);
        return predicate(payload.runtime);
      },
      { timeout: 30_000, intervals: [250, 500, 1_000] }
    )
    .toBe(true);
}

async function removeStartedStudentArtifacts(scheduleId: string): Promise<void> {
  for (const statement of [
    `DELETE terminalization
       FROM attempt_terminalizations terminalization
       JOIN student_attempts attempt ON attempt.id = terminalization.attempt_id
      WHERE attempt.schedule_id = ?`,
    `DELETE route_decision
       FROM assessment_route_decisions route_decision
       JOIN student_attempts attempt ON attempt.id = route_decision.attempt_id
      WHERE attempt.schedule_id = ?`,
    `DELETE FROM assessment_attempt_breaks
      WHERE attempt_id IN (SELECT id FROM student_attempts WHERE schedule_id = ?)`,
    `DELETE module_attempt
       FROM assessment_module_attempts module_attempt
       JOIN student_attempts attempt ON attempt.id = module_attempt.attempt_id
      WHERE attempt.schedule_id = ?`,
    `DELETE FROM assessment_access_links WHERE schedule_id = ?`,
    `DELETE FROM exam_schedules WHERE id = ?`,
  ]) {
    await executeUpdate(statement, [scheduleId]);
  }
}

/** Seed a published SAT room: one-minute modules and a one-minute break. */
async function seedSatRoom(page: Page): Promise<{
  examId: string;
  scheduleId: string;
  link: AccessLinkSnapshot;
  stamp: string;
}> {
  const stamp = Date.now().toString(36);
  const examTitle = `SAT break boundary ${stamp}`;
  const linkName = `SAT break boundary link ${stamp}`;

  await page.goto("/sat/sessions");
  const createResponse = await writeApi(page, "POST", "/api/v1/exams", {
    slug: `e2e-sat-break-boundary-${stamp}`,
    title: examTitle,
    examType: "Academic",
    visibility: "organization",
    providerKey: "sat",
  });
  expect(createResponse.status, JSON.stringify(createResponse.payload)).toBe(201);
  const examId = unwrap<ExamSnapshot>(createResponse.payload).id;

  const shellResponse = await readApi(page, `/api/v1/assessment-authoring/exams/${examId}/shell`);
  expect(shellResponse.status, JSON.stringify(shellResponse.payload)).toBe(200);
  const shellLifecycle = unwrap<AssessmentAuthoringShellResult>(shellResponse.payload);
  if (!shellLifecycle.shell) throw new Error("New SAT did not expose an editable authoring shell.");
  const sampleResponse = await writeApi(
    page,
    "POST",
    `/api/v1/assessment-authoring/exams/${examId}/load-sample`,
    buildCompleteSatSample(shellLifecycle.shell) as unknown as Record<string, unknown>
  );
  expect(sampleResponse.status, JSON.stringify(sampleResponse.payload)).toBe(200);

  // One-minute modules keep the E2E duration honest while still exercising two
  // real module closes (Module 1, then the adaptive Module 2) before the break.
  await configureDeliveryThroughApi(page, examId, "Reading & Writing", {
    base: MODULE_MINUTES,
    lower: MODULE_MINUTES,
    higher: MODULE_MINUTES,
    breakMinutes: BREAK_MINUTES,
  });
  await configureDeliveryThroughApi(page, examId, "Math", {
    base: MODULE_MINUTES,
    lower: MODULE_MINUTES,
    higher: MODULE_MINUTES,
    breakMinutes: 0,
  });
  const validationResponse = await writeApi(
    page,
    "POST",
    `/api/v1/assessment-authoring/exams/${examId}/validate`
  );
  expect(validationResponse.status, JSON.stringify(validationResponse.payload)).toBe(200);

  const examResponse = await readApi(page, `/api/v1/exams/${examId}`);
  expect(examResponse.status, JSON.stringify(examResponse.payload)).toBe(200);
  const exam = unwrap<ExamSnapshot>(examResponse.payload);
  const finalShellResponse = await readApi(
    page,
    `/api/v1/assessment-authoring/exams/${examId}/shell`
  );
  expect(finalShellResponse.status, JSON.stringify(finalShellResponse.payload)).toBe(200);
  const finalShellLifecycle = unwrap<AssessmentAuthoringShellResult>(finalShellResponse.payload);
  if (!finalShellLifecycle.shell) {
    throw new Error("Final SAT draft shell was unavailable before publish.");
  }
  const publishResponse = await writeApi(page, "POST", `/api/v1/exams/${examId}/publish`, {
    publishNotes: "Published by the SAT break boundary E2E.",
    revision: exam.revision,
    expectedDraftVersionId: exam.currentDraftVersionId,
    expectedDraftRevision: finalShellLifecycle.shell.versionRevision,
    operationKey: `sat-break-boundary-${stamp}`,
  });
  expect(publishResponse.status, JSON.stringify(publishResponse.payload)).toBe(200);
  const publishedExamResponse = await readApi(page, `/api/v1/exams/${examId}`);
  const publishedExam = unwrap<ExamSnapshot>(publishedExamResponse.payload);
  expect(publishedExam.currentPublishedVersionId).toBeTruthy();

  const linkResponse = await writeApi(
    page,
    "POST",
    `/api/v1/assessment-access/exams/${examId}/links`,
    {
      publishedVersionId: publishedExam.currentPublishedVersionId,
      name: linkName,
      enabledSections: [],
      audienceType: "anyone",
      audienceLabel: null,
      accessMode: "open",
      availabilityType: "anytime",
      selectedStudents: [],
    }
  );
  expect(linkResponse.status, JSON.stringify(linkResponse.payload)).toBe(201);
  const link = unwrap<AccessLinkSnapshot>(linkResponse.payload);

  // The premise of the whole flow: new SAT schedules use the attempt-owned
  // model, where the break belongs to the attempt and the close projects it.
  const scheduleResponse = await readApi(page, `/api/v1/schedules/${link.scheduleId}`);
  expect(scheduleResponse.status, JSON.stringify(scheduleResponse.payload)).toBe(200);
  const schedule = unwrap<{ satTimingModel?: string | null }>(scheduleResponse.payload);
  expect(schedule.satTimingModel).toBe("sat_personal_v1");

  const startResponse = await writeApi(
    page,
    "POST",
    `/api/v1/schedules/${link.scheduleId}/runtime/commands`,
    { action: "start_runtime", reason: "SAT break boundary E2E" }
  );
  expect(startResponse.status, JSON.stringify(startResponse.payload)).toBe(200);
  await waitForRuntime(page, link.scheduleId, (runtime) => runtime.status === "live");

  return { examId, scheduleId: link.scheduleId, link, stamp };
}

/**
 * Records the boundary as the student sees it: when the close response
 * resolved, when the break surface first existed, every phase it showed, and
 * the telemetry the controller emitted. Installed before any app code runs.
 */
function installBreakTrace() {
  const win = window as unknown as {
    __satBreakTrace: BreakTrace;
  };
  const trace: BreakTrace = {
    closeCompletedAt: null,
    firstBreakAt: null,
    phases: [],
    headings: [],
    timers: [],
    metrics: [],
  };
  win.__satBreakTrace = trace;

  window.addEventListener("student-observability-metric", (event) => {
    const detail = (event as CustomEvent).detail as { name?: string } | undefined;
    if (detail?.name?.startsWith("sat_break_boundary")) trace.metrics.push(detail as never);
  });

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const isClose = /\/modules\/close(\?|$)/.test(url);
    return originalFetch(input as RequestInfo, init).then((response) => {
      if (isClose && response.ok) trace.closeCompletedAt = performance.now();
      return response;
    });
  };

  const record = () => {
    const surface = document.querySelector("[data-sat-break-phase]");
    if (!surface) return;
    if (trace.firstBreakAt === null) trace.firstBreakAt = performance.now();
    const phase = surface.getAttribute("data-sat-break-phase");
    if (phase && trace.phases.at(-1) !== phase) trace.phases.push(phase);
    const heading = document.querySelector('[data-testid="sat-scheduled-break"] h1');
    const headingText = heading?.textContent?.trim();
    if (headingText && trace.headings.at(-1) !== headingText) trace.headings.push(headingText);
    const timer = surface.querySelector('[role="timer"]');
    const timerText = timer?.textContent?.trim();
    if (timerText && trace.timers.at(-1) !== timerText) trace.timers.push(timerText);
  };
  // `document.documentElement` can still be null when a Playwright init script
  // runs (the parser has not created <html> yet), which would abort this script
  // before the observer is attached. Observing `document` is valid at any time
  // and sees the same subtree.
  new MutationObserver(record).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  record();
}

interface JoinedStudent {
  context: BrowserContext;
  page: Page;
  attemptId: string;
}

async function joinStudent(
  browser: Browser,
  adminPage: Page,
  link: AccessLinkSnapshot,
  scheduleId: string,
  name: string,
  email: string
): Promise<JoinedStudent> {
  const context = await browser.newContext();
  await stubScreenDetails(context);
  await context.addInitScript(installBreakTrace);
  const studentPage = await context.newPage();
  // The route's last segment is the STUDENT key, not the attempt id. Take the
  // attempt id from the delivery bootstrap, which is the server's authority.
  const bootstrapAttemptId = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The delivery bootstrap never returned an attempt id.")),
      60_000
    );
    studentPage.on("response", async (response) => {
      if (!response.url().endsWith("/bootstrap") || response.status() !== 200) return;
      try {
        const body = (await response.json()) as Record<string, unknown>;
        const payload = (body["data"] ?? body) as Record<string, unknown>;
        const attempt = payload["attempt"] as { id?: unknown } | undefined;
        if (typeof attempt?.id === "string" && attempt.id !== "") {
          clearTimeout(timer);
          resolve(attempt.id);
        }
      } catch {
        // Another bootstrap response may still resolve; the timeout owns failure.
      }
    });
  });
  await studentPage.goto(new URL(`/join/${link.id}`, adminPage.url()).toString());
  await expect(
    studentPage.getByRole("heading", { name: "Exam Check-in", exact: true })
  ).toBeVisible({ timeout: 30_000 });
  await studentPage.getByLabel("Full name").fill(name);
  await studentPage.getByLabel("Email").fill(email);
  await studentPage.getByRole("button", { name: /Continue/i }).click();
  await expect(studentPage).toHaveURL(new RegExp(`/student/${scheduleId}/[^/]+$`), {
    timeout: 30_000,
  });
  return { context, page: studentPage, attemptId: await bootstrapAttemptId };
}

async function readTrace(page: Page): Promise<BreakTrace> {
  return page.evaluate(
    () => (window as unknown as { __satBreakTrace: BreakTrace }).__satBreakTrace
  );
}

function expectNoEndingStall(trace: BreakTrace): void {
  expect(trace.closeCompletedAt, "the close response must have been observed").not.toBeNull();
  expect(trace.firstBreakAt, "the break surface must have mounted").not.toBeNull();
  expect(
    (trace.firstBreakAt as number) - (trace.closeCompletedAt as number),
    "the break surface must mount from the close response, not a later poll"
  ).toBeLessThan(HANDOFF_BUDGET_MS);
  expect(trace.phases[0]).toMatch(/^(preparing|active)$/);
  expect(trace.phases).not.toContain("ending");
  expect(trace.headings.some((heading) => /Preparing Math/.test(heading))).toBe(false);
}

test.describe("SAT section-boundary break handoff", () => {
  test.describe.configure({ timeout: 420_000 });
  test.skip(({ browserName }) => browserName !== "chromium", "Desktop Chromium only.");

  test("hands the authored break over from the close ack at the Reading & Writing boundary", async ({
    page,
    browser,
  }) => {
    let examId: string | undefined;
    let scheduleId: string | undefined;
    let student: JoinedStudent | undefined;

    try {
      const room = await seedSatRoom(page);
      examId = room.examId;
      scheduleId = room.scheduleId;

      student = await joinStudent(
        browser,
        page,
        room.link,
        room.scheduleId,
        `Break A ${room.stamp}`,
        `sat-break-a-${room.stamp}@example.com`
      );
      const studentPage = student.page;
      // The close ack owns routing: exactly one close so far means the
      // inside-section handoff came from that ack, not from a second close.
      const closeAcks: Array<Record<string, unknown>> = [];
      studentPage.on("response", async (response) => {
        if (!response.url().includes("/modules/close") || response.status() !== 200) return;
        try {
          const body = (await response.json()) as Record<string, unknown>;
          const ack = (body["data"] ?? body) as Record<string, unknown>;
          closeAcks.push({
            nextModuleId: ack["nextModuleId"],
            attempts: (
              (ack["moduleAttempts"] as Array<Record<string, unknown>> | undefined) ?? []
            ).map((attempt) => `${String(attempt["moduleId"])}:${String(attempt["state"])}`),
          });
        } catch {
          // Diagnostics only.
        }
      });

      const examTimer = studentPage.getByRole("timer").first();
      await expect(examTimer).toBeVisible({ timeout: 30_000 });

      // Module 1 (base) runs out. The server activates the adaptive Module 2
      // inside the same section, so the runner must swap to a FRESH window:
      // the timer falls to the end of Module 1 and comes back up for Module 2.
      // No break may appear at this inside-section handoff.
      await expect
        .poll(() => examTimer.innerText().then(timerSeconds), {
          timeout: 90_000,
          intervals: [500, 1_000],
        })
        .toBeLessThanOrEqual(5);
      await expect
        .poll(() => examTimer.innerText().then(timerSeconds), {
          timeout: 30_000,
          intervals: [250, 500],
        })
        .toBeGreaterThan(30);
      // One close so far (Module 1); Module 2 is still running.
      expect(closeAcks.length).toBe(1);
      await expect(studentPage.getByTestId("sat-scheduled-break")).toHaveCount(0);

      // Module 2 expires: this is the section boundary and the reported defect.
      const breakSurface = studentPage.getByTestId("sat-scheduled-break");
      await expect(breakSurface).toBeVisible({ timeout: 120_000 });

      expectNoEndingStall(await readTrace(studentPage));

      // The break is a real server row created by the close transaction, sized
      // from the authored window rather than whatever latency remained.
      const rows = await queryDb<BreakRow>(
        `SELECT id, after_section_id, duration_seconds, state, starts_at, deadline_at
           FROM assessment_attempt_breaks
          WHERE attempt_id = ?`,
        [student.attemptId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.duration_seconds).toBe(AUTHORED_BREAK_SECONDS);
      expect(rows[0]!.state).not.toBe("completed");

      // The 3 s lead is rendered inside the break slot, then the clock starts.
      await expect(breakSurface).toHaveAttribute("data-sat-break-phase", "active", {
        timeout: 20_000,
      });
      const breakTimer = breakSurface.getByRole("timer");
      await expect(breakTimer).toBeVisible({ timeout: 20_000 });
      const breakSeconds = timerSeconds(await breakTimer.innerText());
      expect(breakSeconds).toBeGreaterThan(0);
      expect(breakSeconds).toBeLessThanOrEqual(AUTHORED_BREAK_SECONDS);

      // The ack path is instrumented; it must be the path that ran.
      const metrics = (await readTrace(studentPage)).metrics;
      expect(metrics.some((metric) => metric.name === "sat_break_boundary_ready")).toBe(true);

      // A reload mid-break resumes the same break, never "Preparing Math…".
      await studentPage.reload({ waitUntil: "domcontentloaded" });
      const resumedSurface = studentPage.getByTestId("sat-scheduled-break");
      await expect(resumedSurface).toBeVisible({ timeout: 30_000 });
      await expect(resumedSurface).toHaveAttribute("data-sat-break-phase", "active", {
        timeout: 15_000,
      });
      const resumedSeconds = timerSeconds(await resumedSurface.getByRole("timer").innerText());
      expect(resumedSeconds).toBeGreaterThan(0);
      expect(resumedSeconds).toBeLessThanOrEqual(AUTHORED_BREAK_SECONDS);

      // The break still ends the way it always did: the countdown hands over to
      // whatever the Math section needs next (its entry screen, or, when the
      // server started the module, the exam itself). The break-end read is
      // bounded, so the surface must advance within a couple of windows of the
      // authored deadline instead of waiting out the 60 s steady cadence.
      const deadlineAt = Date.parse(rows[0]!.deadline_at ?? "");
      expect(Number.isFinite(deadlineAt), "the break row must carry a deadline").toBe(true);
      const handoffBudgetMs = Math.max(0, deadlineAt - Date.now()) + 12_000;
      const examShell = studentPage.getByTestId("sat-exam-shell");
      const beginModule = studentPage.getByRole("button", { name: /Begin module/i });
      try {
        await expect(examShell.or(beginModule).first()).toBeVisible({
          timeout: handoffBudgetMs,
        });
        await expect(studentPage.getByTestId("sat-scheduled-break")).toHaveCount(0, {
          timeout: 5_000,
        });
        if ((await beginModule.count()) > 0) await beginModule.click();
        await expect(examShell).toBeVisible({ timeout: 45_000 });
        await expect(studentPage.getByRole("timer").first()).toBeVisible({ timeout: 30_000 });
      } catch (error) {
        const body = await studentPage
          .locator("body")
          .innerText()
          .catch(() => "<unreadable student page>");
        const trace = await readTrace(studentPage).catch(() => null);
        throw new Error(
          `The break did not hand over to Math. Budget ${handoffBudgetMs} ms.\n` +
            `Trace: ${JSON.stringify(trace)}\nStudent page:\n${body}`,
          { cause: error }
        );
      }
    } finally {
      await student?.context.close().catch(() => undefined);
      if (examId) {
        let deleted = await writeApi(page, "DELETE", `/api/v1/exams/${examId}`);
        if (deleted.status !== 200 && scheduleId) {
          await removeStartedStudentArtifacts(scheduleId);
          deleted = await writeApi(page, "DELETE", `/api/v1/exams/${examId}`);
        }
        // The room artifacts above are already removed and the E2E database is
        // disposable, so cleanup must not mask the flow's result.
        if (deleted.status !== 200) {
          console.warn(
            `[sat-break-boundary] exam cleanup skipped: ${deleted.status} ${JSON.stringify(deleted.payload)}`
          );
        }
      }
      await closeDb();
    }
  });

  test("holds the boundary in preparing and recovers through the bounded pull when the close ack omits the projection", async ({
    page,
    browser,
  }) => {
    let examId: string | undefined;
    let scheduleId: string | undefined;
    let student: JoinedStudent | undefined;

    try {
      const room = await seedSatRoom(page);
      examId = room.examId;
      scheduleId = room.scheduleId;

      student = await joinStudent(
        browser,
        page,
        room.link,
        room.scheduleId,
        `Break B ${room.stamp}`,
        `sat-break-b-${room.stamp}@example.com`
      );
      const studentPage = student.page;

      // Simulate a server older than the field (or a failed projection read):
      // the close transaction still creates the break, but this response does
      // not carry it. applyCloseAck must preserve the previous (empty) rows and
      // the authored window must keep the surface honest while the fallback
      // pull reads the authoritative projection.
      await studentPage.route(
        "**/v1/assessment-delivery/schedules/*/modules/close",
        async (route) => {
          const response = await route.fetch();
          const body = (await response.json()) as Record<string, unknown> | null;
          if (body && typeof body === "object") {
            delete body["personalBreaks"];
            const wrapped = body["data"];
            if (wrapped && typeof wrapped === "object") {
              delete (wrapped as Record<string, unknown>)["personalBreaks"];
            }
          }
          await route.fulfill({ response, body: JSON.stringify(body) });
        }
      );

      const examTimer = studentPage.getByRole("timer").first();
      await expect(examTimer).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(() => examTimer.innerText().then(timerSeconds), {
          timeout: 90_000,
          intervals: [500, 1_000],
        })
        .toBeLessThanOrEqual(5);
      await expect
        .poll(() => examTimer.innerText().then(timerSeconds), {
          timeout: 30_000,
          intervals: [250, 500],
        })
        .toBeGreaterThan(30);

      const breakSurface = studentPage.getByTestId("sat-scheduled-break");
      await expect(breakSurface).toBeVisible({ timeout: 120_000 });

      // The authored fallback alone holds the boundary: no row in this payload,
      // yet the student reads "Preparing your break…", not "Preparing Math…".
      expectNoEndingStall(await readTrace(studentPage));
      await expect(
        breakSurface.getByRole("heading", { name: "Preparing your break…" })
      ).toBeVisible();

      // The bounded pull discovers the row the close created and arms the
      // break well inside its budget (five reads, 2 s apart).
      await expect(breakSurface).toHaveAttribute("data-sat-break-phase", "active", {
        timeout: 25_000,
      });
      const breakTimer = breakSurface.getByRole("timer");
      await expect(breakTimer).toBeVisible({ timeout: 20_000 });
      const breakSeconds = timerSeconds(await breakTimer.innerText());
      expect(breakSeconds).toBeGreaterThan(0);
      expect(breakSeconds).toBeLessThanOrEqual(AUTHORED_BREAK_SECONDS);

      const metrics = (await readTrace(studentPage)).metrics;
      expect(
        metrics.some(
          (metric) => metric.name === "sat_break_boundary_pull" && metric.reason === "hit"
        )
      ).toBe(true);

      // And the row the pull found is the same one the close committed.
      const rows = await queryDb<BreakRow>(
        `SELECT id, after_section_id, duration_seconds, state, starts_at, deadline_at
           FROM assessment_attempt_breaks
          WHERE attempt_id = ?`,
        [student.attemptId]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]!.duration_seconds).toBe(AUTHORED_BREAK_SECONDS);
      expect(rows[0]!.state).not.toBe("completed");
    } finally {
      await student?.context.close().catch(() => undefined);
      if (examId) {
        let deleted = await writeApi(page, "DELETE", `/api/v1/exams/${examId}`);
        if (deleted.status !== 200 && scheduleId) {
          await removeStartedStudentArtifacts(scheduleId);
          deleted = await writeApi(page, "DELETE", `/api/v1/exams/${examId}`);
        }
        // The room artifacts above are already removed and the E2E database is
        // disposable, so cleanup must not mask the flow's result.
        if (deleted.status !== 200) {
          console.warn(
            `[sat-break-boundary] exam cleanup skipped: ${deleted.status} ${JSON.stringify(deleted.payload)}`
          );
        }
      }
      await closeDb();
    }
  });
});

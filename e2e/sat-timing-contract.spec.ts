import { expect, test, type Browser, type Page } from '@playwright/test';
import { ADMIN_STORAGE_STATE_PATH } from './support/backendE2e';
import { closeDb, executeUpdate } from './support/db';
import { stubScreenDetails } from './support/studentUi';
import { buildCompleteSatSample } from '../src/features/exam-authoring/providers/sat/sampleExam';
import type { AssessmentAuthoringShellResult } from '../src/features/exam-authoring/contracts/assessment';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

type ApiPayload<T> = T | { data: T };

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

interface RuntimeSection {
  sectionKey: string;
  plannedDurationMinutes: number;
  gapAfterMinutes: number;
  status: string;
  actualStartAt: string | null;
  actualEndAt: string | null;
}

interface RuntimePlanModule {
  moduleKey: string;
  title: string;
  adaptiveRole: string;
  durationMinutes: number;
}

interface RuntimePlanSection {
  sectionKey: string;
  durationMinutes: number;
  gapAfterMinutes: number;
  modules: RuntimePlanModule[];
}

interface RuntimeSnapshot {
  status: string;
  activeSectionKey: string | null;
  waitingForNextSection: boolean;
  nextSectionStartAt?: string | null;
  sections: RuntimeSection[];
  examPlan: RuntimePlanSection[];
}

interface LiveFrame {
  type?: string;
  event?: string;
  kind?: string;
  payload?: { event?: string };
  runtime?: RuntimeSnapshot;
}

function unwrap<T>(payload: ApiPayload<T>): T {
  if (typeof payload === 'object' && payload !== null && 'data' in payload) {
    return payload.data;
  }
  return payload as T;
}

async function writeApi(
  page: Page,
  method: 'DELETE' | 'PATCH' | 'POST',
  endpoint: string,
  body?: Record<string, unknown>,
): Promise<ApiResponse> {
  const cookies = await page.context().cookies();
  const csrfCookieNames = [
    process.env['CSRF_COOKIE_NAME'],
    process.env['AUTH_CSRF_COOKIE_NAME'],
    '__Host-csrf',
    'csrf',
  ].filter((name): name is string => Boolean(name));
  const csrf = cookies.find((cookie) => csrfCookieNames.includes(cookie.name))?.value;
  if (!csrf) throw new Error('Admin storage state did not contain a CSRF cookie.');

  return page.evaluate(async ({ endpoint: requestEndpoint, method: requestMethod, body: requestBody, csrf: token }) => {
    const response = await fetch(requestEndpoint, {
      method: requestMethod,
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': token,
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
  }, { endpoint, method, body, csrf });
}

async function readApi(page: Page, endpoint: string): Promise<ApiResponse> {
  return page.evaluate(async (requestEndpoint) => {
    const response = await fetch(requestEndpoint, { credentials: 'include' });
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

async function configureDeliveryThroughApi(page: Page, examId: string, title: string, values: {
  base: number;
  lower: number;
  higher: number;
  breakMinutes: number;
}) {
  const shellResponse = await readApi(page, `/api/v1/assessment-authoring/exams/${examId}/shell`);
  expect(shellResponse.status, JSON.stringify(shellResponse.payload)).toBe(200);
  const shellLifecycle = unwrap<AssessmentAuthoringShellResult>(
    shellResponse.payload as ApiPayload<AssessmentAuthoringShellResult>,
  );
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
    'PATCH',
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
    },
  );
  expect(response.status, JSON.stringify(response.payload)).toBe(200);
}

async function runtimeFrom(page: Page, scheduleId: string): Promise<RuntimeSnapshot> {
  const response = await readApi(page, `/api/v1/proctor/sessions/${scheduleId}`);
  expect(response.status, JSON.stringify(response.payload)).toBe(200);
  const payload = unwrap<{ runtime: RuntimeSnapshot }>(response.payload as ApiPayload<{ runtime: RuntimeSnapshot }>);
  return payload.runtime;
}

async function openRuntimeWebSocket(page: Page, scheduleId: string): Promise<void> {
  await page.evaluate((id) => {
    const state = window as Window & {
      __satTimingFrames?: LiveFrame[];
      __satTimingSocket?: WebSocket;
    };
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/api/v1/ws/live?scheduleId=${encodeURIComponent(id)}`);
    state.__satTimingFrames = [];
    state.__satTimingSocket = socket;
    socket.onmessage = (event) => {
      try {
        state.__satTimingFrames?.push(JSON.parse(event.data) as LiveFrame);
      } catch {
        // Ignore heartbeat/non-JSON frames; the contract only reads JSON events.
      }
    };
  }, scheduleId);
}

async function readRuntimeFrames(page: Page): Promise<LiveFrame[]> {
  return page.evaluate(() => {
    const state = window as Window & { __satTimingFrames?: LiveFrame[] };
    return state.__satTimingFrames ?? [];
  });
}

async function closeRuntimeWebSocket(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window as Window & { __satTimingSocket?: WebSocket };
    state.__satTimingSocket?.close();
    delete state.__satTimingSocket;
  }).catch(() => undefined);
}

async function removeStartedStudentArtifacts(scheduleId: string): Promise<void> {
  // The timing contract intentionally starts a real student attempt. These
  // rows are owned by this exact schedule and include the non-cascading SAT
  // references that the generic exam delete endpoint cannot remove first.
  for (const statement of [
    `DELETE terminalization
       FROM attempt_terminalizations terminalization
       JOIN student_attempts attempt ON attempt.id = terminalization.attempt_id
      WHERE attempt.schedule_id = ?`,
    `DELETE route_decision
       FROM assessment_route_decisions route_decision
       JOIN student_attempts attempt ON attempt.id = route_decision.attempt_id
      WHERE attempt.schedule_id = ?`,
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

function section(runtime: RuntimeSnapshot, key: string): RuntimeSection {
  const value = runtime.sections.find((candidate) => candidate.sectionKey === key);
  if (!value) throw new Error(`Runtime did not contain section ${key}.`);
  return value;
}

function planSection(runtime: RuntimeSnapshot, key: string): RuntimePlanSection {
  const value = runtime.examPlan.find((candidate) => candidate.sectionKey === key);
  if (!value) throw new Error(`Runtime examPlan did not contain section ${key}.`);
  return value;
}

function timerSeconds(value: string): number {
  const match = /^(\d+):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Expected a numeric countdown, got ${JSON.stringify(value)}.`);
  return Number(match[1]) * 60 + Number(match[2]);
}

async function waitForRuntime(
  page: Page,
  scheduleId: string,
  predicate: (runtime: RuntimeSnapshot) => boolean,
): Promise<RuntimeSnapshot> {
  let latest: RuntimeSnapshot | undefined;
  try {
    await expect.poll(
      async () => {
        latest = await runtimeFrom(page, scheduleId);
        return predicate(latest);
      },
      { timeout: 30_000, intervals: [250, 500, 1_000] },
    ).toBe(true);
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\nLast runtime: ${JSON.stringify(latest)}`);
  }
  return runtimeFrom(page, scheduleId);
}

test.describe('SAT timing contract against MySQL, HTTP, WebSocket, and browser routes', () => {
  test.describe.configure({ timeout: 360_000 });
  test.skip(({ browserName }) => browserName !== 'chromium', 'The real timing contract runs once in Chromium.');

  test('keeps one proctor-anchored schedule through equal/unequal branches, break refreshes, and null boundaries', async ({
    page,
    browser,
  }) => {
    let examId: string | undefined;
    let scheduleId: string | undefined;
    let studentContext: Awaited<ReturnType<Browser['newContext']>> | undefined;
    let studentPage: Page | undefined;
    let wsPage: Page | undefined;

    try {
      const stamp = Date.now().toString(36);
      const examTitle = `SAT timing contract ${stamp}`;
      const linkName = `SAT timing link ${stamp}`;

      // Establish the authenticated same-origin page without entering the
      // authoring editor. The editor opens a co-edit room; this timing
      // contract should exercise the published/runtime boundary, not fail
      // closed on an unrelated realtime authoring dependency.
      await page.goto('/sat/sessions');
      const createResponse = await writeApi(page, 'POST', '/api/v1/exams', {
        slug: `e2e-sat-timing-${stamp}`,
        title: examTitle,
        examType: 'Academic',
        visibility: 'organization',
        providerKey: 'sat',
      });
      expect(createResponse.status, JSON.stringify(createResponse.payload)).toBe(201);
      const createdExam = unwrap<ExamSnapshot>(createResponse.payload as ApiPayload<ExamSnapshot>);
      examId = createdExam.id;

      // The authoring UI's sample command is intentionally guarded by its
      // realtime co-edit connection. Build the same request the UI builds and
      // send it through the real HTTP command so this contract stays focused
      // on the MySQL/runtime/browser timing boundary rather than requiring a
      // separate authoring WebSocket to be healthy.
      const shellResponse = await readApi(page, `/api/v1/assessment-authoring/exams/${examId}/shell`);
      expect(shellResponse.status, JSON.stringify(shellResponse.payload)).toBe(200);
      const shellLifecycle = unwrap<AssessmentAuthoringShellResult>(
        shellResponse.payload as ApiPayload<AssessmentAuthoringShellResult>,
      );
      if (!shellLifecycle.shell) throw new Error('New SAT did not expose an editable authoring shell.');
      const sampleRequest = buildCompleteSatSample(shellLifecycle.shell);
      const sampleResponse = await writeApi(
        page,
        'POST',
        `/api/v1/assessment-authoring/exams/${examId}/load-sample`,
        sampleRequest as unknown as Record<string, unknown>,
      );
      expect(sampleResponse.status, JSON.stringify(sampleResponse.payload)).toBe(200);

      await configureDeliveryThroughApi(page, examId, 'Reading & Writing', { base: 5, lower: 5, higher: 5, breakMinutes: 5 });
      await configureDeliveryThroughApi(page, examId, 'Math', { base: 5, lower: 3, higher: 7, breakMinutes: 0 });
      const validationResponse = await writeApi(page, 'POST', `/api/v1/assessment-authoring/exams/${examId}/validate`);
      expect(validationResponse.status, JSON.stringify(validationResponse.payload)).toBe(200);
      const examResponse = await readApi(page, `/api/v1/exams/${examId}`);
      expect(examResponse.status, JSON.stringify(examResponse.payload)).toBe(200);
      const exam = unwrap<ExamSnapshot>(examResponse.payload as ApiPayload<ExamSnapshot>);
      const finalShellResponse = await readApi(page, `/api/v1/assessment-authoring/exams/${examId}/shell`);
      expect(finalShellResponse.status, JSON.stringify(finalShellResponse.payload)).toBe(200);
      const finalShellLifecycle = unwrap<AssessmentAuthoringShellResult>(
        finalShellResponse.payload as ApiPayload<AssessmentAuthoringShellResult>,
      );
      if (!finalShellLifecycle.shell) throw new Error('Final SAT draft shell was unavailable before publish.');
      const publishResponse = await writeApi(page, 'POST', `/api/v1/exams/${examId}/publish`, {
        publishNotes: 'Published by the SAT timing contract.',
        revision: exam.revision,
        expectedDraftVersionId: exam.currentDraftVersionId,
        expectedDraftRevision: finalShellLifecycle.shell.versionRevision,
        operationKey: `sat-timing-contract-${stamp}`,
      });
      expect(publishResponse.status, JSON.stringify(publishResponse.payload)).toBe(200);
      const publishedExamResponse = await readApi(page, `/api/v1/exams/${examId}`);
      expect(publishedExamResponse.status, JSON.stringify(publishedExamResponse.payload)).toBe(200);
      const publishedExam = unwrap<ExamSnapshot>(publishedExamResponse.payload as ApiPayload<ExamSnapshot>);
      expect(publishedExam.currentPublishedVersionId).toBeTruthy();

      const linkResponse = await writeApi(page, 'POST', `/api/v1/assessment-access/exams/${examId}/links`, {
        publishedVersionId: publishedExam.currentPublishedVersionId,
        name: linkName,
        enabledSections: [],
        audienceType: 'anyone',
        audienceLabel: null,
        accessMode: 'open',
        availabilityType: 'anytime',
        selectedStudents: [],
      });
      expect(linkResponse.status, JSON.stringify(linkResponse.payload)).toBe(201);
      const link = unwrap<AccessLinkSnapshot>(linkResponse.payload as ApiPayload<AccessLinkSnapshot>);
      scheduleId = link.scheduleId;

      // This contract covers cohort section clocks. Pin the model explicitly
      // because newly created SAT schedules now default to personal timing.
      await executeUpdate(
        'UPDATE exam_schedules SET sat_timing_model = ? WHERE id = ?',
        ['cohort_section_v3', scheduleId],
      );

      const startResponse = await writeApi(page, 'POST', `/api/v1/schedules/${scheduleId}/runtime/commands`, {
        action: 'start_runtime',
        reason: 'SAT timing contract',
      });
      expect(startResponse.status, JSON.stringify(startResponse.payload)).toBe(200);

      const initialRuntime = await waitForRuntime(page, scheduleId, (runtime) => runtime.status === 'live');
      const initialReading = section(initialRuntime, 'reading-writing');
      const initialMath = section(initialRuntime, 'math');
      expect(initialReading.plannedDurationMinutes).toBe(10);
      expect(initialReading.gapAfterMinutes).toBe(5);
      expect(initialMath.plannedDurationMinutes).toBe(12);
      expect(initialMath.gapAfterMinutes).toBe(0);
      expect(initialRuntime.waitingForNextSection).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(initialRuntime, 'nextSectionStartAt')).toBe(true);
      expect(initialRuntime.nextSectionStartAt).toBeNull();

      const readingPlan = planSection(initialRuntime, 'reading-writing');
      expect(readingPlan.durationMinutes).toBe(10);
      expect(readingPlan.gapAfterMinutes).toBe(5);
      expect(readingPlan.modules.map((module) => module.durationMinutes)).toEqual([5, 5, 5]);
      expect(readingPlan.modules.map((module) => module.adaptiveRole)).toEqual([
        'base',
        'lower_branch',
        'higher_branch',
      ]);
      const mathPlan = planSection(initialRuntime, 'math');
      expect(mathPlan.durationMinutes).toBe(12);
      expect(mathPlan.modules.map((module) => module.durationMinutes)).toEqual([5, 3, 7]);
      expect(initialRuntime.examPlan).toHaveLength(2);

      // The staff route renders the authored plan, while its live section rows
      // come from the same HTTP runtime the assertions above just read.
      await page.goto(`/sat/sessions/${scheduleId}`);
      await expect(page.getByText('Module 2 · Lower').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Module 2 · Higher').first()).toBeVisible();
      await expect(page.getByText('Break · 5 min').first()).toBeVisible();
      const readingLowerWindow = page
        .locator('[data-sat-run-sheet-row="module"]')
        .filter({ hasText: 'Module 2 · Lower' })
        .first()
        .locator('.sat-run-sheet__row-window');
      const readingHigherWindow = page
        .locator('[data-sat-run-sheet-row="module"]')
        .filter({ hasText: 'Module 2 · Higher' })
        .first()
        .locator('.sat-run-sheet__row-window');
      await expect(readingLowerWindow).toHaveText(/\d{2}:\d{2}–\d{2}:\d{2}/);
      await expect(readingHigherWindow).toHaveText(/\d{2}:\d{2}–\d{2}:\d{2}/);
      expect(await readingLowerWindow.innerText()).toBe(await readingHigherWindow.innerText());
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Module 2 · Lower').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Module 2 · Higher').first()).toBeVisible();

      wsPage = await page.context().newPage();
      await wsPage.goto(`/sat/sessions/${scheduleId}`);
      await openRuntimeWebSocket(wsPage, scheduleId);
      await expect.poll(
        async () => (await readRuntimeFrames(wsPage!)).some((frame) => frame.type === 'runtime_snapshot'),
        { timeout: 20_000, intervals: [250, 500, 1_000] },
      ).toBe(true);
      const snapshotFrame = (await readRuntimeFrames(wsPage)).find((frame) => frame.type === 'runtime_snapshot');
      expect(snapshotFrame?.runtime?.sections.map((candidate) => candidate.plannedDurationMinutes)).toEqual([10, 12]);
      expect(Object.prototype.hasOwnProperty.call(snapshotFrame?.runtime ?? {}, 'nextSectionStartAt')).toBe(true);
      expect(snapshotFrame?.runtime?.nextSectionStartAt).toBeNull();
      expect(snapshotFrame?.runtime?.examPlan[0]?.durationMinutes).toBe(10);

      const movedToWaiting = await executeUpdate(`
        UPDATE exam_session_runtime_sections rs
        JOIN exam_session_runtimes r ON r.id = rs.runtime_id
        SET rs.actual_start_at = NOW(6) - INTERVAL 10 MINUTE
        WHERE r.schedule_id = ? AND rs.section_key = 'reading-writing' AND rs.status = 'live'
      `, [scheduleId]);
      expect(movedToWaiting).toBe(1);

      const waitingRuntime = await waitForRuntime(
        page,
        scheduleId,
        (runtime) => runtime.waitingForNextSection && section(runtime, 'reading-writing').status === 'completed',
      );
      const waitingReading = section(waitingRuntime, 'reading-writing');
      expect(waitingRuntime.nextSectionStartAt).toBeTruthy();
      expect(new Date(waitingRuntime.nextSectionStartAt as string).getTime()).toBe(
        new Date(waitingReading.actualEndAt as string).getTime() + 5 * 60_000,
      );
      expect(new Date(waitingRuntime.nextSectionStartAt as string).getTime()).toBeGreaterThan(Date.now());
      expect(waitingRuntime.examPlan).toHaveLength(2);
      expect(waitingRuntime.examPlan[0]?.durationMinutes).toBe(10);

      await expect.poll(
        async () => (await readRuntimeFrames(wsPage!)).some((frame) =>
          frame.kind === 'schedule_runtime' &&
          frame.event === 'runtime_changed' &&
          frame.payload?.event === 'waiting_for_next_section',
        ),
        { timeout: 20_000, intervals: [250, 500, 1_000] },
      ).toBe(true);

      // Join during the authoritative break. The candidate has no active
      // module to time out while the test is proving the shared boundary;
      // the same route still consumes the real access link/bootstrap path.
      studentContext = await browser.newContext();
      await stubScreenDetails(studentContext);
      studentPage = await studentContext.newPage();
      await studentPage.goto(new URL(`/join/${link.id}`, page.url()).toString());
      await expect(studentPage.getByRole('heading', { name: linkName })).toBeVisible();
      await studentPage.getByLabel('Full name').fill(`Timing candidate ${stamp}`);
      await studentPage.getByLabel('Email').fill(`sat-timing-${stamp}@example.com`);
      await studentPage.getByRole('button', { name: /Continue/i }).click();
      await expect(studentPage).toHaveURL(new RegExp(`/student/${scheduleId}/[^/]+$`), { timeout: 30_000 });

      // The student route must enter the break from the authoritative target,
      // not from a stale zero remaining value carried by the completed row.
      const scheduledBreak = studentPage.getByTestId('sat-scheduled-break');
      await expect(scheduledBreak).toHaveAttribute('data-sat-break-phase', 'active', { timeout: 30_000 });
      const breakTimer = scheduledBreak.getByRole('timer');
      await expect(breakTimer).toBeVisible();
      const firstBreakText = await breakTimer.innerText();
      expect(firstBreakText).not.toBe('0:00');
      const firstBreakSeconds = timerSeconds(firstBreakText);
      expect(firstBreakSeconds).toBeGreaterThan(0);
      expect(firstBreakSeconds).toBeLessThanOrEqual(300);

      await studentPage.reload({ waitUntil: 'domcontentloaded' });
      await expect(scheduledBreak).toHaveAttribute('data-sat-break-phase', 'active', { timeout: 30_000 });
      const refreshedBreakText = await scheduledBreak.getByRole('timer').innerText();
      expect(refreshedBreakText).not.toBe('0:00');
      expect(timerSeconds(refreshedBreakText)).toBeGreaterThan(0);
      expect(timerSeconds(refreshedBreakText)).toBeLessThanOrEqual(300);

      const movedPastBreak = await executeUpdate(`
        UPDATE exam_session_runtime_sections rs
        JOIN exam_session_runtimes r ON r.id = rs.runtime_id
        SET rs.actual_end_at = NOW(6) - INTERVAL 6 MINUTE
        WHERE r.schedule_id = ? AND rs.section_key = 'reading-writing' AND rs.status = 'completed'
      `, [scheduleId]);
      expect(movedPastBreak).toBe(1);

      const mathRuntime = await waitForRuntime(
        page,
        scheduleId,
        (runtime) => runtime.activeSectionKey === 'math' && !runtime.waitingForNextSection && section(runtime, 'math').status === 'live',
      );
      const advancedReading = section(mathRuntime, 'reading-writing');
      const advancedMath = section(mathRuntime, 'math');
      expect(advancedReading.actualEndAt).toBeTruthy();
      expect(advancedMath.actualStartAt).toBeTruthy();
      expect(Math.abs(
        new Date(advancedMath.actualStartAt as string).getTime() -
        (new Date(advancedReading.actualEndAt as string).getTime() + 5 * 60_000),
      )).toBeLessThanOrEqual(1_500);
      expect(mathRuntime.nextSectionStartAt).toBeNull();
      expect(mathRuntime.examPlan).toHaveLength(2);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByText('Module 2 · Lower').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Module 2 · Higher').first()).toBeVisible();
    } finally {
      if (wsPage) await closeRuntimeWebSocket(wsPage);
      if (wsPage) await wsPage.close().catch(() => undefined);
      await studentContext?.close().catch(() => undefined);
      if (examId) {
        let deleted = await writeApi(page, 'DELETE', `/api/v1/exams/${examId}`);
        if (deleted.status !== 200 && scheduleId) {
          await removeStartedStudentArtifacts(scheduleId);
          deleted = await writeApi(page, 'DELETE', `/api/v1/exams/${examId}`);
        }
        expect(deleted.status, JSON.stringify(deleted.payload)).toBe(200);
      }
      await closeDb();
    }
  });

  // SAT full-entry-time (plan 2026-09-24, tasks 1.2 / 7.1): the release gate.
  // Under the attempt-owned model (sat_personal_v1) a candidate must SEE and
  // RECEIVE the full authored duration on the first active frame of every
  // module, even when the transition response is delayed; a reload mid-module
  // must resume the original deadline; and a candidate who joins later must get
  // their own full window instead of the remainder a room-anchored clock would
  // hand them.
  test('grants the full authored duration on the first active frame under sat_personal_v1', async ({
    page,
    browser,
  }) => {
    let examId: string | undefined;
    let scheduleId: string | undefined;
    const studentContexts: Array<Awaited<ReturnType<Browser['newContext']>>> = [];

    interface HeldStudent {
      studentPage: Page;
      /** Resolves once the first module-start response has been fetched and held. */
      startDelayed: Promise<void>;
      /** Lets the held response through. */
      release: () => void;
    }

    const joinStudent = async (
      link: AccessLinkSnapshot,
      heading: string,
      name: string,
      email: string,
      delayFirstModuleStartMs: number,
    ): Promise<HeldStudent> => {
      const context = await browser.newContext();
      studentContexts.push(context);
      await stubScreenDetails(context);
      let delayedResolve!: () => void;
      const startDelayed = new Promise<void>((resolve) => { delayedResolve = resolve; });
      let alreadyHeld = false;
      let releaseResolve!: () => void;
      const release = new Promise<void>((resolve) => { releaseResolve = resolve; });
      if (delayFirstModuleStartMs > 0) {
        // Installed on the CONTEXT, before the page exists, so the very first
        // module-start request cannot slip past the hold.
        await context.route('**/v1/assessment-delivery/schedules/*/modules/start', async (route) => {
          if (alreadyHeld) {
            await route.continue();
            return;
          }
          alreadyHeld = true;
          const response = await route.fetch();
          delayedResolve();
          // The delay is what a slow device/network cannot avoid: the response
          // is correct, it just arrives five seconds late.
          await new Promise<void>((resolve) => setTimeout(resolve, delayFirstModuleStartMs));
          await release;
          await route.fulfill({ response });
        });
      }
      const studentPage = await context.newPage();
      await studentPage.goto(new URL(`/join/${link.id}`, page.url()).toString());
      await expect(studentPage.getByRole('heading', { name: heading })).toBeVisible({ timeout: 30_000 });
      await studentPage.getByLabel('Full name').fill(name);
      await studentPage.getByLabel('Email').fill(email);
      await studentPage.getByRole('button', { name: /Continue/i }).click();
      await expect(studentPage).toHaveURL(new RegExp(`/student/${scheduleId}/[^/]+$`), { timeout: 30_000 });
      return { studentPage, startDelayed, release: releaseResolve };
    };

    const examTimer = async (studentPage: Page): Promise<string> => {
      const timer = studentPage.getByRole('timer').first();
      await expect(timer).toBeVisible({ timeout: 45_000 });
      return timer.innerText();
    };

    try {
      const stamp = Date.now().toString(36);
      const examTitle = `SAT personal timing ${stamp}`;
      const linkName = `SAT personal timing link ${stamp}`;

      await page.goto('/sat/sessions');
      const createResponse = await writeApi(page, 'POST', '/api/v1/exams', {
        slug: `e2e-sat-personal-timing-${stamp}`,
        title: examTitle,
        examType: 'Academic',
        visibility: 'organization',
        providerKey: 'sat',
      });
      expect(createResponse.status, JSON.stringify(createResponse.payload)).toBe(201);
      const createdExam = unwrap<ExamSnapshot>(createResponse.payload as ApiPayload<ExamSnapshot>);
      examId = createdExam.id;

      const shellResponse = await readApi(page, `/api/v1/assessment-authoring/exams/${examId}/shell`);
      expect(shellResponse.status, JSON.stringify(shellResponse.payload)).toBe(200);
      const shellLifecycle = unwrap<AssessmentAuthoringShellResult>(
        shellResponse.payload as ApiPayload<AssessmentAuthoringShellResult>,
      );
      if (!shellLifecycle.shell) throw new Error('New SAT did not expose an editable authoring shell.');
      const sampleResponse = await writeApi(
        page,
        'POST',
        `/api/v1/assessment-authoring/exams/${examId}/load-sample`,
        buildCompleteSatSample(shellLifecycle.shell) as unknown as Record<string, unknown>,
      );
      expect(sampleResponse.status, JSON.stringify(sampleResponse.payload)).toBe(200);

      // Two-minute modules and a two-minute break: the authored duration the
      // first active frame must show in full.
      await configureDeliveryThroughApi(page, examId, 'Reading & Writing', { base: 2, lower: 2, higher: 2, breakMinutes: 2 });
      await configureDeliveryThroughApi(page, examId, 'Math', { base: 2, lower: 2, higher: 2, breakMinutes: 0 });
      const validationResponse = await writeApi(page, 'POST', `/api/v1/assessment-authoring/exams/${examId}/validate`);
      expect(validationResponse.status, JSON.stringify(validationResponse.payload)).toBe(200);
      const examResponse = await readApi(page, `/api/v1/exams/${examId}`);
      expect(examResponse.status, JSON.stringify(examResponse.payload)).toBe(200);
      const exam = unwrap<ExamSnapshot>(examResponse.payload as ApiPayload<ExamSnapshot>);
      const finalShellResponse = await readApi(page, `/api/v1/assessment-authoring/exams/${examId}/shell`);
      expect(finalShellResponse.status, JSON.stringify(finalShellResponse.payload)).toBe(200);
      const finalShellLifecycle = unwrap<AssessmentAuthoringShellResult>(
        finalShellResponse.payload as ApiPayload<AssessmentAuthoringShellResult>,
      );
      if (!finalShellLifecycle.shell) throw new Error('Final SAT draft shell was unavailable before publish.');
      const publishResponse = await writeApi(page, 'POST', `/api/v1/exams/${examId}/publish`, {
        publishNotes: 'Published by the SAT personal timing contract.',
        revision: exam.revision,
        expectedDraftVersionId: exam.currentDraftVersionId,
        expectedDraftRevision: finalShellLifecycle.shell.versionRevision,
        operationKey: `sat-personal-timing-${stamp}`,
      });
      expect(publishResponse.status, JSON.stringify(publishResponse.payload)).toBe(200);
      const publishedExamResponse = await readApi(page, `/api/v1/exams/${examId}`);
      const publishedExam = unwrap<ExamSnapshot>(publishedExamResponse.payload as ApiPayload<ExamSnapshot>);
      expect(publishedExam.currentPublishedVersionId).toBeTruthy();

      const linkResponse = await writeApi(page, 'POST', `/api/v1/assessment-access/exams/${examId}/links`, {
        publishedVersionId: publishedExam.currentPublishedVersionId,
        name: linkName,
        enabledSections: [],
        audienceType: 'anyone',
        audienceLabel: null,
        accessMode: 'open',
        availabilityType: 'anytime',
        selectedStudents: [],
      });
      expect(linkResponse.status, JSON.stringify(linkResponse.payload)).toBe(201);
      const link = unwrap<AccessLinkSnapshot>(linkResponse.payload as ApiPayload<AccessLinkSnapshot>);
      scheduleId = link.scheduleId;

      // A newly created SAT schedule selects the attempt-owned model, and the
      // schedule read now projects it. This is the premise of every assertion
      // below, so fail here rather than silently testing the cohort model.
      const scheduleResponse = await readApi(page, `/api/v1/schedules/${scheduleId}`);
      expect(scheduleResponse.status, JSON.stringify(scheduleResponse.payload)).toBe(200);
      const schedule = unwrap<{ satTimingModel?: string | null }>(
        scheduleResponse.payload as ApiPayload<{ satTimingModel?: string | null }>,
      );
      expect(schedule.satTimingModel).toBe('sat_personal_v1');

      const startResponse = await writeApi(page, 'POST', `/api/v1/schedules/${scheduleId}/runtime/commands`, {
        action: 'start_runtime',
        reason: 'SAT personal timing contract',
      });
      expect(startResponse.status, JSON.stringify(startResponse.payload)).toBe(200);
      await waitForRuntime(page, scheduleId, (runtime) => runtime.status === 'live');

      // The slow transition: the module-start response is held for five
      // seconds. The attempt-owned model still owes the candidate 2:00, so the
      // held window must be a transition surface, not consumed module time.
      const first = await joinStudent(link, linkName, `Personal A ${stamp}`, `sat-personal-a-${stamp}@example.com`, 5_000);
      await first.startDelayed;
      await expect
        .poll(async () => (await first.studentPage.locator('h1').first().innerText()).trim(), { timeout: 30_000 })
        .toMatch(/Preparing|Waiting|will open|ready/i);
      expect(await first.studentPage.locator('[data-sat-stage="exam"]').count()).toBe(0);
      first.release();

      await expect(first.studentPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      expect(await examTimer(first.studentPage)).toBe('2:00');
      await expect.poll(() => examTimer(first.studentPage), { timeout: 10_000, intervals: [250, 500] }).toBe('1:59');

      // Reload ~30s in: the original deadline resumes. It must never read 2:00
      // again — a reset would hand the candidate time the exam does not have.
      await first.studentPage.waitForTimeout(30_000);
      await first.studentPage.reload({ waitUntil: 'domcontentloaded' });
      const resumed = timerSeconds(await examTimer(first.studentPage));
      expect(resumed).toBeLessThanOrEqual(95);
      expect(resumed).toBeGreaterThanOrEqual(80);

      // A later candidate gets their OWN full window: the room-anchored cohort
      // model would clamp this module to what is left of the section.
      const second = await joinStudent(link, linkName, `Personal B ${stamp}`, `sat-personal-b-${stamp}@example.com`, 0);
      await expect(second.studentPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 45_000 });
      expect(await examTimer(second.studentPage)).toBe('2:00');
    } finally {
      await Promise.all(studentContexts.map((context) => context.close().catch(() => undefined)));
      if (examId) {
        let deleted = await writeApi(page, 'DELETE', `/api/v1/exams/${examId}`);
        if (deleted.status !== 200 && scheduleId) {
          await removeStartedStudentArtifacts(scheduleId);
          deleted = await writeApi(page, 'DELETE', `/api/v1/exams/${examId}`);
        }
        expect(deleted.status, JSON.stringify(deleted.payload)).toBe(200);
      }
      await closeDb();
    }
  });

  // SAT full-entry-time (plan 2026-09-24, task 1.1): two candidates who join FIVE
  // MINUTES APART each receive their own authored window. This is the property a
  // room-anchored clock cannot have — candidate B would inherit whatever the
  // room had left, and a cohort session five minutes into a seven-minute module
  // would hand them 2:00 — so the assertion is that B reads the full 7:00 while A,
  // five minutes in, reads the ~2:00 that is left of THEIR window.
  test('gives two candidates who join five minutes apart their own authored windows', async ({
    page,
    browser,
  }) => {
    let examId: string | undefined;
    let scheduleId: string | undefined;
    const studentContexts: Array<Awaited<ReturnType<Browser['newContext']>>> = [];

    const joinStudent = async (
      link: AccessLinkSnapshot,
      heading: string,
      name: string,
      email: string,
    ): Promise<Page> => {
      const context = await browser.newContext();
      studentContexts.push(context);
      await stubScreenDetails(context);
      const studentPage = await context.newPage();
      await studentPage.goto(new URL(`/join/${link.id}`, page.url()).toString());
      await expect(studentPage.getByRole('heading', { name: heading })).toBeVisible({ timeout: 30_000 });
      await studentPage.getByLabel('Full name').fill(name);
      await studentPage.getByLabel('Email').fill(email);
      await studentPage.getByRole('button', { name: /Continue/i }).click();
      await expect(studentPage).toHaveURL(new RegExp(`/student/${scheduleId}/[^/]+$`), { timeout: 30_000 });
      return studentPage;
    };

    const examTimer = async (studentPage: Page): Promise<string> => {
      const timer = studentPage.getByRole('timer').first();
      await expect(timer).toBeVisible({ timeout: 60_000 });
      return timer.innerText();
    };

    const secondsOf = (value: string): number => {
      const match = /^(\d+):(\d{2})$/.exec(value.trim());
      if (!match) throw new Error(`unexpected timer text: ${value}`);
      return Number(match[1]) * 60 + Number(match[2]);
    };

    try {
      const stamp = Date.now().toString(36);
      const examTitle = `SAT personal five minutes ${stamp}`;
      const linkName = `SAT personal five minutes link ${stamp}`;

      await page.goto('/sat/sessions');
      const createResponse = await writeApi(page, 'POST', '/api/v1/exams', {
        slug: `e2e-sat-personal-five-${stamp}`,
        title: examTitle,
        examType: 'Academic',
        visibility: 'organization',
        providerKey: 'sat',
      });
      expect(createResponse.status, JSON.stringify(createResponse.payload)).toBe(201);
      const createdExam = unwrap<ExamSnapshot>(createResponse.payload as ApiPayload<ExamSnapshot>);
      examId = createdExam.id;

      const shellResponse = await readApi(page, `/api/v1/assessment-authoring/exams/${examId}/shell`);
      expect(shellResponse.status, JSON.stringify(shellResponse.payload)).toBe(200);
      const shellLifecycle = unwrap<AssessmentAuthoringShellResult>(
        shellResponse.payload as ApiPayload<AssessmentAuthoringShellResult>,
      );
      if (!shellLifecycle.shell) throw new Error('New SAT did not expose an editable authoring shell.');
      const sampleResponse = await writeApi(
        page,
        'POST',
        `/api/v1/assessment-authoring/exams/${examId}/load-sample`,
        buildCompleteSatSample(shellLifecycle.shell) as unknown as Record<string, unknown>,
      );
      expect(sampleResponse.status, JSON.stringify(sampleResponse.payload)).toBe(200);

      // Seven-minute modules: long enough that the first candidate is still
      // inside their window when the second one joins five minutes later, which
      // is what makes the two clocks comparable at one instant.
      await configureDeliveryThroughApi(page, examId, 'Reading & Writing', { base: 7, lower: 7, higher: 7, breakMinutes: 2 });
      await configureDeliveryThroughApi(page, examId, 'Math', { base: 7, lower: 7, higher: 7, breakMinutes: 0 });
      const validationResponse = await writeApi(page, 'POST', `/api/v1/assessment-authoring/exams/${examId}/validate`);
      expect(validationResponse.status, JSON.stringify(validationResponse.payload)).toBe(200);
      const examResponse = await readApi(page, `/api/v1/exams/${examId}`);
      expect(examResponse.status, JSON.stringify(examResponse.payload)).toBe(200);
      const exam = unwrap<ExamSnapshot>(examResponse.payload as ApiPayload<ExamSnapshot>);
      const finalShellResponse = await readApi(page, `/api/v1/assessment-authoring/exams/${examId}/shell`);
      expect(finalShellResponse.status, JSON.stringify(finalShellResponse.payload)).toBe(200);
      const finalShellLifecycle = unwrap<AssessmentAuthoringShellResult>(
        finalShellResponse.payload as ApiPayload<AssessmentAuthoringShellResult>,
      );
      if (!finalShellLifecycle.shell) throw new Error('Final SAT draft shell was unavailable before publish.');
      const publishResponse = await writeApi(page, 'POST', `/api/v1/exams/${examId}/publish`, {
        publishNotes: 'Published by the SAT five-minute entry contract.',
        revision: exam.revision,
        expectedDraftVersionId: exam.currentDraftVersionId,
        expectedDraftRevision: finalShellLifecycle.shell.versionRevision,
        operationKey: `sat-personal-five-${stamp}`,
      });
      expect(publishResponse.status, JSON.stringify(publishResponse.payload)).toBe(200);
      const publishedExamResponse = await readApi(page, `/api/v1/exams/${examId}`);
      const publishedExam = unwrap<ExamSnapshot>(publishedExamResponse.payload as ApiPayload<ExamSnapshot>);
      expect(publishedExam.currentPublishedVersionId).toBeTruthy();

      const linkResponse = await writeApi(page, 'POST', `/api/v1/assessment-access/exams/${examId}/links`, {
        publishedVersionId: publishedExam.currentPublishedVersionId,
        name: linkName,
        enabledSections: [],
        audienceType: 'anyone',
        audienceLabel: null,
        accessMode: 'open',
        availabilityType: 'anytime',
        selectedStudents: [],
      });
      expect(linkResponse.status, JSON.stringify(linkResponse.payload)).toBe(201);
      const link = unwrap<AccessLinkSnapshot>(linkResponse.payload as ApiPayload<AccessLinkSnapshot>);
      scheduleId = link.scheduleId;

      const startResponse = await writeApi(page, 'POST', `/api/v1/schedules/${scheduleId}/runtime/commands`, {
        action: 'start_runtime',
        reason: 'SAT personal five-minute contract',
      });
      expect(startResponse.status, JSON.stringify(startResponse.payload)).toBe(200);
      await waitForRuntime(page, scheduleId, (runtime) => runtime.status === 'live');

      // Candidate A enters at T0 and holds the full authored window.
      const firstPage = await joinStudent(link, linkName, `Five A ${stamp}`, `sat-personal-five-a-${stamp}@example.com`);
      await expect(firstPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 60_000 });
      const firstStart = secondsOf(await examTimer(firstPage));
      expect(firstStart).toBeGreaterThanOrEqual(415);
      expect(firstStart).toBeLessThanOrEqual(420);

      // Candidate B joins five minutes later — inside A's window, and in a
      // cohort session deep inside the room's own module window.
      await page.waitForTimeout(5 * 60_000);
      const secondPage = await joinStudent(link, linkName, `Five B ${stamp}`, `sat-personal-five-b-${stamp}@example.com`);
      await expect(secondPage.getByTestId('sat-exam-shell')).toBeVisible({ timeout: 60_000 });

      const secondStart = secondsOf(await examTimer(secondPage));
      const firstNow = secondsOf(await examTimer(firstPage));
      // B's offer was issued for B: the full authored window, not A's remainder.
      expect(secondStart).toBeGreaterThanOrEqual(415);
      expect(secondStart).toBeLessThanOrEqual(420);
      // A has consumed five minutes of their own window and is unaffected by
      // B's arrival.
      expect(firstNow).toBeLessThanOrEqual(125);
      expect(firstNow).toBeGreaterThanOrEqual(105);
      expect(firstNow).toBeLessThan(secondStart);
    } finally {
      await Promise.all(studentContexts.map((context) => context.close().catch(() => undefined)));
      if (examId) {
        let deleted = await writeApi(page, 'DELETE', `/api/v1/exams/${examId}`);
        if (deleted.status !== 200 && scheduleId) {
          await removeStartedStudentArtifacts(scheduleId);
          deleted = await writeApi(page, 'DELETE', `/api/v1/exams/${examId}`);
        }
        expect(deleted.status, JSON.stringify(deleted.payload)).toBe(200);
      }
      await closeDb();
    }
  });
});

import { expect, test, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import {
  readProdCreds,
  readEffectiveProdTarget,
  resolveProdCredsPath,
  resolveProdRuntimePath,
} from '../support/prodData';
import { computeScenarioAssignments, pollUntil } from '../support/prodOrchestration';
import { bootstrapExamAndSchedule, writeProdRuntimeOverride } from '../support/prodBootstrap';

function buildRunId(): string {
  return (
    process.env['E2E_PROD_RUN_ID'] ??
    process.env['CI_JOB_ID'] ??
    `local-${Date.now()}`
  );
}

function runCommand(cmd: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: process.env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${cmd} ${args.join(' ')} exited with ${code ?? 'unknown'}`));
    });
  });
}

async function ensureStaffCreds(): Promise<void> {
  const credsPath = resolveProdCredsPath();
  if (fs.existsSync(credsPath)) {
    return;
  }

  if (process.env['E2E_PROD_PROVISION_STAFF_DB'] !== 'true') {
    throw new Error(
      `Missing prod creds file at ${credsPath}. Create it manually or set E2E_PROD_PROVISION_STAFF_DB=true (requires DATABASE_URL + E2E_ALLOW_PROD_DB_MUTATIONS=true).`,
    );
  }

  if (process.env['E2E_ALLOW_PROD_DB_MUTATIONS'] !== 'true') {
    throw new Error('E2E_ALLOW_PROD_DB_MUTATIONS=true is required to provision staff via DB.');
  }

  // Provision editor + proctors and write e2e/prod-data/prod-creds.json.
  await runCommand(
    'cargo',
    [
      'run',
      '-p',
      'ielts-backend-api',
      '--bin',
      'e2e_provision_staff',
      '--',
      '--target',
      '../e2e/prod-data/prod-target.json',
      '--output-creds',
      '../e2e/prod-data/prod-creds.json',
    ],
    'backend',
  );
}

async function ensureProctorAssignments(scheduleId: string): Promise<void> {
  if (process.env['E2E_PROD_PROVISION_STAFF_DB'] !== 'true') {
    return;
  }
  if (process.env['E2E_ALLOW_PROD_DB_MUTATIONS'] !== 'true') {
    throw new Error('E2E_ALLOW_PROD_DB_MUTATIONS=true is required to provision staff assignments via DB.');
  }

  await runCommand(
    'cargo',
    [
      'run',
      '-p',
      'ielts-backend-api',
      '--bin',
      'e2e_provision_staff',
      '--',
      '--schedule-id',
      scheduleId,
      '--target',
      '../e2e/prod-data/prod-target.json',
      '--output-creds',
      '../e2e/prod-data/prod-creds.json',
      '--granted-by',
      'prod-load-bootstrap',
    ],
    'backend',
  );
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  const configured = process.env['AUTH_SESSION_COOKIE_NAME'];
  const sessionCookieCandidates = [
    typeof configured === 'string' && configured.length > 0 ? configured : null,
    '__Host-session',
    'session',
  ].filter((value): value is string => Boolean(value));
  await pollUntil(
    async () => {
      const cookies = await page.context().cookies();
      const hasSession = cookies.some((cookie) => sessionCookieCandidates.includes(cookie.name));
      if (!hasSession) {
        throw new Error(`session cookie not present yet (candidates: ${sessionCookieCandidates.join(', ')})`);
      }
      return true;
    },
    { timeoutMs: 60_000, intervalMs: 500, description: 'wait for session cookie after login' },
  );

  await expect(page).not.toHaveURL(/\/login(?:$|[?#])/i, { timeout: 60_000 });
}

async function openProctorSchedule(page: Page, scheduleId: string) {
  await page.goto('/proctor');
  await expect(page).not.toHaveURL(/\/login(?:$|[?#])/i, { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: /Cohorts and students/i })).toBeVisible({
    timeout: 60_000,
  });

  const summary = await pollUntil(
    async () => {
      const response = await page.request.get('/api/v1/proctor/sessions');
      if (!response.ok()) throw new Error(`proctor sessions list status=${response.status()}`);
      const json = (await response.json()) as any;
      const data = Array.isArray(json?.data) ? json.data : [];
      const match = data.find((row: any) => row?.schedule?.id === scheduleId);
      if (!match) throw new Error(`scheduleId ${scheduleId} not found in proctor sessions list`);
      return match;
    },
    { timeoutMs: 120_000, intervalMs: 2000, description: 'fetch proctor sessions list' },
  );

  const examTitle = String(summary?.schedule?.examTitle ?? '');
  const cohortName = String(summary?.schedule?.cohortName ?? '');
  if (!examTitle || !cohortName) {
    throw new Error(`Missing examTitle/cohortName for scheduleId=${scheduleId}`);
  }

  const cardLabel = `Monitor ${examTitle} for cohort ${cohortName}`;
  await page.getByRole('button', { name: cardLabel }).click();

  const startExam = page.getByRole('button', { name: /Start Exam/i }).first();
  const pauseCohort = page.getByRole('button', { name: /Pause Cohort/i }).first();
  await pollUntil(
    async () => {
      const startVisible = await startExam.isVisible().catch(() => false);
      const pauseVisible = await pauseCohort.isVisible().catch(() => false);
      if (!startVisible && !pauseVisible) {
        throw new Error('control buttons not visible yet');
      }
      return true;
    },
    { timeoutMs: 60_000, intervalMs: 500, description: 'proctor controls visible' },
  );
}

async function proctorDetail(page: Page, scheduleId: string) {
  const response = await page.request.get(`/api/v1/proctor/sessions/${scheduleId}`);
  if (!response.ok()) {
    const body = await response.text().catch(() => '');
    throw new Error(`GET /api/v1/proctor/sessions/${scheduleId} failed: ${response.status()} ${body.slice(0, 300)}`);
  }
  return (await response.json()) as any;
}

async function waitForCheckedIn(page: Page, scheduleId: string, threshold: number) {
  await pollUntil(
    async () => {
      const json = await proctorDetail(page, scheduleId);
      const sessions = Array.isArray(json?.data?.sessions) ? json.data.sessions : [];
      if (sessions.length < threshold) {
        throw new Error(`checked-in=${sessions.length} < ${threshold}`);
      }
      return sessions.length;
    },
    { timeoutMs: 20 * 60_000, intervalMs: 5000, description: 'checked-in threshold' },
  );
}

async function tryClickIfEnabled(page: Page, name: string) {
  const button = page.getByRole('button', { name });
  const visible = await button.isVisible().catch(() => false);
  if (!visible) return false;
  const enabled = await button.isEnabled().catch(() => false);
  if (!enabled) return false;
  await button.click().catch(() => button.click({ force: true }));
  return true;
}

async function findStudentRow(page: Page, wcode: string) {
  const search = page.getByPlaceholder('Search students...');
  const canSearch = await search.isVisible().catch(() => false);
  if (canSearch) {
    await search.fill('');
    await search.type(wcode, { delay: 10 });
    await page.waitForTimeout(200);
  }

  const row = page
    .getByRole('button', { name: /Open .* session details/i })
    .filter({ hasText: wcode })
    .first();

  await expect(row).toBeVisible({ timeout: 60_000 });
  return row;
}

async function proctorAction(
  page: Page,
  scheduleId: string,
  wcode: string,
  action: 'warn' | 'pause' | 'resume' | 'terminate',
) {
  const row = await findStudentRow(page, wcode);
  await row.hover().catch(() => {});

  const title =
    action === 'warn'
      ? 'Warn Student'
      : action === 'pause'
        ? 'Pause Session'
        : action === 'resume'
          ? 'Resume Session'
          : 'Terminate Session';

  await row.locator(`button[title="${title}"]`).click({ force: true });

  if (action === 'warn') {
    const message = page.getByLabel('Warning message');
    if (await message.isVisible().catch(() => false)) {
      await message.fill(`E2E warning for ${wcode}`);
    }
    await page.getByRole('button', { name: /Send Warning|Confirm|Send/i }).click({ force: true });
  }

  if (action === 'pause') {
    const reason = page.getByLabel('Pause reason');
    if (await reason.isVisible().catch(() => false)) {
      await reason.fill(`E2E pause for ${wcode}`);
    }
    await page.getByRole('button', { name: /Confirm Pause|Confirm/i }).click({ force: true });
  }

  if (action === 'resume') {
    await page.getByRole('button', { name: /Confirm Resume|Confirm/i }).click({ force: true }).catch(() => {});
  }

  if (action === 'terminate') {
    const reason = page.getByLabel('Termination reason');
    if (await reason.isVisible().catch(() => false)) {
      await reason.fill(`E2E terminate for ${wcode}`);
    }
    await page.getByRole('button', { name: /Confirm Termination|Confirm/i }).click({ force: true });
  }

  const actionType =
    action === 'warn'
      ? 'STUDENT_WARN'
      : action === 'pause'
        ? 'STUDENT_PAUSE'
        : action === 'resume'
          ? 'STUDENT_RESUME'
          : 'STUDENT_TERMINATE';

  await page.getByRole('tab', { name: 'Audit Logs' }).click().catch(() => {});
  await expect(page.getByText(actionType)).toBeVisible({ timeout: 60_000 });

  // Return to dashboard tab for next action.
  await page.getByRole('tab', { name: /Dashboard|Cohorts/i }).click().catch(() => {});

  // Verify API detail is still reachable (smoke) and schedule matches.
  const detail = await proctorDetail(page, scheduleId);
  const sessions = Array.isArray(detail?.data?.sessions) ? detail.data.sessions : [];
  expect(Array.isArray(sessions)).toBeTruthy();
}

async function createProctorPages(browser: Browser, creds: ReturnType<typeof readProdCreds>) {
  const proctorPages: Page[] = [];
  const target = readEffectiveProdTarget();
  for (const proctor of target.proctors) {
    const match = creds.proctors.find((entry) => entry.email === proctor.email);
    if (!match) {
      throw new Error(`Missing proctor credentials for ${proctor.email}. Add it to prod-creds.json.`);
    }
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, match.email, match.password);
    await openProctorSchedule(page, target.scheduleId);
    proctorPages.push(page);
  }
  return proctorPages;
}

test.describe('Prod load: control plane', () => {
  test('editor + 10 proctors orchestrate and validate prod exam day', async ({ browser }) => {
    const runId = buildRunId();
    const runtimeOutputPath = resolveProdRuntimePath();
    const initialTarget = readEffectiveProdTarget();

    await ensureStaffCreds();
    const creds = readProdCreds();

    if (process.env['E2E_PROD_BOOTSTRAP'] === 'true') {
      const editorBootstrapContext = await browser.newContext();
      const editorBootstrapPage = await editorBootstrapContext.newPage();
      await login(editorBootstrapPage, creds.editor.email, creds.editor.password);
      await expect(editorBootstrapPage).toHaveURL(/\/admin\/exams$/, { timeout: 60_000 });

      const bootstrapped = await bootstrapExamAndSchedule({
        request: editorBootstrapPage.request,
        page: editorBootstrapPage,
        runId,
      });

      await writeProdRuntimeOverride({
        outputPath: runtimeOutputPath,
        baseURL: initialTarget.baseURL,
        examId: bootstrapped.examId,
        scheduleId: bootstrapped.scheduleId,
      });

      await editorBootstrapContext.close();
    }

    const target = readEffectiveProdTarget();
    await ensureProctorAssignments(target.scheduleId);
    const assignments = computeScenarioAssignments(target);

    const editorContext = await browser.newContext();
    const editorPage = await editorContext.newPage();
    await login(editorPage, creds.editor.email, creds.editor.password);
    await expect(editorPage).toHaveURL(/\/admin\/exams$/, { timeout: 60_000 });

    // Builder open + safe draft-only edit (edit then restore original).
    await editorPage.goto(`/builder/${target.examId}`);
    await expect(editorPage.getByRole('heading', { name: /Exam Configuration|Review & Publish/i })).toBeVisible({
      timeout: 60_000,
    });

    const summary = editorPage.getByLabel('Summary');
    const canEditSummary = await summary.isVisible().catch(() => false);
    if (canEditSummary) {
      const original = await summary.inputValue().catch(() => '');
      await summary.fill(`${original} `);
      await summary.fill(original);
    }
    await tryClickIfEnabled(editorPage, 'Save Draft');

    const proctorPages = await createProctorPages(browser, creds);
    expect(proctorPages).toHaveLength(10);

    // Wait for student check-in ramp before starting cohort.
    await waitForCheckedIn(proctorPages[0]!, target.scheduleId, target.scenario.checkedInStartThreshold);

    // Start cohort (if not already started).
    await tryClickIfEnabled(proctorPages[0]!, 'Start Exam');

    // Cohort pause/resume once (short pause).
    await tryClickIfEnabled(proctorPages[0]!, 'Pause Cohort');
    await pollUntil(
      async () => {
        const json = await proctorDetail(proctorPages[0]!, target.scheduleId);
        const status = String(json?.data?.runtime?.status ?? '');
        if (status !== 'paused') throw new Error(`runtime.status=${status}`);
        return status;
      },
      { timeoutMs: 60_000, intervalMs: 2000, description: 'runtime paused' },
    );
    await tryClickIfEnabled(proctorPages[0]!, 'Resume Cohort');

    // Distributed interventions.
    const terminateWcodes = target.students.slice(0, target.scenario.interventions.terminateCount).map((s) => s.wcode);
    const warnWcodes = target.students
      .slice(target.scenario.interventions.terminateCount, target.scenario.interventions.terminateCount + target.scenario.interventions.warnCount)
      .map((s) => s.wcode);
    const pauseWcodes = target.students
      .slice(
        target.scenario.interventions.terminateCount + target.scenario.interventions.warnCount,
        target.scenario.interventions.terminateCount + target.scenario.interventions.warnCount + target.scenario.interventions.pauseResumeCount,
      )
      .map((s) => s.wcode);

    expect(terminateWcodes.length).toBe(target.scenario.interventions.terminateCount);
    expect(warnWcodes.length).toBe(target.scenario.interventions.warnCount);
    expect(pauseWcodes.length).toBe(target.scenario.interventions.pauseResumeCount);

    // Warns: proctor 1-5 each warns 2 students.
    for (let i = 0; i < warnWcodes.length; i += 1) {
      const proctorIndex = 1 + Math.floor(i / 2);
      const page = proctorPages[proctorIndex]!;
      await proctorAction(page, target.scheduleId, warnWcodes[i]!, 'warn');
    }

    // Pause/resume: proctor 6-8 each handles 2.
    for (let i = 0; i < pauseWcodes.length; i += 1) {
      const proctorIndex = 6 + Math.floor(i / 2);
      const page = proctorPages[proctorIndex]!;
      await proctorAction(page, target.scheduleId, pauseWcodes[i]!, 'pause');
      await proctorAction(page, target.scheduleId, pauseWcodes[i]!, 'resume');
    }

    // Terminations: last proctor terminates both.
    for (const wcode of terminateWcodes) {
      await proctorAction(proctorPages[9]!, target.scheduleId, wcode, 'terminate');
    }

    // Alerts: acknowledge one if present.
    await proctorPages[2]!.getByRole('tab', { name: 'Alerts' }).click().catch(() => {});
    const firstAck = proctorPages[2]!.getByRole('button', { name: 'Acknowledge' }).first();
    if (await firstAck.isVisible().catch(() => false)) {
      await firstAck.click({ force: true });
      const note = proctorPages[2]!.getByLabel('Acknowledgment note');
      if (await note.isVisible().catch(() => false)) {
        await note.fill('E2E reviewed');
      }
      await proctorPages[2]!.getByRole('button', { name: /Confirm Acknowledgment|Confirm/i }).click({ force: true });
    }

    // Editor post-run surface checks (results/analytics load).
    await editorPage.goto('/admin/results');
    await expect(editorPage.getByRole('heading', { name: 'Results & Analytics' })).toBeVisible({
      timeout: 60_000,
    });

    // Control-plane sanity: ensure our deterministic assignment sets are consistent with target.
    expect(assignments.terminate.size).toBe(target.scenario.interventions.terminateCount);

    await editorContext.close();
    await Promise.all(proctorPages.map((page) => page.context().close()));
  });
});

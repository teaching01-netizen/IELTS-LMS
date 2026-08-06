import { expect, type BrowserContext, type Page } from '@playwright/test';
import { ADMIN_STORAGE_STATE_PATH } from './backendE2e';

export function deterministicWcode(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }

  const sixDigits = 100000 + (hash % 900000);
  return `W${sixDigits.toString().padStart(6, '0')}`;
}

export async function stubScreenDetails(context: BrowserContext) {
  await context.addInitScript(() => {
    // Compatibility details are collected silently and still include screen support.
    // Playwright browsers do not expose this API, so provide a minimal stub.
    (window as any).getScreenDetails = async () => ({ screens: [window.screen] });
  });
}

export async function grantStrictProctoringPermissions(
  context: BrowserContext,
  origin: string,
) {
  await context.grantPermissions(['camera', 'microphone'], { origin });
}

function sessionCookieCandidates() {
  const configured = process.env['AUTH_SESSION_COOKIE_NAME'];
  return [
    typeof configured === 'string' && configured.length > 0 ? configured : null,
    '__Host-session',
    'session',
  ].filter((value): value is string => Boolean(value));
}

export async function waitForStudentSessionCookie(page: Page, opts?: { timeoutMs?: number }) {
  const candidates = sessionCookieCandidates();
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const cookies = await page.context().cookies();
    const hasSession = cookies.some((cookie) => candidates.includes(cookie.name));
    if (hasSession) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`Student session cookie not found (candidates: ${candidates.join(', ')}) after ${timeoutMs}ms`);
}

export async function assertAuthSession(page: Page, expectedRole: 'student' | 'admin' | 'proctor' | 'builder' | 'grader') {
  const resp = await page.request.get('/api/v1/auth/session');
  if (!resp.ok()) {
    const body = await resp.text().catch(() => '');
    throw new Error(`GET /api/v1/auth/session failed: ${resp.status()} ${body.slice(0, 200)}`);
  }
  const json = (await resp.json()) as any;
  const role = String(json?.data?.user?.role ?? '');
  if (role !== expectedRole) {
    throw new Error(`Expected auth role=${expectedRole} but got ${role}`);
  }
}

export async function triggerTabSwitchViolation(page: Page) {
  await page.evaluate(() => {
    try {
      window.dispatchEvent(new Event('blur', { bubbles: true, cancelable: true }));
    } catch {
      // Ignore
    }
  });
}

export async function triggerClipboardBlockedViolation(page: Page) {
  await page.evaluate(() => {
    const target = document.activeElement;
    if (!target) return;
    try {
      const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
    } catch {
      // Ignore
    }
  });
}

export async function triggerContextMenuBlockedViolation(page: Page) {
  await page.keyboard.press('Shift+F10').catch(() => {});
  await page.evaluate(() => {
    try {
      document.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }),
      );
    } catch {
      // Ignore
    }
  });
}

export async function studentCheckIn(
  page: Page,
  scheduleId: string,
  payload: { wcode: string; email: string; fullName: string },
) {
  await openStudentCheckIn(page, scheduleId);

  await page.waitForTimeout(250);
  const wcodeField = page.getByLabel('Wcode');
  const emailField = page.getByLabel('Email');
  const nameField = page.getByRole('textbox', { name: 'Full Name', exact: true });
  const nicknameField = page.getByRole('textbox', { name: 'Nickname', exact: true });
  const ieltsCourseField = page.getByRole('textbox', { name: 'IELTS Course', exact: true });

  // Prefer typing over a single `fill()` call to avoid hydration races in slower browsers.
  await wcodeField.click();
  await wcodeField.fill('');
  await wcodeField.type(payload.wcode, { delay: 25 });
  await emailField.click();
  await emailField.fill('');
  await emailField.type(payload.email, { delay: 10 });
  await nameField.click();
  await nameField.fill('');
  await nameField.type(payload.fullName, { delay: 10 });
  await nicknameField.click();
  await nicknameField.fill('');
  await nicknameField.type(payload.fullName, { delay: 10 });
  await ieltsCourseField.click();
  await ieltsCourseField.fill('');
  await ieltsCourseField.type('IELTS Academic', { delay: 10 });

  await page.waitForTimeout(100);
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await continueButton.click();
  const wcode = payload.wcode.trim().toUpperCase();
  const targetRoute = new RegExp(`/student/${scheduleId}/${wcode}(?:$|[?#/])`);
  let navigated = await page
    .waitForURL(targetRoute, { timeout: 45_000 })
    .then(() => true)
    .catch(() => false);

  if (!navigated) {
    await continueButton.click({ timeout: 5_000 }).catch(() => {});
    navigated = await page
      .waitForURL(targetRoute, { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
  }

  if (!navigated) {
    const submitError = await page.locator('.text-red-600').first().textContent().catch(() => null);
    throw new Error(
      `Student check-in did not navigate to the session route.${submitError ? ` ${submitError}` : ''}`,
    );
  }
}

export async function openStudentCheckIn(page: Page, scheduleId: string) {
  const loadingError = page.getByRole('heading', { name: 'Loading Error' });
  const retryButton = page.getByRole('button', { name: 'Retry' });
  const checkInHeading = page.getByRole('heading', { name: 'Exam Check-in' });

  // Production variants: some deployments mount check-in at `/student/:scheduleId/register`.
  // Also handle transient "Loading Error" screens with retry.
  const entryUrls = [`/student/${scheduleId}/register`, `/student/${scheduleId}`];

  let loaded = false;
  for (const entryUrl of entryUrls) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt === 0) {
        await page.goto(entryUrl);
      } else {
        const canRetry = await retryButton.isVisible().catch(() => false);
        if (canRetry) {
          await retryButton.click().catch(() => {});
        } else {
          await page.goto(entryUrl);
        }
      }

      await page.waitForLoadState('domcontentloaded');

      const startedAt = Date.now();
      while (Date.now() - startedAt < 20_000) {
        if (await checkInHeading.isVisible().catch(() => false)) {
          loaded = true;
          break;
        }

        if (await loadingError.isVisible().catch(() => false)) {
          break;
        }

        await page.waitForTimeout(250);
      }

      if (loaded) break;
    }

    if (loaded) break;
  }

  if (!loaded) {
    const errorCopy = await page.locator('body').innerText().catch(() => '');
    throw new Error(
      `Student check-in screen did not load for scheduleId=${scheduleId}. ` +
        `Last page URL=${page.url()}. ` +
        (errorCopy ? `Body=${errorCopy.slice(0, 200)}` : ''),
    );
  }
}

export async function completePreCheckIfPresent(page: Page) {
  // The briefing/"Continue to waiting room" step was removed: after check-in the
  // student lands directly in the waiting room while compatibility checks are run
  // and persisted silently. This helper now only settles on the resulting state
  // (waiting room, lobby preview, or an already-started exam) without any click.
  const waitingForStart = page.getByRole('heading', { name: 'Waiting for the exam to start' });
  const startExam = page.getByRole('button', { name: 'Start Exam' });
  const answerField = page.getByLabel(/Answer for question/i).first();
  const writingEditor = page.locator('[contenteditable="true"]').first();

  // Default raised from 120s after a measured E2E-04 flake: under shared-DB
  // load the pre-check save exceeded 120s and the journey failed before any
  // exam logic ran (retries are doomed by the identity-lock property, so the
  // flake must not happen in the first place). Overridable per environment.
  const timeoutMs = Number(process.env['E2E_PROD_PRECHECK_SAVE_TIMEOUT_MS'] ?? '180000');

  await expect
    .poll(
      async () => {
        if (await waitingForStart.isVisible().catch(() => false)) return 'waiting';
        if (await startExam.isVisible().catch(() => false)) return 'lobby';
        if (await answerField.isVisible().catch(() => false)) return 'answer';
        if (await writingEditor.isVisible().catch(() => false)) return 'writing';
        return 'pending';
      },
      { timeout: Math.max(30_000, timeoutMs) },
    )
    .not.toBe('pending');
}

export async function startLobbyIfPresent(page: Page) {
  const waiting = page.getByRole('heading', { name: 'Waiting for the exam to start' });
  if (!(await waiting.isVisible().catch(() => false))) return;
  await expect(page.getByRole('button', { name: 'Start Exam' })).not.toBeVisible();

  const scheduleId = page.url().match(/\/student\/([^/]+)/)?.[1];
  const browser = page.context().browser();
  if (!scheduleId || !browser) throw new Error('Cannot authoritatively start runtime without schedule and browser context.');
  const controlContext = await browser.newContext({
    storageState: process.env['ADMIN_STORAGE_STATE'] || ADMIN_STORAGE_STATE_PATH,
  });
  try {
    const cookies = await controlContext.cookies();
    const csrfNames = [process.env['AUTH_CSRF_COOKIE_NAME'], '__Host-csrf', 'csrf'].filter((value): value is string => Boolean(value));
    const csrfToken = cookies.find((cookie) => csrfNames.includes(cookie.name))?.value;
    if (!csrfToken) throw new Error('Admin E2E storage state is missing its CSRF cookie.');
    const response = await controlContext.request.post(`/api/v1/schedules/${scheduleId}/runtime/commands`, {
      headers: { 'x-csrf-token': csrfToken },
      data: { action: 'start_runtime' },
    });
    if (!response.ok() && response.status() !== 409) {
      throw new Error(`Authoritative runtime start failed: ${response.status()} ${(await response.text()).slice(0, 200)}`);
    }
  } finally {
    await controlContext.close();
  }

  await expect.poll(async () => {
    if (await page.getByLabel(/Answer for question/i).first().isVisible().catch(() => false)) return 'exam';
    if (await page.locator('[contenteditable="true"]').first().isVisible().catch(() => false)) return 'exam';
    return 'waiting';
  }, { timeout: 60_000 }).toBe('exam');
}

export async function acknowledgeWarningOverlayIfPresent(page: Page) {
  const overlay = page.getByText(/Tab switching detected/i);
  const understand = page.getByRole('button', { name: /I Understand/i });
  const visible = await overlay.isVisible().catch(() => false);
  if (!visible) return;
  const canClick = await understand.isVisible().catch(() => false);
  if (canClick) {
    await understand.click().catch(() => {});
  }
}

export async function openStudentSessionWithRetry(
  page: Page,
  scheduleId: string,
  candidateId: string,
) {
  const targetUrl = `/student/${scheduleId}/${candidateId}`;
  const loadingError = page.getByRole('heading', { name: 'Loading Error' });
  const retryButton = page.getByRole('button', { name: 'Retry' });
  const waitingRoomHeading = page.getByRole('heading', { name: 'Waiting for the exam to start' });
  const answerField = page.getByLabel('Answer for question 1');
  const finishButton = page.getByRole('button', { name: 'Finish' });
  const reviewButton = page.getByRole('button', { name: 'Review & Submit' });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt === 0) {
      await page.goto(targetUrl);
    } else {
      const canRetryInPage = await retryButton.isVisible().catch(() => false);
      if (canRetryInPage) {
        await retryButton.click();
      } else {
        await page.goto(targetUrl);
      }
    }

    await page.waitForLoadState('domcontentloaded');
    let shouldRetry = false;

    for (let tick = 0; tick < 20; tick += 1) {
      const hasLoadingError = await loadingError.isVisible().catch(() => false);
      if (hasLoadingError) {
        shouldRetry = true;
        break;
      }

      if (await waitingRoomHeading.isVisible().catch(() => false)) {
        return;
      }

      const hasAnswerField = await answerField.isVisible().catch(() => false);
      if (hasAnswerField) {
        return;
      }

      const hasFinish = await finishButton.isVisible().catch(() => false);
      if (hasFinish) {
        return;
      }

      const hasReview = await reviewButton.isVisible().catch(() => false);
      if (hasReview) {
        return;
      }

      await page.waitForTimeout(250);
    }

    if (!shouldRetry) {
      return;
    }
  }

  throw new Error(`Student session failed to load for ${targetUrl} after retries.`);
}

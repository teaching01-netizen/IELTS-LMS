import type { Page } from 'playwright';
import { satJoinErrorFromText } from './sat-join-failure';
import type { VirtualUser } from './user-source';

export interface SatScenarioContext {
  origin: string;
  accessLinkId: string;
  examTimeoutMs: number;
  startPollIntervalMs: number;
  startTimeoutMs: number;
}

function studentCodeFor(user: VirtualUser): string {
  return (user.candidateId ?? user.userId).trim();
}

async function fillFirst(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.fill(value).catch(() => {});
      const current = await locator.inputValue().catch(() => '');
      if (current.trim().length > 0) return true;
    }
  }
  return false;
}

async function fillByLabel(page: Page, label: RegExp, value: string): Promise<boolean> {
  const locator = page.getByLabel(label).first();
  if (!(await locator.count())) return false;
  await locator.fill(value).catch(() => {});
  const current = await locator.inputValue().catch(() => '');
  return current.trim().length > 0;
}

/** Server-side rejections render in role="alert" above the entry form. */
async function joinAlertText(page: Page): Promise<string> {
  const alerts = await page.locator('[role="alert"]').allInnerTexts().catch(() => []);
  return alerts.join(' ').replace(/\s+/g, ' ').trim();
}

function summarize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 220);
}

/**
 * SAT entry via Student Link join URL (/join/:accessLinkId).
 * Form is Full name + Email (+ Student code when accessMode=student_code).
 * Lands on /student/<scheduleId>/<code> after admission (queue-aware).
 */
export async function satJoinViaAccessLink(page: Page, user: VirtualUser, joinUrl: string): Promise<void> {
  page.setDefaultNavigationTimeout(90_000);
  await page.goto(joinUrl, { waitUntil: 'domcontentloaded' });
  await page
    .waitForSelector('input#student-link-name, input#student-link-email, input#student-link-code', {
      timeout: 15000,
      state: 'visible',
    })
    .catch(() => {});

  const code = studentCodeFor(user);

  const nameFilled =
    (await fillByLabel(page, /full name/i, user.userId)) ||
    (await fillFirst(page, ['input#student-link-name', 'input[autocomplete="name"]', 'input[placeholder*="name" i]'], user.userId));
  const emailFilled =
    (await fillByLabel(page, /email/i, user.email)) ||
    (await fillFirst(page, ['input#student-link-email', 'input[type="email"]', 'input[autocomplete="email"]'], user.email));

  if (!nameFilled || !emailFilled) {
    throw new Error(
      `SAT_JOIN_FIELDS_NOT_FOUND: name=${String(nameFilled)} email=${String(emailFilled)}`,
    );
  }

  // student_code links only: hidden on open links, so best-effort.
  await fillByLabel(page, /student code/i, code)
    .then((ok) => (ok ? ok : fillFirst(page, ['input#student-link-code'], code)))
    .catch(() => false);

  const continueButton = page.getByRole('button', { name: /continue/i }).first();
  if (await continueButton.count()) {
    await continueButton.click();
  } else {
    await page.keyboard.press('Enter').catch(() => {});
  }

  // Admission: direct admit lands on /student/<schedule>/<code> in seconds,
  // but under burst load the server parks entries in an admission queue
  // ("You're in the admission queue … keep this tab open") that polls
  // server-side. Wait it out instead of failing fast.
  //
  // Decisive server verdicts (registration closed, link ended/paused, roster
  // conflict) never heal by waiting, so they throw a SatJoinError immediately
  // with the scope the runner needs to abort or skip instead of burning the
  // full admission window on every bot.
  const deadline = Date.now() + 8 * 60 * 1000;
  let resubmitted = false;
  while (Date.now() < deadline) {
    if (page.url().match(/\/student\/[^/]+\/[^/]+/i)) return;

    const alertText = await joinAlertText(page);
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const failure =
      satJoinErrorFromText(alertText, summarize(alertText)) ??
      satJoinErrorFromText(bodyText, summarize(bodyText));
    if (failure) throw failure;

    // Still on the form with no server verdict and no queue: retry the submit once.
    if (!resubmitted && !alertText && !/admission queue|waiting|checking/i.test(bodyText)) {
      const retryButton = page.getByRole('button', { name: /continue/i }).first();
      if ((await retryButton.count()) && (await retryButton.isEnabled().catch(() => false))) {
        await retryButton.click().catch(() => {});
        resubmitted = true;
      }
    }

    await page.waitForTimeout(2000);
  }

  const tail = (await page.locator('body').innerText().catch(() => '')).slice(0, 300);
  throw new Error(`SAT_JOIN_NOT_ADMITTED: still on join page after submit. url=${page.url()} text=${tail}`);
}

export async function satWaitForExamLive(page: Page, ctx: SatScenarioContext): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ctx.startTimeoutMs) {
    const shell = page.getByTestId('sat-exam-shell').first();
    if (await shell.isVisible().catch(() => false)) return;

    const complete = page.getByRole('heading', { name: /SAT Complete/i }).first();
    if (await complete.isVisible().catch(() => false)) return;

    const scheduledBreak = page.getByTestId('sat-scheduled-break').first();
    if (await scheduledBreak.isVisible().catch(() => false)) return;

    // Pre-start lobby: waiting on proctor, keep polling.
    await page.waitForTimeout(ctx.startPollIntervalMs);
  }
  throw new Error('Timed out waiting for SAT exam shell.');
}

/**
 * Continuous answering until SAT Complete / exam timeout.
 * - single_choice: check one non-eliminated radio, cycling options per visit
 * - produced-response: fill textbox "Enter your answer"
 * - Next question after each answer; never submits modules (server-owned).
 */
export async function satAnswerUntilComplete(
  page: Page,
  user: VirtualUser,
  ctx: SatScenarioContext,
  onProgress?: (answered: number) => void,
): Promise<{ answered: number }> {
  const started = Date.now();
  let answered = 0;
  let optionCursor = Math.abs(hashString(user.userId)) % 4;
  let lastProgressAt = Date.now();
  let lastReported = 0;
  const report = () => {
    lastReported = answered;
    lastProgressAt = Date.now();
    onProgress?.(answered);
  };

  while (Date.now() - started < ctx.examTimeoutMs) {
    // Heartbeat so the run log + dashboard prove answering is progressing.
    // First answer reports immediately; afterwards at most every 30s.
    if (answered > lastReported && (lastReported === 0 || Date.now() - lastProgressAt > 30_000)) report();

    const completeHeading = page.getByRole('heading', { name: /SAT Complete/i }).first();
    if (await completeHeading.isVisible().catch(() => false)) {
      if (answered > lastReported) report();
      return { answered };
    }

    const shell = page.getByTestId('sat-exam-shell').first();
    const onBreak = page.getByTestId('sat-scheduled-break').first();
    if (await onBreak.isVisible().catch(() => false)) {
      await page.waitForTimeout(2000);
      continue;
    }
    if (!(await shell.isVisible().catch(() => false))) {
      await page.waitForTimeout(1000);
      continue;
    }

    // Handoff / retry states resolve server-side; hold position.
    const handoff = page.locator('[data-sat-handoff]').first();
    if (await handoff.isVisible().catch(() => false)) {
      const retry = page.getByRole('button', { name: /retry now/i }).first();
      if (await retry.isVisible().catch(() => false)) {
        await retry.click().catch(() => {});
      }
      await page.waitForTimeout(1500);
      continue;
    }

    // Review page (reached at module end): go back to questions, keep answering.
    const reviewHeading = page.getByRole('heading', { name: /Review your answers/i }).first();
    if (await reviewHeading.isVisible().catch(() => false)) {
      const back = page.getByRole('button', { name: /back to question/i }).first();
      if (await back.isVisible().catch(() => false)) {
        await back.click().catch(() => {});
        await page.waitForTimeout(600);
        continue;
      }
      await page.waitForTimeout(1500);
      continue;
    }

    // Produced-response (math SPR): textbox "Enter your answer".
    const answerBox = page.getByRole('textbox', { name: /enter your answer/i }).first();
    if (await answerBox.isVisible().catch(() => false)) {
      const current = await answerBox.inputValue().catch(() => '');
      if (!current.trim()) {
        await answerBox.fill(`${(optionCursor % 9) + 1}`).catch(() => {});
        answered += 1;
      }
      await advanceSatQuestion(page);
      continue;
    }

    // Single-choice radios: pick next non-checked option (skip calculator radiogroup).
    const radios = page.locator('[data-testid="sat-exam-shell"] input[type="radio"]');
    const radioCount = await radios.count().catch(() => 0);
    if (radioCount > 0) {
      let picked = false;
      for (let i = 0; i < radioCount; i += 1) {
        const idx = (optionCursor + i) % radioCount;
        const radio = radios.nth(idx);
        if (!(await radio.isVisible().catch(() => false))) continue;
        if (!(await radio.isEnabled().catch(() => false))) continue;
        const checked = await radio.isChecked().catch(() => false);
        if (checked) {
          picked = true;
          break;
        }
        await radio.check().catch(() => radio.click({ force: true }).catch(() => {}));
        const nowChecked = await radio.isChecked().catch(() => false);
        if (nowChecked) {
          answered += 1;
          optionCursor += 1;
          picked = true;
          break;
        }
      }
      // Whether or not this question needed a new answer, keep moving so every
      // question gets visited until the module clock ends the exam.
      void picked;
      await advanceSatQuestion(page);
      continue;
    }

    await page.waitForTimeout(800);
  }

  throw new Error(`SAT_NOT_FINISHED: timed out after ${answered} answers before SAT Complete.`);
}

async function advanceSatQuestion(page: Page): Promise<void> {
  const next = page.getByRole('button', { name: /next question/i }).first();
  if (await next.isVisible().catch(() => false)) {
    const enabled = await next.isEnabled().catch(() => true);
    if (enabled) {
      await next.click().catch(() => {});
      await page.waitForTimeout(350);
      return;
    }
  }
  // Last question shows "Review answers" instead of Next.
  const review = page.getByRole('button', { name: /review answers/i }).first();
  if (await review.isVisible().catch(() => false)) {
    await review.click().catch(() => {});
    await page.waitForTimeout(600);
    return;
  }
  await page.waitForTimeout(350);
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash;
}

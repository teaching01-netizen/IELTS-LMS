import { expect, type BrowserContext, type Page } from '@playwright/test';

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
    // The student pre-check requires `getScreenDetails` for non-Safari browsers.
    // Playwright browsers do not currently expose it, so we provide a minimal stub.
    (window as any).getScreenDetails = async () => ({ screens: [window.screen] });
  });
}

export async function studentCheckIn(
  page: Page,
  scheduleId: string,
  payload: { wcode: string; email: string; fullName: string },
) {
  await page.goto(`/student/${scheduleId}`);
  await page.getByRole('heading', { name: 'Exam Check-in' }).waitFor({ state: 'visible' });
  await page.waitForTimeout(250);
  const wcodeField = page.getByLabel('Wcode');
  const emailField = page.getByLabel('Email');
  const nameField = page.getByLabel('Full Name');

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

  await page.waitForTimeout(100);
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await continueButton.click();
  const targetRoute = new RegExp(`/student/${scheduleId}/`);
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

export async function completePreCheckIfPresent(page: Page) {
  const compatibilityCheck = page.getByRole('heading', { name: 'System Compatibility Check' });
  await compatibilityCheck.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
  const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
  if (!isCompatibilityCheckVisible) {
    return;
  }

  const acknowledgement = page.getByRole('checkbox', { name: /I understand Safari/i });
  const acknowledgementVisible = await acknowledgement.isVisible().catch(() => false);
  if (acknowledgementVisible) {
    await acknowledgement.check();
  }

  await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
  await page.getByRole('button', { name: 'Continue' }).click();
}

export async function startLobbyIfPresent(page: Page) {
  const startExam = page.getByRole('button', { name: 'Start Exam' });
  await startExam.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  const startExamVisible = await startExam.isVisible().catch(() => false);
  if (startExamVisible) {
    await startExam.click();
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
  const preCheckHeading = page.getByRole('heading', { name: 'System Compatibility Check' });
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

      const hasPreCheck = await preCheckHeading.isVisible().catch(() => false);
      if (hasPreCheck) {
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

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { readBackendE2EManifest } from './support/backendE2e';
import {
  completePreCheckIfPresent,
  deterministicWcode,
  openStudentSessionWithRetry,
  startLobbyIfPresent,
  studentCheckIn,
  stubScreenDetails,
} from './support/studentUi';

const IPAD_SAFARI_USER_AGENT =
  'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';

function extractMutationValues(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const root = payload as { mutations?: unknown };
  if (!Array.isArray(root.mutations)) {
    return [];
  }

  const values: string[] = [];
  for (const mutation of root.mutations) {
    if (!mutation || typeof mutation !== 'object') {
      continue;
    }

    const cmd = mutation as { type?: unknown; value?: unknown };
    if (typeof cmd.value === 'string') {
      values.push(cmd.value);
      continue;
    }
    if (Array.isArray(cmd.value)) {
      for (const entry of cmd.value) {
        if (typeof entry === 'string') {
          values.push(entry);
        }
      }
    }
  }

  return values;
}

async function enterRuntimeBackedExam(
  page: Page,
  scheduleId: string,
  wcode: string,
) {
  await studentCheckIn(page, scheduleId, {
    wcode,
    email: `e2e+${wcode.toLowerCase()}@example.com`,
    fullName: 'E2E Candidate',
  });
  await openStudentSessionWithRetry(page, scheduleId, wcode);
  await completePreCheckIfPresent(page);
  await startLobbyIfPresent(page);
  await openStudentSessionWithRetry(page, scheduleId, wcode);
  await expect(page.getByLabel('Answer for question 1')).toBeVisible({ timeout: 30_000 });
}

async function newIpadLikeContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: 820, height: 1180 },
    isMobile: true,
    hasTouch: true,
    userAgent: IPAD_SAFARI_USER_AGENT,
  });
}

test.describe('Student iPad autosave durability (runtime-backed)', () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(({ browserName }) => browserName !== 'webkit', 'iPad durability path is WebKit-specific');

  test('extreme rapid blur/refocus with delayed mutation delivery keeps final answer', async ({
    browser,
  }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
    const context = await newIpadLikeContext(browser);
    await stubScreenDetails(context);
    const page = await context.newPage();

    const delayedBatches: Array<{ values: string[]; delayMs: number }> = [];
    let seenMutationBatches = 0;
    await page.route(
      `**/api/v1/student/sessions/${manifest.student.scheduleId}/mutations:batch`,
      async (route) => {
        seenMutationBatches += 1;
        const payload = route.request().postDataJSON();
        const values = extractMutationValues(payload);
        const delayMs = seenMutationBatches === 1 ? 1_800 : 100;
        delayedBatches.push({ values, delayMs });
        await page.waitForTimeout(delayMs);
        await route.continue();
      },
    );

    await enterRuntimeBackedExam(page, manifest.student.scheduleId, wcode);

    const answerField = page.getByLabel('Answer for question 1');
    const focusSwitchTarget = page.getByRole('button', { name: /Open question navigator/i });
    await expect(focusSwitchTarget).toBeVisible();

    const earlyValue = `ipad-early-${Date.now()}`;
    const finalValue = `ipad-final-${Date.now()}-no-loss`;

    await answerField.click();
    await answerField.type(earlyValue, { delay: 3 });
    await focusSwitchTarget.click();

    await expect
      .poll(() => seenMutationBatches, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(1);

    await answerField.click();
    await answerField.fill(finalValue);
    await focusSwitchTarget.click();

    await expect
      .poll(async () => {
        const banner = page.getByRole('banner');
        const saved = banner.getByText('Saved');
        if (await saved.isVisible().catch(() => false)) {
          return 'saved';
        }
        const saving = banner.getByText(/Saving|Syncing/i);
        if (await saving.isVisible().catch(() => false)) {
          return 'saving';
        }
        return 'unknown';
      }, { timeout: 30_000 })
      .toBe('saved');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(answerField).toBeVisible({ timeout: 30_000 });
    await expect(answerField).toHaveValue(finalValue);

    expect(
      delayedBatches.some((batch) => batch.values.includes(finalValue)),
    ).toBeTruthy();

    await context.close();
  });
});

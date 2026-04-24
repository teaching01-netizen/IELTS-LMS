import { expect, test } from '@playwright/test';
import { readBackendE2EManifest } from './support/backendE2e';
import {
  completePreCheckIfPresent,
  deterministicWcode,
  studentCheckIn,
  stubScreenDetails,
} from './support/studentUi';

test.describe('Student system compatibility pre-check', () => {
  test.describe.configure({ timeout: 90_000 });

  test('shows the real pre-check checklist items', async ({ browser }, testInfo) => {
    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext();
    await stubScreenDetails(context);
    const page = await context.newPage();

    await studentCheckIn(page, manifest.student.scheduleId, {
      wcode,
      email: `e2e+${wcode.toLowerCase()}@example.com`,
      fullName: 'E2E Candidate',
    });

    const preCheckHeading = page.getByRole('heading', { name: 'System checking' });
    const answerField = page.getByLabel('Answer for question 1');

    await expect
      .poll(async () => {
        if (await preCheckHeading.isVisible().catch(() => false)) {
          return 'precheck';
        }
        if (await answerField.isVisible().catch(() => false)) {
          return 'exam';
        }
        return 'pending';
      }, { timeout: 30_000 })
      .toMatch(/precheck|exam/);

    const preCheckVisible = await preCheckHeading.isVisible().catch(() => false);

    if (preCheckVisible) {
      await expect(page.getByText('Browser compatibility')).toBeVisible();
      await expect(page.getByText('JavaScript runtime')).toBeVisible();
      await expect(page.getByText('Fullscreen API')).toBeVisible();
      await expect(page.getByText('Secure local storage')).toBeVisible();
      await expect(page.getByText('Network connectivity')).toBeVisible();
      await expect(page.getByText('Secondary screen detection')).toBeVisible();
    } else {
      await expect(answerField).toBeVisible();
    }

    await context.close();
  });

  test('Safari acknowledgement flow (when screen details are unavailable)', async ({ browser }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'webkit',
      'Safari acknowledgement is only relevant in WebKit/Safari.',
    );

    const manifest = readBackendE2EManifest();
    const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15',
    });
    await context.addInitScript(() => {
      (window as { getScreenDetails?: unknown }).getScreenDetails = undefined;
    });
    const page = await context.newPage();

    await studentCheckIn(page, manifest.student.scheduleId, {
      wcode,
      email: `e2e+${wcode.toLowerCase()}@example.com`,
      fullName: 'E2E Candidate',
    });

    const preCheckHeading = page.getByRole('heading', { name: 'System checking' });
    const answerField = page.getByLabel('Answer for question 1');

    await expect
      .poll(async () => {
        if (await preCheckHeading.isVisible().catch(() => false)) {
          return 'precheck';
        }
        if (await answerField.isVisible().catch(() => false)) {
          return 'exam';
        }
        return 'pending';
      }, { timeout: 30_000 })
      .toMatch(/precheck|exam/);

    const preCheckVisible = await preCheckHeading.isVisible().catch(() => false);

    if (preCheckVisible) {
      const safariAcknowledgement = page.getByRole('checkbox', { name: /I understand Safari/i });
      const acknowledgementVisible = await safariAcknowledgement.isVisible().catch(() => false);
      if (acknowledgementVisible) {
        await safariAcknowledgement.check();
      }

      await completePreCheckIfPresent(page);
      await expect(preCheckHeading).not.toBeVisible();
    } else {
      await expect(answerField).toBeVisible();
    }
    await context.close();
  });
});

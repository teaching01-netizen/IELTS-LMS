import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Captures the dev-only SAT banner gallery. Every screenshot is written to
 * verification/sat-banners/ so the banner set can be reviewed as images.
 *
 * Run: bun run e2e:sat-banners
 */

const OUT = resolve(process.cwd(), 'verification/sat-banners');

const NOTICE_BANNERS = [
  'student-proctor-warning',
  'student-exam-error',
  'student-unsynced-warning',
  'student-unsynced-offline',
  'student-lease-conflict',
  'student-save-failed',
  'student-save-superseded',
  'staff-room-created',
  'staff-stale-data',
  'staff-action-error',
  'staff-action-success',
  'staff-overrun',
  'staff-reconnecting',
  'staff-entry-load-error',
];

/**
 * Status text, not notice strips: closing "Overrun" or "Reconnecting" would
 * hide a condition the proctor must act on. They are the documented exceptions
 * in plan §6.7.
 */
const NO_DISMISS_STATUS = new Set(['staff-overrun', 'staff-reconnecting']);

const OVERLAYS = ['integrity', 'paused', 'timeout'];

test('captures every SAT banner', async ({ page }) => {
  await mkdir(OUT, { recursive: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.goto('/__dev/sat-banners');
  await expect(page.getByRole('heading', { name: 'SAT banner gallery' })).toBeVisible();
  await page.waitForTimeout(300);

  for (const id of NOTICE_BANNERS) {
    const banner = page.locator(`[data-banner-id="${id}"]`);
    await expect(banner).toBeVisible();
    await banner.screenshot({ path: resolve(OUT, `${id}.png`) });
    if (!NO_DISMISS_STATUS.has(id)) {
      await expect(
        banner.getByRole('button', { name: /^Dismiss/ }),
        `${id} must carry a close control`,
      ).toBeVisible();
    }
  }

  await page.screenshot({ path: resolve(OUT, 'gallery.png'), fullPage: true });

  for (const id of OVERLAYS) {
    await page.goto(`/__dev/sat-banners?only=${id}`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(OUT, `${id}.png`) });
  }
});

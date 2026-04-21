import { test } from '@playwright/test';
import { readEffectiveProdTarget } from '../support/prodData';
import { resolveProdRunContext } from '../support/prodOrchestration';
import { openStudentCheckIn } from '../support/studentUi';

test.describe('Prod load: student entry smoke', () => {
  test('check-in screen loads without authentication', async ({ page }, testInfo) => {
    const target = readEffectiveProdTarget();
    const run = resolveProdRunContext(target);
    if (run.shardIndex !== 0) {
      testInfo.skip(true, 'Smoke runs on shard 0 only.');
    }
    await openStudentCheckIn(page, target.scheduleId);
  });
});

import { test } from '@playwright/test';
import { readEffectiveProdTarget } from '../support/prodData';
import { openStudentCheckIn } from '../support/studentUi';

test.describe('Prod load: student entry smoke', () => {
  test('check-in screen loads without authentication', async ({ page }) => {
    const target = readEffectiveProdTarget();
    await openStudentCheckIn(page, target.scheduleId);
  });
});


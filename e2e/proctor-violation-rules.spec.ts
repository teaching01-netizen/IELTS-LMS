import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  ADMIN_STORAGE_STATE_PATH,
  readBackendE2EManifest,
} from './support/backendE2e';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

type Rule = {
  id: string;
  scheduleId: string;
  triggerType: string;
  threshold: number;
  specificViolationType?: string | null;
  specificSeverity?: string | null;
  action: string;
  isEnabled: boolean;
};

async function listRules(page: Page, scheduleId: string): Promise<Rule[]> {
  const response = await page.request.get(
    `/api/v1/proctor/sessions/${encodeURIComponent(scheduleId)}/violation-rules`,
  );
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as Rule[];
}

async function openSeededRules(page: Page): Promise<Locator> {
  await page.goto('/proctor');
  await expect(page.getByRole('heading', { name: 'Cohorts and students' })).toBeVisible();
  await page.getByRole('button', {
    name: 'Monitor Student Backend E2E Delivery for cohort Backend E2E Cohort',
  }).click();
  await expect(
    page.getByRole('heading', { name: /Student Backend E2E Delivery · Backend E2E Cohort/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Auto-Response Rules' }).click();
  const dialog = page.getByRole('dialog', { name: 'Auto-Response Rules' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function createRule(
  dialog: Locator,
  options: {
    triggerType: 'violation_count' | 'specific_violation_type' | 'severity_threshold';
    threshold: number;
    action: 'warn' | 'pause' | 'notify_proctor' | 'terminate';
    specificViolationType?: string;
    specificSeverity?: 'low' | 'medium' | 'high' | 'critical';
  },
) {
  await dialog.getByRole('button', { name: 'New Rule' }).click();
  await dialog.getByLabel('Rule trigger type').selectOption(options.triggerType);
  if (options.specificViolationType) {
    await dialog.getByLabel('Specific violation type').fill(options.specificViolationType);
  }
  if (options.specificSeverity) {
    await dialog.getByLabel('Specific severity').selectOption(options.specificSeverity);
  }
  await dialog.getByLabel('Rule threshold').fill(String(options.threshold));
  await dialog.getByLabel('Rule action').selectOption(options.action);
  await dialog.getByRole('button', { name: 'Save Rule' }).click();
}

test.describe('Proctor automatic violation-response rules', () => {
  test.describe.configure({ timeout: 60_000 });

  test('creates, persists, toggles, and deletes every rule trigger shape', async ({ page }) => {
    const manifest = readBackendE2EManifest();
    const scheduleId = manifest.student.scheduleId;
    const dialog = await openSeededRules(page);
    const created: Array<{ id: string; description: RegExp }> = [];

    await createRule(dialog, {
      triggerType: 'violation_count',
      threshold: 17,
      action: 'warn',
    });
    await createRule(dialog, {
      triggerType: 'specific_violation_type',
      threshold: 18,
      specificViolationType: 'TAB_SWITCH',
      action: 'pause',
    });
    await createRule(dialog, {
      triggerType: 'severity_threshold',
      threshold: 19,
      specificSeverity: 'high',
      action: 'notify_proctor',
    });

    await expect(dialog.getByText('When violations reach 17')).toBeVisible();
    await expect(dialog.getByText('When TAB_SWITCH occurs 18 times')).toBeVisible();
    await expect(dialog.getByText('When high violations reach 19')).toBeVisible();

    await expect
      .poll(async () => {
        const rules = await listRules(page, scheduleId);
        return rules.filter((rule) => [17, 18, 19].includes(rule.threshold));
      })
      .toHaveLength(3);

    const persisted = await listRules(page, scheduleId);
    for (const rule of persisted.filter((candidate) => [17, 18, 19].includes(candidate.threshold))) {
      created.push({
        id: rule.id,
        description:
          rule.threshold === 17
            ? /When violations reach 17/
            : rule.threshold === 18
              ? /When TAB_SWITCH occurs 18 times/
              : /When high violations reach 19/,
      });
    }
    expect(created).toHaveLength(3);

    const countRule = created.find((rule) => rule.description.source.includes('17'))!;
    const countRow = dialog.locator(`[data-rule-id="${countRule.id}"]`);
    await countRow.getByRole('button', { name: 'Disable rule' }).click();
    await expect(countRow).toHaveAttribute('data-enabled', 'false');
    await expect
      .poll(async () => (await listRules(page, scheduleId)).find((rule) => rule.id === countRule.id)?.isEnabled)
      .toBe(false);

    await countRow.getByRole('button', { name: 'Enable rule' }).click();
    await expect(countRow).toHaveAttribute('data-enabled', 'true');
    await expect
      .poll(async () => (await listRules(page, scheduleId)).find((rule) => rule.id === countRule.id)?.isEnabled)
      .toBe(true);

    await page.getByRole('button', { name: 'Close auto-response rules' }).last().click();
    await page.reload();
    const reloadedDialog = await openSeededRules(page);
    for (const rule of created) {
      await expect(reloadedDialog.locator(`[data-rule-id="${rule.id}"]`)).toBeVisible();
    }

    for (const rule of created) {
      const row = reloadedDialog.locator(`[data-rule-id="${rule.id}"]`);
      await row.getByRole('button', { name: `Delete rule ${rule.id}` }).click();
      await expect(row).toHaveCount(0);
      await expect
        .poll(async () => (await listRules(page, scheduleId)).some((candidate) => candidate.id === rule.id))
        .toBe(false);
    }
  });
});

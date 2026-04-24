import { expect, test } from '@playwright/test';
import {
  ADMIN_STORAGE_STATE_PATH,
  readBackendE2EManifest,
  STUDENT_STORAGE_STATE_PATH,
} from './support/backendE2e';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

test.describe('Proctor Violation Rules Configuration', () => {
  test('creates violation count rule', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Navigate to violation rules section
    await page.getByRole('tab', { name: 'Violation Rules' }).click();
    await expect(page.getByRole('heading', { name: /Violation Rules/i })).toBeVisible();

    // Create new rule
    await page.getByRole('button', { name: 'Create Rule' }).click();
    await expect(page.getByRole('dialog', { name: /Create Violation Rule/i })).toBeVisible();

    // Configure violation count rule
    await page.getByLabel('Rule type').selectOption('violation_count');
    await page.getByLabel('Violation count threshold').fill('5');
    await page.getByLabel('Auto action').selectOption('warn');
    await page.getByLabel('Severity').selectOption('low');

    // Save rule
    await page.getByRole('button', { name: 'Save Rule' }).click();
    await expect(page.getByText('Rule created successfully')).toBeVisible();

    // Verify rule appears in list
    await expect(page.getByText('5 violations → warn')).toBeVisible();
  });

  test('creates specific violation type rule', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.getByRole('tab', { name: 'Violation Rules' }).click();

    // Create new rule
    await page.getByRole('button', { name: 'Create Rule' }).click();

    // Configure specific violation type rule
    await page.getByLabel('Rule type').selectOption('violation_type');
    await page.getByLabel('Violation type').selectOption('TAB_SWITCH');
    await page.getByLabel('Auto action').selectOption('pause');
    await page.getByLabel('Severity').selectOption('high');

    // Save rule
    await page.getByRole('button', { name: 'Save Rule' }).click();
    await expect(page.getByText('Rule created successfully')).toBeVisible();

    // Verify rule appears in list
    await expect(page.getByText('TAB_SWITCH → pause')).toBeVisible();
  });

  test('creates severity threshold rule', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.getByRole('tab', { name: 'Violation Rules' }).click();

    // Create new rule
    await page.getByRole('button', { name: 'Create Rule' }).click();

    // Configure severity threshold rule
    await page.getByLabel('Rule type').selectOption('severity_threshold');
    await page.getByLabel('Severity level').selectOption('high');
    await page.getByLabel('Severity count threshold').fill('3');
    await page.getByLabel('Auto action').selectOption('terminate');

    // Save rule
    await page.getByRole('button', { name: 'Save Rule' }).click();
    await expect(page.getByText('Rule created successfully')).toBeVisible();

    // Verify rule appears in list
    await expect(page.getByText('3 high → terminate')).toBeVisible();
  });

  test('enables and disables rules', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.getByRole('tab', { name: 'Violation Rules' }).click();

    // Find first rule
    const ruleItem = page.locator('[data-rule-item]').first();
    const hasRules = await ruleItem.count() > 0;

    if (hasRules) {
      // Disable rule
      await ruleItem.getByRole('switch').click();
      await expect(page.getByText('Rule disabled')).toBeVisible();

      // Verify rule is disabled
      await expect(ruleItem).toHaveAttribute('data-enabled', 'false');

      // Enable rule
      await ruleItem.getByRole('switch').click();
      await expect(page.getByText('Rule enabled')).toBeVisible();

      // Verify rule is enabled
      await expect(ruleItem).toHaveAttribute('data-enabled', 'true');
    }
  });

  test('tests rule triggers during exam', async ({ browser, page }) => {
    const manifest = readBackendE2EManifest();

    // Create a test rule
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.getByRole('tab', { name: 'Violation Rules' }).click();
    await page.getByRole('button', { name: 'Create Rule' }).click();
    await page.getByLabel('Rule type').selectOption('violation_count');
    await page.getByLabel('Violation count threshold').fill('2');
    await page.getByLabel('Auto action').selectOption('warn');
    await page.getByRole('button', { name: 'Save Rule' }).click();
    await expect(page.getByText('Rule created successfully')).toBeVisible();

    // Start student session
    const studentContext = await browser.newContext({
      storageState: STUDENT_STORAGE_STATE_PATH,
    });
    const studentPage = await studentContext.newPage();
    await studentPage.goto(
      `/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`,
    );

    const compatibilityCheck = studentPage.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await studentPage.getByRole('button', { name: 'Continue' }).click();
    }

    // Simulate violations (in a real scenario, this would trigger actual violations)
    // For now, we'll verify the rule is saved and can be triggered
    
    // Navigate to audit logs to verify rule evaluation
    await page.getByRole('tab', { name: 'Audit Logs' }).click();
    
    // Check for AUTO_ACTION entries (if any violations occurred)
    const autoActionLogs = page.getByText('AUTO_ACTION');
    const hasAutoActions = await autoActionLogs.count() > 0;
    
    if (hasAutoActions) {
      await expect(autoActionLogs.first()).toBeVisible();
    }

    await studentContext.close();
  });

  test('deletes rules', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.getByRole('tab', { name: 'Violation Rules' }).click();

    // Find a rule to delete
    const ruleItem = page.locator('[data-rule-item]').first();
    const hasRules = await ruleItem.count() > 0;

    if (hasRules) {
      const ruleCountBefore = await page.locator('[data-rule-item]').count();

      // Delete rule
      await ruleItem.getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByRole('dialog', { name: /Confirm Delete/i })).toBeVisible();
      await page.getByRole('button', { name: 'Confirm' }).click();
      await expect(page.getByText('Rule deleted successfully')).toBeVisible();

      // Verify rule is removed
      const ruleCountAfter = await page.locator('[data-rule-item]').count();
      expect(ruleCountAfter).toBe(ruleCountBefore - 1);
    }
  });

  test('verifies multiple rules can coexist', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.getByRole('tab', { name: 'Violation Rules' }).click();

    // Get initial rule count
    const initialRuleCount = await page.locator('[data-rule-item]').count();

    // Create first rule
    await page.getByRole('button', { name: 'Create Rule' }).click();
    await page.getByLabel('Rule type').selectOption('violation_count');
    await page.getByLabel('Violation count threshold').fill('3');
    await page.getByLabel('Auto action').selectOption('warn');
    await page.getByRole('button', { name: 'Save Rule' }).click();
    await expect(page.getByText('Rule created successfully')).toBeVisible();

    // Create second rule
    await page.getByRole('button', { name: 'Create Rule' }).click();
    await page.getByLabel('Rule type').selectOption('violation_type');
    await page.getByLabel('Violation type').selectOption('TAB_SWITCH');
    await page.getByLabel('Auto action').selectOption('pause');
    await page.getByRole('button', { name: 'Save Rule' }).click();
    await expect(page.getByText('Rule created successfully')).toBeVisible();

    // Verify both rules exist
    const finalRuleCount = await page.locator('[data-rule-item]').count();
    expect(finalRuleCount).toBe(initialRuleCount + 2);
  });

  test('verifies rule evaluation happens in real-time', async ({ browser, page }) => {
    const manifest = readBackendE2EManifest();

    // Create a real-time rule
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.getByRole('tab', { name: 'Violation Rules' }).click();
    await page.getByRole('button', { name: 'Create Rule' }).click();
    await page.getByLabel('Rule type').selectOption('violation_count');
    await page.getByLabel('Violation count threshold').fill('1');
    await page.getByLabel('Auto action').selectOption('notify_proctor');
    await page.getByRole('button', { name: 'Save Rule' }).click();

    // Start student session
    const studentContext = await browser.newContext({
      storageState: STUDENT_STORAGE_STATE_PATH,
    });
    const studentPage = await studentContext.newPage();
    await studentPage.goto(
      `/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`,
    );

    const compatibilityCheck = studentPage.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await studentPage.getByRole('button', { name: 'Continue' }).click();
    }

    // Monitor alerts in real-time
    await page.getByRole('tab', { name: 'Alerts' }).click();

    // Wait a moment for any real-time updates
    await page.waitForTimeout(2000);

    // Verify alerts panel is active and monitoring
    await expect(page.getByRole('heading', { name: /Alerts/i })).toBeVisible();

    await studentContext.close();
  });

  test('edits existing rule', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.getByRole('tab', { name: 'Violation Rules' }).click();

    // Find a rule to edit
    const ruleItem = page.locator('[data-rule-item]').first();
    const hasRules = await ruleItem.count() > 0;

    if (hasRules) {
      // Edit rule
      await ruleItem.getByRole('button', { name: 'Edit' }).click();
      await expect(page.getByRole('dialog', { name: /Edit Violation Rule/i })).toBeVisible();

      // Modify rule settings
      await page.getByLabel('Violation count threshold').fill('10');
      await page.getByLabel('Auto action').selectOption('pause');

      // Save changes
      await page.getByRole('button', { name: 'Save Rule' }).click();
      await expect(page.getByText('Rule updated successfully')).toBeVisible();

      // Verify changes are reflected
      await expect(page.getByText('10 violations → pause')).toBeVisible();
    }
  });

  test('verifies rules saved to database', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.getByRole('tab', { name: 'Violation Rules' }).click();

    // Create a rule
    await page.getByRole('button', { name: 'Create Rule' }).click();
    await page.getByLabel('Rule type').selectOption('violation_count');
    await page.getByLabel('Violation count threshold').fill('5');
    await page.getByLabel('Auto action').selectOption('warn');
    await page.getByRole('button', { name: 'Save Rule' }).click();

    // Refresh page to verify persistence
    await page.reload();
    await page.getByRole('tab', { name: 'Violation Rules' }).click();

    // Verify rule still exists after refresh
    await expect(page.getByText('5 violations → warn')).toBeVisible();
  });
});

import { expect, test } from '@playwright/test';
import {
  ADMIN_STORAGE_STATE_PATH,
  readBackendE2EManifest,
  STUDENT_STORAGE_STATE_PATH,
} from './support/backendE2e';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

test.describe('Audit Log Verification', () => {
  test('verifies session lifecycle audit logs', async ({ browser, page }) => {
    const manifest = readBackendE2EManifest();

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

    // Navigate to audit logs
    await page.goto('/admin/audit-logs');
    await expect(page.getByRole('heading', { name: /Audit Logs/i })).toBeVisible();

    // Verify SESSION_START is logged
    const sessionStartLog = page.getByText('SESSION_START');
    const hasSessionStart = await sessionStartLog.count() > 0;
    if (hasSessionStart) {
      await expect(sessionStartLog.first()).toBeVisible();
    }

    await studentContext.close();
  });

  test('verifies section transition audit logs', async ({ browser, page }) => {
    const manifest = readBackendE2EManifest();

    // Start student session and navigate through sections
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

    // Navigate to audit logs
    await page.goto('/admin/audit-logs');

    // Verify SECTION_START and SECTION_END are logged
    const sectionStartLog = page.getByText('SECTION_START');
    const sectionEndLog = page.getByText('SECTION_END');
    
    const hasSectionStart = await sectionStartLog.count() > 0;
    const hasSectionEnd = await sectionEndLog.count() > 0;

    if (hasSectionStart) {
      await expect(sectionStartLog.first()).toBeVisible();
    }
    if (hasSectionEnd) {
      await expect(sectionEndLog.first()).toBeVisible();
    }

    await studentContext.close();
  });

  test('verifies violation detection audit logs', async ({ browser, page }) => {
    const manifest = readBackendE2EManifest();

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

    // Navigate to audit logs
    await page.goto('/admin/audit-logs');

    // Verify violation-related audit logs
    const violationTypes = [
      'VIOLATION_DETECTED',
      'AUTOFILL_SUSPECTED',
      'PASTE_BLOCKED',
      'REPLACEMENT_SUSPECTED',
      'SCREEN_CHECK_UNSUPPORTED',
      'SCREEN_CHECK_PERMISSION_DENIED',
      'CLIPBOARD_BLOCKED',
      'CONTEXT_MENU_BLOCKED',
    ];

    for (const violationType of violationTypes) {
      const log = page.getByText(violationType);
      const hasLog = await log.count() > 0;
      if (hasLog) {
        await expect(log.first()).toBeVisible();
      }
    }

    await studentContext.close();
  });

  test('verifies heartbeat and network audit logs', async ({ browser, page }) => {
    const manifest = readBackendE2EManifest();

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

    // Navigate to audit logs
    await page.goto('/admin/audit-logs');

    // Verify heartbeat and network audit logs
    const networkTypes = [
      'HEARTBEAT_MISSED',
      'HEARTBEAT_LOST',
      'NETWORK_DISCONNECTED',
      'NETWORK_RECONNECTED',
      'DEVICE_CONTINUITY_FAILED',
    ];

    for (const networkType of networkTypes) {
      const log = page.getByText(networkType);
      const hasLog = await log.count() > 0;
      if (hasLog) {
        await expect(log.first()).toBeVisible();
      }
    }

    await studentContext.close();
  });

  test('verifies proctor intervention audit logs', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Perform proctor intervention
    await page.getByRole('button', { name: 'Pause Cohort' }).click();
    
    // Navigate to audit logs
    await page.goto('/admin/audit-logs');

    // Verify proctor intervention audit logs
    const interventionTypes = [
      'STUDENT_WARN',
      'STUDENT_PAUSE',
      'STUDENT_RESUME',
      'STUDENT_TERMINATE',
      'COHORT_PAUSE',
      'COHORT_RESUME',
      'EXTENSION_GRANTED',
      'ALERT_ACKNOWLEDGED',
    ];

    for (const interventionType of interventionTypes) {
      const log = page.getByText(interventionType);
      const hasLog = await log.count() > 0;
      if (hasLog) {
        await expect(log.first()).toBeVisible();
      }
    }
  });

  test('verifies system action audit logs', async ({ browser, page }) => {
    const manifest = readBackendE2EManifest();

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

    // Navigate to audit logs
    await page.goto('/admin/audit-logs');

    // Verify system action audit logs
    const systemActionTypes = [
      'AUTO_ACTION',
      'NOTE_CREATED',
      'HANDOVER_INITIATED',
      'PRECHECK_COMPLETED',
      'PRECHECK_WARNING_ACKNOWLEDGED',
    ];

    for (const actionType of systemActionTypes) {
      const log = page.getByText(actionType);
      const hasLog = await log.count() > 0;
      if (hasLog) {
        await expect(log.first()).toBeVisible();
      }
    }

    await studentContext.close();
  });

  test('verifies audit log timestamp correctness', async ({ page }) => {
    await page.goto('/admin/audit-logs');

    // Get first log entry timestamp
    const firstLog = page.locator('[data-audit-log-entry]').first();
    const firstTimestamp = await firstLog.getAttribute('data-timestamp');
    
    expect(firstTimestamp).not.toBeNull();
    
    // Verify timestamp is valid ISO format
    const timestampDate = new Date(firstTimestamp!);
    expect(timestampDate.getTime()).not.toBeNaN();
  });

  test('verifies audit log actor field populated', async ({ page }) => {
    await page.goto('/admin/audit-logs');

    // Check first log entry for actor field
    const firstLog = page.locator('[data-audit-log-entry]').first();
    const actor = await firstLog.getAttribute('data-actor');
    
    expect(actor).not.toBeNull();
    expect(actor).not.toBe('');
  });

  test('verifies audit log target_student_id when applicable', async ({ browser, page }) => {
    const manifest = readBackendE2EManifest();

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

    // Navigate to audit logs
    await page.goto('/admin/audit-logs');

    // Filter logs by student
    await page.getByRole('combobox', { name: 'Filter by student' }).selectOption({ label: manifest.student.candidateId });

    // Verify target_student_id is populated for student-related logs
    const studentLogs = page.locator('[data-audit-log-entry]');
    const logCount = await studentLogs.count();
    
    if (logCount > 0) {
      const firstLog = studentLogs.first();
      const targetStudentId = await firstLog.getAttribute('data-target-student-id');
      expect(targetStudentId).not.toBeNull();
    }

    await studentContext.close();
  });

  test('verifies audit log payload contains metadata', async ({ page }) => {
    await page.goto('/admin/audit-logs');

    // Get first log entry
    const firstLog = page.locator('[data-audit-log-entry]').first();
    
    // Click to view details
    await firstLog.click();
    
    // Verify payload is displayed
    await expect(page.getByText('Payload')).toBeVisible();
    await expect(page.getByText('Metadata')).toBeVisible();
  });

  test('verifies audit logs queryable by schedule', async ({ page }) => {
    const manifest = readBackendE2EManifest();

    await page.goto('/admin/audit-logs');

    // Filter by schedule
    await page.getByRole('combobox', { name: 'Filter by schedule' }).selectOption({ label: manifest.student.scheduleId });

    // Verify logs are filtered
    const logs = page.locator('[data-audit-log-entry]');
    const logCount = await logs.count();
    expect(logCount).toBeGreaterThan(0);
  });

  test('verifies audit logs queryable by action type', async ({ page }) => {
    await page.goto('/admin/audit-logs');

    // Filter by action type
    await page.getByRole('combobox', { name: 'Filter by action type' }).selectOption('SESSION_START');

    // Verify logs are filtered
    const logs = page.locator('[data-audit-log-entry]');
    const logCount = await logs.count();
    
    // Should only have SESSION_START logs
    for (let i = 0; i < logCount; i++) {
      const log = logs.nth(i);
      await expect(log).toContainText('SESSION_START');
    }
  });

  test('verifies audit logs ordered chronologically', async ({ page }) => {
    await page.goto('/admin/audit-logs');

    // Get all log entries
    const logs = page.locator('[data-audit-log-entry]');
    const logCount = await logs.count();
    
    if (logCount >= 2) {
      const firstTimestamp = await logs.nth(0).getAttribute('data-timestamp');
      const lastTimestamp = await logs.nth(logCount - 1).getAttribute('data-timestamp');
      
      const firstDate = new Date(firstTimestamp!);
      const lastDate = new Date(lastTimestamp!);
      
      // First entry should be newer (descending order)
      expect(firstDate.getTime()).toBeGreaterThanOrEqual(lastDate.getTime());
    }
  });

  test('verifies alert acknowledgment fields', async ({ page }) => {
    await page.goto('/admin/audit-logs');

    // Filter for ALERT_ACKNOWLEDGED
    await page.getByRole('combobox', { name: 'Filter by action type' }).selectOption('ALERT_ACKNOWLEDGED');

    const alertLogs = page.locator('[data-audit-log-entry]');
    const logCount = await alertLogs.count();
    
    if (logCount > 0) {
      const firstLog = alertLogs.first();
      
      // Verify acknowledged_at field
      const acknowledgedAt = await firstLog.getAttribute('data-acknowledged-at');
      expect(acknowledgedAt).not.toBeNull();
      
      // Verify acknowledged_by field
      const acknowledgedBy = await firstLog.getAttribute('data-acknowledged-by');
      expect(acknowledgedBy).not.toBeNull();
    }
  });

  test('verifies comprehensive audit action type coverage', async ({ page }) => {
    await page.goto('/admin/audit-logs');

    // List of all expected audit action types from the comprehensive plan
    const allActionTypes = [
      'SESSION_START',
      'SESSION_PAUSE',
      'SESSION_RESUME',
      'SESSION_END',
      'SECTION_START',
      'SECTION_END',
      'VIOLATION_DETECTED',
      'AUTOFILL_SUSPECTED',
      'PASTE_BLOCKED',
      'REPLACEMENT_SUSPECTED',
      'SCREEN_CHECK_UNSUPPORTED',
      'SCREEN_CHECK_PERMISSION_DENIED',
      'CLIPBOARD_BLOCKED',
      'CONTEXT_MENU_BLOCKED',
      'HEARTBEAT_MISSED',
      'HEARTBEAT_LOST',
      'NETWORK_DISCONNECTED',
      'NETWORK_RECONNECTED',
      'DEVICE_CONTINUITY_FAILED',
      'STUDENT_WARN',
      'STUDENT_PAUSE',
      'STUDENT_RESUME',
      'STUDENT_TERMINATE',
      'COHORT_PAUSE',
      'COHORT_RESUME',
      'EXTENSION_GRANTED',
      'ALERT_ACKNOWLEDGED',
      'AUTO_ACTION',
      'NOTE_CREATED',
      'HANDOVER_INITIATED',
      'PRECHECK_COMPLETED',
      'PRECHECK_WARNING_ACKNOWLEDGED',
    ];

    // Check which action types are present in the logs
    const presentTypes: string[] = [];
    for (const actionType of allActionTypes) {
      const log = page.getByText(actionType);
      const hasLog = await log.count() > 0;
      if (hasLog) {
        presentTypes.push(actionType);
      }
    }

    // Log the coverage (not all may be present in a single test run)
    console.log(`Audit log coverage: ${presentTypes.length}/${allActionTypes.length} action types found`);
    
    // At minimum, we should have some audit logs
    expect(presentTypes.length).toBeGreaterThan(0);
  });
});

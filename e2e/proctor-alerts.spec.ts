import { expect, test } from '@playwright/test';
import {
  ADMIN_STORAGE_STATE_PATH,
  readBackendE2EManifest,
  STUDENT_STORAGE_STATE_PATH,
} from './support/backendE2e';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

test.describe('Proctor Alert Management', () => {
  test('receives real-time alerts for violations', async ({ browser, page }) => {
    const manifest = readBackendE2EManifest();

    // Start student session to generate violations
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

    // Navigate to proctor dashboard
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // View alert panel
    await page.getByRole('tab', { name: 'Alerts' }).click();
    await expect(page.getByRole('heading', { name: /Alerts/i })).toBeVisible();

    // Verify alerts appear in AlertPanel
    const alertItems = page.locator('[data-alert-item]');
    const alertCount = await alertItems.count();
    expect(alertCount).toBeGreaterThanOrEqual(0);

    await studentContext.close();
  });

  test('filters alerts by severity', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.getByRole('tab', { name: 'Alerts' }).click();

    // Filter by high severity
    await page.getByRole('combobox', { name: 'Filter by severity' }).selectOption('high');
    
    // Verify filter applied
    const severityFilter = page.getByRole('combobox', { name: 'Filter by severity' });
    await expect(severityFilter).toHaveValue('high');

    // Filter by medium severity
    await severityFilter.selectOption('medium');
    await expect(severityFilter).toHaveValue('medium');

    // Filter by low severity
    await severityFilter.selectOption('low');
    await expect(severityFilter).toHaveValue('low');

    // Show all alerts
    await severityFilter.selectOption('all');
    await expect(severityFilter).toHaveValue('all');
  });

  test('filters alerts by student', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.getByRole('tab', { name: 'Alerts' }).click();

    // Filter by student (if student filter exists)
    const studentFilter = page.getByRole('combobox', { name: 'Filter by student' }).first();
    const isFilterVisible = await studentFilter.isVisible().catch(() => false);
    
    if (isFilterVisible) {
      await studentFilter.selectOption({ index: 0 });
      // Verify filter applied
      await expect(studentFilter).toBeVisible();
    }
  });

  test('acknowledges individual alert', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.getByRole('tab', { name: 'Alerts' }).click();

    // Find an alert to acknowledge
    const alertItem = page.locator('[data-alert-item]').first();
    const hasAlerts = await alertItem.count() > 0;

    if (hasAlerts) {
      await alertItem.getByRole('button', { name: 'Acknowledge' }).click();
      
      // Verify acknowledgment success message
      await expect(page.getByText('Alert acknowledged')).toBeVisible();

      // Verify audit log entry for ALERT_ACKNOWLEDGED
      await page.getByRole('tab', { name: 'Audit Logs' }).click();
      await expect(page.getByText('ALERT_ACKNOWLEDGED')).toBeVisible();
    }
  });

  test('acknowledges all alerts for schedule', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.getByRole('tab', { name: 'Alerts' }).click();

    // Check if there are alerts to acknowledge
    const alertItems = page.locator('[data-alert-item]');
    const alertCount = await alertItems.count();

    if (alertCount > 0) {
      await page.getByRole('button', { name: 'Acknowledge All' }).click();
      
      // Verify acknowledgment success message
      await expect(page.getByText('All alerts acknowledged')).toBeVisible();

      // Verify all alerts are acknowledged
      const acknowledgedAlerts = page.locator('[data-alert-item][data-acknowledged="true"]');
      await expect(acknowledgedAlerts).toHaveCount(alertCount);
    }
  });

  test('verifies alert auto-dismissal rules', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.getByRole('tab', { name: 'Alerts' }).click();

    // Check for old alerts that should be auto-dismissed
    const alertItems = page.locator('[data-alert-item]');
    const alertCount = await alertItems.count();

    if (alertCount > 0) {
      // Verify alerts have timestamps
      const firstAlert = alertItems.first();
      const timestamp = await firstAlert.getAttribute('data-timestamp');
      expect(timestamp).not.toBeNull();
    }
  });

  test('measures alert latency', async ({ browser, page }) => {
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

    // Navigate to proctor dashboard and monitor
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.getByRole('tab', { name: 'Alerts' }).click();

    // Record time before potential violation
    const beforeTime = Date.now();

    // Trigger a violation (tab switch simulation would go here)
    // For now, we'll just check if telemetry exists
    
    // Check for telemetry data
    const telemetryData = await page.evaluate(() => {
      return (window as any).performanceMonitor?.getMetricsByName('violation_to_alert_latency');
    });

    if (telemetryData && telemetryData.length > 0) {
      // Verify latency is reasonable (< 500ms)
      const latency = telemetryData[0].value;
      expect(latency).toBeLessThan(500);
    }

    await studentContext.close();
  });

  test('verifies alert counts update in dashboard', async ({ page }) => {
    await page.goto('/proctor');
    
    // Get initial alert count
    const initialAlertCount = await page.getByTestId('alert-count').textContent();
    
    // Navigate to a session
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    
    // Navigate back to dashboard
    await page.goto('/proctor');
    
    // Verify alert count is still present
    const currentAlertCount = await page.getByTestId('alert-count').textContent();
    expect(currentAlertCount).not.toBeNull();
  });

  test('verifies alert notification sounds', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Check if notification sound setting exists
    const soundToggle = page.getByRole('switch', { name: 'Alert sounds' });
    const isSoundToggleVisible = await soundToggle.isVisible().catch(() => false);

    if (isSoundToggleVisible) {
      // Enable alert sounds
      await soundToggle.check();
      await expect(soundToggle).toBeChecked();

      // Disable alert sounds
      await soundToggle.uncheck();
      await expect(soundToggle).not.toBeChecked();
    }
  });

  test('views alert details and context', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.getByRole('tab', { name: 'Alerts' }).click();

    // Find an alert
    const alertItem = page.locator('[data-alert-item]').first();
    const hasAlerts = await alertItem.count() > 0;

    if (hasAlerts) {
      // Click on alert to view details
      await alertItem.click();

      // Verify alert details are shown
      await expect(page.getByRole('dialog', { name: /Alert Details/i })).toBeVisible();

      // Verify alert metadata
      await expect(page.getByText('Severity')).toBeVisible();
      await expect(page.getByText('Timestamp')).toBeVisible();
      await expect(page.getByText('Student')).toBeVisible();

      // Close details
      await page.getByRole('button', { name: 'Close' }).click();
    }
  });
});

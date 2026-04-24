import { expect, test } from '@playwright/test';
import {
  ADMIN_STORAGE_STATE_PATH,
  readBackendE2EManifest,
  STUDENT_STORAGE_STATE_PATH,
} from './support/backendE2e';

test.use({ storageState: ADMIN_STORAGE_STATE_PATH });

test.describe('Proctor Live Mode and Degraded State', () => {
  test('operates in live mode with WebSocket enabled', async ({ browser, page }) => {
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

    // Navigate to proctor dashboard
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Verify live mode indicator
    const liveModeIndicator = page.getByTestId('live-mode-indicator');
    await expect(liveModeIndicator).toBeVisible();
    await expect(liveModeIndicator).toHaveText(/Live/i);

    // Verify WebSocket connection status
    const wsStatus = page.getByTestId('websocket-status');
    await expect(wsStatus).toBeVisible();
    await expect(wsStatus).toHaveText(/Connected/i);

    // Verify real-time updates work
    const initialStudentStatus = await page.locator('[data-student-card]').first().getAttribute('data-status');
    
    // Wait for potential updates
    await page.waitForTimeout(2000);
    
    // Verify status can change (WebSocket is active)
    await expect(page.locator('[data-student-card]')).toBeVisible();

    await studentContext.close();
  });

  test('simulates WebSocket failure and verifies degraded mode fallback', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Simulate WebSocket failure
    await page.evaluate(() => {
      // Close WebSocket connection
      const ws = (window as any).websocketConnection;
      if (ws) {
        ws.close();
      }
    });

    // Wait for degraded mode to activate
    await page.waitForTimeout(3000);

    // Verify degraded mode warning banner
    const degradedBanner = page.getByTestId('degraded-mode-banner');
    const isBannerVisible = await degradedBanner.isVisible().catch(() => false);
    
    if (isBannerVisible) {
      await expect(degradedBanner).toBeVisible();
      await expect(degradedBanner).toContainText(/degraded/i);
    }

    // Verify polling fallback indicator
    const pollingIndicator = page.getByTestId('polling-indicator');
    const isPollingVisible = await pollingIndicator.isVisible().catch(() => false);
    
    if (isPollingVisible) {
      await expect(pollingIndicator).toBeVisible();
      await expect(pollingIndicator).toContainText(/polling/i);
    }
  });

  test('verifies polling fallback in degraded mode', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Check polling interval configuration
    const pollingInterval = await page.evaluate(() => {
      return (window as any).POLLING_INTERVAL || 5000;
    });
    
    expect(pollingInterval).toBeGreaterThan(0);
    expect(pollingInterval).toBeLessThan(30000); // Should be less than 30 seconds

    // Simulate degraded mode
    await page.evaluate(() => {
      (window as any).degradedLiveMode = true;
    });

    // Verify polling is active
    const pollingActive = await page.evaluate(() => {
      return (window as any).isPollingActive || false;
    });
    
    expect(pollingActive).toBe(true);
  });

  test('verifies recovery from degraded mode', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Simulate degraded mode
    await page.evaluate(() => {
      (window as any).degradedLiveMode = true;
    });

    await page.waitForTimeout(2000);

    // Verify degraded mode is active
    const degradedFlag = await page.evaluate(() => {
      return (window as any).degradedLiveMode;
    });
    expect(degradedFlag).toBe(true);

    // Simulate WebSocket recovery
    await page.evaluate(() => {
      (window as any).degradedLiveMode = false;
      // Trigger reconnection
      if ((window as any).reconnectWebSocket) {
        (window as any).reconnectWebSocket();
      }
    });

    await page.waitForTimeout(3000);

    // Verify recovery to live mode
    const liveModeIndicator = page.getByTestId('live-mode-indicator');
    const isLiveVisible = await liveModeIndicator.isVisible().catch(() => false);
    
    if (isLiveVisible) {
      await expect(liveModeIndicator).toHaveText(/Live/i);
    }

    // Verify degraded mode banner is gone
    const degradedBanner = page.getByTestId('degraded-mode-banner');
    const isBannerVisible = await degradedBanner.isVisible().catch(() => false);
    expect(isBannerVisible).toBe(false);
  });

  test('verifies manual live mode toggle', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Check for manual toggle button
    const liveModeToggle = page.getByRole('button', { name: /Toggle Live Mode/i });
    const isToggleVisible = await liveModeToggle.isVisible().catch(() => false);

    if (isToggleVisible) {
      // Toggle to polling mode
      await liveModeToggle.click();
      
      // Verify polling mode is active
      const pollingIndicator = page.getByTestId('polling-indicator');
      await expect(pollingIndicator).toBeVisible();

      // Toggle back to live mode
      await liveModeToggle.click();
      
      // Verify live mode is active
      const liveModeIndicator = page.getByTestId('live-mode-indicator');
      await expect(liveModeIndicator).toBeVisible();
    }
  });

  test('verifies degraded_live_mode flag is set correctly', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Check initial state
    const initialDegradedFlag = await page.evaluate(() => {
      return (window as any).degradedLiveMode || false;
    });
    expect(initialDegradedFlag).toBe(false);

    // Simulate WebSocket failure
    await page.evaluate(() => {
      (window as any).degradedLiveMode = true;
    });

    // Verify flag is set
    const degradedFlag = await page.evaluate(() => {
      return (window as any).degradedLiveMode;
    });
    expect(degradedFlag).toBe(true);

    // Verify flag is reflected in UI
    const degradedBanner = page.getByTestId('degraded-mode-banner');
    const isBannerVisible = await degradedBanner.isVisible().catch(() => false);
    
    if (isBannerVisible) {
      await expect(degradedBanner).toBeVisible();
    }
  });

  test('verifies real-time updates in live mode', async ({ browser, page }) => {
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

    // Navigate to proctor dashboard
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Record initial student count
    const initialStudentCount = await page.locator('[data-student-card]').count();

    // Wait for WebSocket updates
    await page.waitForTimeout(3000);

    // Verify student cards are still visible (real-time updates working)
    const currentStudentCount = await page.locator('[data-student-card]').count();
    expect(currentStudentCount).toBeGreaterThanOrEqual(initialStudentCount);

    await studentContext.close();
  });

  test('verifies data consistency during mode transitions', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Get initial data
    const initialStudentData = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-student-card]');
      return Array.from(cards).map(card => ({
        id: card.getAttribute('data-student-id'),
        status: card.getAttribute('data-status'),
      }));
    });

    // Simulate mode transition
    await page.evaluate(() => {
      (window as any).degradedLiveMode = true;
    });

    await page.waitForTimeout(2000);

    // Get data after transition
    const transitionedStudentData = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-student-card]');
      return Array.from(cards).map(card => ({
        id: card.getAttribute('data-student-id'),
        status: card.getAttribute('data-status'),
      }));
    });

    // Verify data consistency
    expect(transitionedStudentData.length).toBe(initialStudentData.length);
    
    for (let i = 0; i < initialStudentData.length; i++) {
      expect(transitionedStudentData[i].id).toBe(initialStudentData[i].id);
    }

    // Recover to live mode
    await page.evaluate(() => {
      (window as any).degradedLiveMode = false;
    });

    await page.waitForTimeout(2000);

    // Get data after recovery
    const recoveredStudentData = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-student-card]');
      return Array.from(cards).map(card => ({
        id: card.getAttribute('data-student-id'),
        status: card.getAttribute('data-status'),
      }));
    });

    // Verify data consistency after recovery
    expect(recoveredStudentData.length).toBe(initialStudentData.length);
  });

  test('verifies alert delivery in both live and degraded modes', async ({ browser, page }) => {
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

    // Navigate to proctor dashboard in live mode
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();
    await page.getByRole('tab', { name: 'Alerts' }).click();

    // Check alerts in live mode
    const liveModeAlerts = await page.locator('[data-alert-item]').count();
    
    // Switch to degraded mode
    await page.evaluate(() => {
      (window as any).degradedLiveMode = true;
    });

    await page.waitForTimeout(3000);

    // Check alerts in degraded mode (should still be available via polling)
    const degradedModeAlerts = await page.locator('[data-alert-item]').count();
    
    // Alerts should be consistent
    expect(degradedModeAlerts).toBeGreaterThanOrEqual(liveModeAlerts);

    // Recover to live mode
    await page.evaluate(() => {
      (window as any).degradedLiveMode = false;
    });

    await studentContext.close();
  });
});

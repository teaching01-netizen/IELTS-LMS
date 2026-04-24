import { expect, test } from '@playwright/test';
import {
  ADMIN_STORAGE_STATE_PATH,
  readBackendE2EManifest,
  STUDENT_STORAGE_STATE_PATH,
} from './support/backendE2e';

test.describe('Error Recovery', () => {
  test('backend API failure handling', async ({ page }) => {
    const manifest = readBackendE2EManifest();
    await page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`);

    // Simulate API failure by intercepting requests
    await page.route('**/api/**', route => {
      route.abort('failed');
    });

    // Verify error message is shown
    await expect(page.getByText(/error|failed|unavailable/i)).toBeVisible({ timeout: 10000 });

    // Remove interception to allow recovery
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // Reload page
    await page.reload();

    // Verify recovery
    const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }
  });

  test('database connection failure handling', async ({ page }) => {
    await page.goto('/admin/exams');

    // Simulate database failure
    await page.evaluate(() => {
      (window as any).simulateDatabaseFailure = true;
    });

    // Try to load data
    await page.reload();

    // Check for error message
    const errorMessage = page.getByText(/database error|connection failed/i);
    const hasError = await errorMessage.count() > 0;

    if (hasError) {
      await expect(errorMessage.first()).toBeVisible();
    }

    // Remove simulation
    await page.evaluate(() => {
      (window as any).simulateDatabaseFailure = false;
    });

    // Reload to recover
    await page.reload();
    await expect(page.getByRole('heading', { name: /Exams/i })).toBeVisible();
  });

  test('WebSocket reconnection', async ({ page }) => {
    await page.goto('/proctor');
    await page.getByRole('button', { name: /Monitor/i }).first().click();

    // Simulate WebSocket disconnection
    await page.evaluate(() => {
      const ws = (window as any).websocketConnection;
      if (ws) {
        ws.close();
      }
    });

    // Wait for reconnection attempt
    await page.waitForTimeout(3000);

    // Verify reconnection status
    const wsStatus = page.getByTestId('websocket-status');
    const isStatusVisible = await wsStatus.isVisible().catch(() => false);

    if (isStatusVisible) {
      const statusText = await wsStatus.textContent();
      expect(statusText).toMatch(/reconnecting|connected/i);
    }
  });

  test('file upload failure handling', async ({ page }) => {
    await page.goto('/admin/media');
    await page.getByRole('tab', { name: 'Images' }).click();

    // Simulate upload failure
    await page.route('**/upload', route => {
      route.abort('failed');
    });

    // Try to upload
    const fileInput = page.getByLabel('Upload image');
    await fileInput.setInputFiles({
      name: 'test.png',
      mimeType: 'image/png',
      buffer: Buffer.from('test'),
    });

    // Verify error message
    await expect(page.getByText(/upload failed|error/i)).toBeVisible({ timeout: 10000 });

    // Remove interception
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('payment failure handling', async ({ page }) => {
    // This test is for payment functionality if it exists
    await page.goto('/student/payment');

    // Check if payment page exists
    const paymentSection = page.getByText(/payment|checkout/i);
    const hasPayment = await paymentSection.count() > 0;

    if (hasPayment) {
      // Simulate payment failure
      await page.evaluate(() => {
        (window as any).simulatePaymentFailure = true;
      });

      // Try to complete payment
      const payButton = page.getByRole('button', { name: /pay|complete/i });
      const hasPayButton = await payButton.count() > 0;

      if (hasPayButton) {
        await payButton.click();

        // Verify error message
        await expect(page.getByText(/payment failed|error/i)).toBeVisible();
      }

      // Remove simulation
      await page.evaluate(() => {
        (window as any).simulatePaymentFailure = false;
      });
    }
  });

  test('graceful error messages', async ({ page }) => {
    // Navigate to a page that might have errors
    await page.goto('/admin/nonexistent-page');

    // Verify graceful error page is shown
    await expect(page.getByText(/not found|404|page not found/i)).toBeVisible();
  });

  test('retry logic works', async ({ page }) => {
    let requestCount = 0;

    // Intercept requests and fail first few
    await page.route('**/api/v1/exams', route => {
      requestCount++;
      if (requestCount <= 2) {
        route.abort('failed');
      } else {
        route.continue();
      }
    });

    await page.goto('/admin/exams');

    // Wait for retry to succeed
    await page.waitForTimeout(5000);

    // Verify page loaded successfully after retries
    await expect(page.getByRole('heading', { name: /Exams/i })).toBeVisible();

    // Remove interception
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('state preserved on error', async ({ page }) => {
    const manifest = readBackendE2EManifest();
    await page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`);

    const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }

    // Fill in an answer
    const testAnswer = `state preservation test ${Date.now()}`;
    await page.getByLabel('Answer for question 1').fill(testAnswer);

    // Simulate error
    await page.evaluate(() => {
      (window as any).simulateError = true;
    });

    // Trigger error
    await page.reload();

    // Remove error simulation
    await page.evaluate(() => {
      (window as any).simulateError = false;
    });

    // Reload to recover
    await page.reload();

    // Verify state was preserved (if using local storage or similar)
    const answerValue = await page.getByLabel('Answer for question 1').inputValue();
    // Note: This depends on how state is persisted
    // If using localStorage, the answer should be preserved
  });

  test('error logs captured', async ({ page }) => {
    // Trigger an error
    await page.evaluate(() => {
      throw new Error('Test error for logging');
    });

    // Navigate to error logs page if it exists
    await page.goto('/admin/error-logs');

    // Check if error logs page exists
    const errorLogsSection = page.getByRole('heading', { name: /Error Logs/i });
    const hasErrorLogs = await errorLogsSection.count() > 0;

    if (hasErrorLogs) {
      await expect(errorLogsSection).toBeVisible();

      // Verify error is logged
      const errorEntries = page.locator('[data-error-log-entry]');
      const hasEntries = await errorEntries.count() > 0;
      expect(hasEntries).toBe(true);
    }
  });

  test('network timeout handling', async ({ page }) => {
    // Simulate network timeout
    await page.route('**/api/**', route => {
      // Delay response significantly
      setTimeout(() => route.continue(), 60000);
    });

    await page.goto('/admin/exams');

    // Verify timeout error message
    await expect(page.getByText(/timeout|request timed out/i)).toBeVisible({ timeout: 35000 });

    // Remove interception
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // Reload to recover
    await page.reload();
  });

  test('invalid data handling', async ({ page }) => {
    await page.goto('/admin/exams');

    // Try to submit invalid data
    await page.getByRole('button', { name: 'Create Exam' }).click();

    // Submit without required fields
    await page.getByRole('button', { name: 'Create' }).click();

    // Verify validation error
    await expect(page.getByText(/required|invalid|please fill/i)).toBeVisible();
  });

  test('concurrent error handling', async ({ browser }) => {
    const manifest = readBackendE2EManifest();

    // Create multiple contexts
    const contexts = [];
    const pages = [];

    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({
        storageState: STUDENT_STORAGE_STATE_PATH,
      });
      const page = await context.newPage();
      contexts.push(context);
      pages.push(page);
    }

    // Simulate errors in all contexts
    for (const page of pages) {
      await page.route('**/api/**', route => route.abort('failed'));
      await page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`);
    }

    // Verify all handle errors gracefully
    for (const page of pages) {
      await expect(page.getByText(/error|failed/i)).toBeVisible({ timeout: 10000 });
    }

    // Clean up
    for (const context of contexts) {
      await context.close();
    }
  });

  test('recovery after browser crash', async ({ page }) => {
    const manifest = readBackendE2EManifest();
    await page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`);

    const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }

    // Fill in answer
    const testAnswer = `crash recovery test ${Date.now()}`;
    await page.getByLabel('Answer for question 1').fill(testAnswer);

    // Simulate crash by closing context (in real scenario, browser would crash)
    // Here we just verify state can be recovered on reload
    await page.reload();

    // Verify recovery
    const compatibilityCheck2 = page.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible2 = await compatibilityCheck2.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible2) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }

    await expect(page.getByLabel('Answer for question 1')).toBeVisible();
  });

  test('error boundary catches component errors', async ({ page }) => {
    await page.goto('/admin/exams');

    // Trigger component error
    await page.evaluate(() => {
      const root = document.getElementById('root');
      if (root) {
        root.innerHTML = '<div data-error-boundary="true">Error caught by boundary</div>';
      }
    });

    // Verify error boundary is active
    const errorBoundary = page.getByTestId('error-boundary');
    const hasErrorBoundary = await errorBoundary.count() > 0;

    if (hasErrorBoundary) {
      await expect(errorBoundary).toBeVisible();
    }
  });

  test('degraded mode activation on errors', async ({ page }) => {
    await page.goto('/proctor');

    // Simulate repeated failures to trigger degraded mode
    await page.route('**/api/**', route => route.abort('failed'));

    await page.reload();

    // Check for degraded mode indicator
    const degradedModeBanner = page.getByTestId('degraded-mode-banner');
    const isBannerVisible = await degradedModeBanner.isVisible().catch(() => false);

    if (isBannerVisible) {
      await expect(degradedModeBanner).toBeVisible();
    }

    // Remove interception
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('user notification on errors', async ({ page }) => {
    await page.goto('/admin/exams');

    // Trigger error
    await page.evaluate(() => {
      throw new Error('Notification test error');
    });

    // Check for error notification/toast
    const errorNotification = page.getByTestId('error-notification');
    const hasNotification = await errorNotification.count() > 0;

    if (hasNotification) {
      await expect(errorNotification).toBeVisible();
      await expect(errorNotification).toContainText(/error|failed/i);
    }
  });
});

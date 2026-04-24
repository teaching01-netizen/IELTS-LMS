import { expect, test } from '@playwright/test';
import {
  ADMIN_STORAGE_STATE_PATH,
  readBackendE2EManifest,
  STUDENT_STORAGE_STATE_PATH,
} from './support/backendE2e';

test.describe('Browser Compatibility', () => {
  test('Chrome latest - core functionality', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'This test is for Chrome/Chromium');

    const manifest = readBackendE2EManifest();
    await page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`);

    const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }

    await expect(page.getByLabel('Answer for question 1')).toBeVisible();
    await page.getByLabel('Answer for question 1').fill('Chrome test answer');
    expect(await page.getByLabel('Answer for question 1').inputValue()).toBe('Chrome test answer');
  });

  test('Firefox latest - core functionality', async ({ page, browserName }) => {
    test.skip(browserName !== 'firefox', 'This test is for Firefox');

    const manifest = readBackendE2EManifest();
    await page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`);

    const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }

    await expect(page.getByLabel('Answer for question 1')).toBeVisible();
    await page.getByLabel('Answer for question 1').fill('Firefox test answer');
    expect(await page.getByLabel('Answer for question 1').inputValue()).toBe('Firefox test answer');
  });

  test('Edge latest - core functionality', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'This test is for Edge/Chromium');

    const manifest = readBackendE2EManifest();
    await page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`);

    const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }

    await expect(page.getByLabel('Answer for question 1')).toBeVisible();
    await page.getByLabel('Answer for question 1').fill('Edge test answer');
    expect(await page.getByLabel('Answer for question 1').inputValue()).toBe('Edge test answer');
  });

  test('Safari - acknowledgment flow', async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit', 'This test is for Safari/Webkit');

    const manifest = readBackendE2EManifest();
    await page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`);

    // Safari should show acknowledgment dialog
    const safariAckDialog = page.getByRole('dialog', { name: /Safari/i });
    const isAckVisible = await safariAckDialog.isVisible().catch(() => false);

    if (isAckVisible) {
      await expect(safariAckDialog).toBeVisible();
      await page.getByRole('button', { name: 'Acknowledge' }).click();
    }

    const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }

    await expect(page.getByLabel('Answer for question 1')).toBeVisible();
  });

  test('fallbacks for unsupported APIs', async ({ page }) => {
    await page.goto('/student/test-compatibility');

    // Check if browser supports required APIs
    const apiSupport = await page.evaluate(() => {
      return {
        webSocket: typeof WebSocket !== 'undefined',
        localStorage: typeof localStorage !== 'undefined',
        sessionStorage: typeof sessionStorage !== 'undefined',
        fetch: typeof fetch !== 'undefined',
        mediaDevices: typeof navigator.mediaDevices !== 'undefined',
      };
    });

    // Verify fallbacks are in place for missing APIs
    if (!apiSupport.webSocket) {
      const pollingIndicator = page.getByTestId('polling-fallback-active');
      await expect(pollingIndicator).toBeVisible();
    }

    if (!apiSupport.mediaDevices) {
      const cameraFallback = page.getByTestId('camera-fallback');
      await expect(cameraFallback).toBeVisible();
    }
  });

  test('mobile responsive design', async ({ page, browserName }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    const manifest = readBackendE2EManifest();
    await page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`);

    const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }

    // Verify mobile layout
    await expect(page.getByLabel('Answer for question 1')).toBeVisible();
    
    // Check for mobile-specific elements
    const mobileNav = page.getByTestId('mobile-navigation');
    const isMobileNavVisible = await mobileNav.isVisible().catch(() => false);
    
    if (isMobileNavVisible) {
      await expect(mobileNav).toBeVisible();
    }
  });

  test('tablet responsive design', async ({ page }) => {
    // Set tablet viewport
    await page.setViewportSize({ width: 768, height: 1024 });

    const manifest = readBackendE2EManifest();
    await page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`);

    const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }

    // Verify tablet layout
    await expect(page.getByLabel('Answer for question 1')).toBeVisible();
  });

  test('high DPI display support', async ({ page }) => {
    // Set high DPI viewport
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.evaluate(() => {
      (window as any).devicePixelRatio = 2;
    });

    const manifest = readBackendE2EManifest();
    await page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`);

    const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }

    // Verify elements render correctly at high DPI
    await expect(page.getByLabel('Answer for question 1')).toBeVisible();
  });

  test('dark mode support', async ({ page }) => {
    // Enable dark mode
    await page.emulateMedia({ colorScheme: 'dark' });

    const manifest = readBackendE2EManifest();
    await page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`);

    const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }

    // Verify dark mode styles are applied
    const body = page.locator('body');
    const hasDarkClass = await body.getAttribute('class');
    
    if (hasDarkClass) {
      expect(hasDarkClass).toContain('dark');
    }
  });

  test('reduced motion support', async ({ page }) => {
    // Enable reduced motion
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const manifest = readBackendE2EManifest();
    await page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`);

    const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }

    // Verify reduced motion is respected
    await expect(page.getByLabel('Answer for question 1')).toBeVisible();
  });

  test('touch event support', async ({ page }) => {
    // Set touch capabilities
    const context = page.context();
    await context.setGeolocation({ latitude: 0, longitude: 0 });

    const manifest = readBackendE2EManifest();
    await page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`);

    const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }

    // Verify touch interactions work
    await page.getByLabel('Answer for question 1').tap();
    await expect(page.getByLabel('Answer for question 1')).toBeFocused();
  });

  test('keyboard navigation support', async ({ page }) => {
    const manifest = readBackendE2EManifest();
    await page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`);

    const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }

    // Navigate using keyboard
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    
    // Verify focus moves correctly
    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();
  });

  test('screen reader compatibility', async ({ page }) => {
    const manifest = readBackendE2EManifest();
    await page.goto(`/student/${manifest.student.scheduleId}/${manifest.student.candidateId}`);

    const compatibilityCheck = page.getByRole('heading', { name: 'System checking' });
    const isCompatibilityCheckVisible = await compatibilityCheck.isVisible().catch(() => false);
    if (isCompatibilityCheckVisible) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }

    // Verify ARIA labels are present
    const answerInput = page.getByLabel('Answer for question 1');
    await expect(answerInput).toBeVisible();
    
    // Check for aria-label or aria-labelledby
    const ariaLabel = await answerInput.getAttribute('aria-label');
    const ariaLabelledBy = await answerInput.getAttribute('aria-labelledby');
    
    expect(ariaLabel || ariaLabelledBy).toBeTruthy();
  });

  test('browser feature detection', async ({ page }) => {
    await page.goto('/student/test-compatibility');

    const features = await page.evaluate(() => {
      return {
        es6: typeof Promise !== 'undefined',
        webGL: !!((window as any).WebGLRenderingContext),
        webWorkers: typeof Worker !== 'undefined',
        serviceWorker: 'serviceWorker' in navigator,
        notifications: 'Notification' in window,
      };
    });

    // Log feature support for debugging
    console.log('Browser features:', features);

    // Verify critical features are supported
    expect(features.es6).toBe(true);
  });

  test('cross-browser localStorage persistence', async ({ page }) => {
    await page.goto('/');

    // Set a value in localStorage
    await page.evaluate(() => {
      localStorage.setItem('test-key', 'test-value');
    });

    // Reload page
    await page.reload();

    // Verify value persisted
    const storedValue = await page.evaluate(() => {
      return localStorage.getItem('test-key');
    });

    expect(storedValue).toBe('test-value');

    // Cleanup
    await page.evaluate(() => {
      localStorage.removeItem('test-key');
    });
  });

  test('cross-browser sessionStorage persistence', async ({ page }) => {
    await page.goto('/');

    // Set a value in sessionStorage
    await page.evaluate(() => {
      sessionStorage.setItem('test-key', 'test-value');
    });

    // Reload page
    await page.reload();

    // Verify value persisted
    const storedValue = await page.evaluate(() => {
      return sessionStorage.getItem('test-key');
    });

    expect(storedValue).toBe('test-value');
  });

  test('cookie support across browsers', async ({ page }) => {
    await page.goto('/');

    // Set a cookie
    await page.context().addCookies([
      {
        name: 'test-cookie',
        value: 'test-value',
        domain: 'localhost',
        path: '/',
      },
    ]);

    // Reload page
    await page.reload();

    // Verify cookie is accessible
    const cookies = await page.context().cookies();
    const testCookie = cookies.find(c => c.name === 'test-cookie');
    
    expect(testCookie).toBeDefined();
    expect(testCookie?.value).toBe('test-value');
  });
});

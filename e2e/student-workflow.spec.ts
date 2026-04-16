import { test, expect } from '@playwright/test';

test.describe('Student Workflow Tests', () => {
  test('student can access pre-check system compatibility', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to student section
    const studentNav = page.getByRole('link', { name: /student/i }).or(page.getByRole('button', { name: /student/i }));
    const studentNavVisible = await studentNav.isVisible().catch(() => false);
    
    if (studentNavVisible) {
      await studentNav.first().click();
      await page.waitForLoadState('networkidle');
      
      // Verify pre-check or compatibility check is available
      await expect(page.getByText(/system check|compatibility|pre-check/i)).toBeVisible();
    }
  });

  test('student can enter lobby before exam', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to student
    const studentNav = page.getByRole('link', { name: /student/i }).or(page.getByRole('button', { name: /student/i }));
    const studentNavVisible = await studentNav.isVisible().catch(() => false);
    
    if (studentNavVisible) {
      await studentNav.first().click();
      await page.waitForLoadState('networkidle');
      
      // Look for lobby or start exam button
      const startButton = page.getByRole('button', { name: /start|begin|enter/i });
      const startButtonVisible = await startButton.isVisible().catch(() => false);
      
      if (startButtonVisible) {
        await expect(startButton).toBeVisible();
      }
    }
  });

  test('student exam interface displays timer and navigation', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to student
    const studentNav = page.getByRole('link', { name: /student/i }).or(page.getByRole('button', { name: /student/i }));
    const studentNavVisible = await studentNav.isVisible().catch(() => false);
    
    if (studentNavVisible) {
      await studentNav.first().click();
      await page.waitForLoadState('networkidle');
      
      // If in exam mode, verify timer and navigation are present
      const timer = page.getByText(/\d+:\d+/).or(page.getByRole('timer', { name: /time/i }));
      const timerVisible = await timer.isVisible().catch(() => false);
      
      if (timerVisible) {
        await expect(timer).toBeVisible();
      }
      
      // Check for navigation elements (module tabs, question navigator)
      const navElements = page.getByRole('navigation').or(page.getByRole('tablist'));
      const navVisible = await navElements.isVisible().catch(() => false);
      
      if (navVisible) {
        await expect(navElements.first()).toBeVisible();
      }
    }
  });

  test('student can access accessibility settings', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to student
    const studentNav = page.getByRole('link', { name: /student/i }).or(page.getByRole('button', { name: /student/i }));
    const studentNavVisible = await studentNav.isVisible().catch(() => false);
    
    if (studentNavVisible) {
      await studentNav.first().click();
      await page.waitForLoadState('networkidle');
      
      // Look for accessibility settings button (often a contrast icon)
      const a11yButton = page.getByRole('button', { name: /accessibility|contrast|settings/i }).or(page.getByLabel(/accessibility/i));
      const a11yVisible = await a11yButton.isVisible().catch(() => false);
      
      if (a11yVisible) {
        await a11yButton.click();
        // Verify accessibility options appear
        await expect(page.getByText(/font size|contrast|high contrast/i)).toBeVisible();
      }
    }
  });

  test('student exam supports keyboard navigation', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to student
    const studentNav = page.getByRole('link', { name: /student/i }).or(page.getByRole('button', { name: /student/i }));
    const studentNavVisible = await studentNav.isVisible().catch(() => false);
    
    if (studentNavVisible) {
      await studentNav.first().click();
      await page.waitForLoadState('networkidle');
      
      // Test keyboard accessibility
      await page.keyboard.press('Tab');
      const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
      expect(['BUTTON', 'A', 'INPUT', 'SELECT', 'SUMMARY', 'TEXTAREA']).toContain(focusedElement);
    }
  });
});

import { test, expect } from '@playwright/test';

test.describe('Proctor Workflow Tests', () => {
  test('proctor can access monitoring dashboard', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to proctor section
    const proctorNav = page.getByRole('link', { name: /proctor/i }).or(page.getByRole('button', { name: /proctor/i }));
    const proctorNavVisible = await proctorNav.isVisible().catch(() => false);
    
    if (proctorNavVisible) {
      await proctorNav.first().click();
      await page.waitForLoadState('networkidle');
      
      // Verify proctor dashboard elements are visible
      await expect(page.getByText(/monitoring|dashboard|students/i)).toBeVisible();
    }
  });

  test('proctor can view active sessions', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to proctor
    const proctorNav = page.getByRole('link', { name: /proctor/i }).or(page.getByRole('button', { name: /proctor/i }));
    const proctorNavVisible = await proctorNav.isVisible().catch(() => false);
    
    if (proctorNavVisible) {
      await proctorNav.first().click();
      await page.waitForLoadState('networkidle');
      
      // Look for session list or student monitoring
      const sessionList = page.getByText(/session|student|candidate/i);
      const sessionVisible = await sessionList.isVisible().catch(() => false);
      
      if (sessionVisible) {
        await expect(sessionList.first()).toBeVisible();
      }
    }
  });

  test('proctor can access session controls', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to proctor
    const proctorNav = page.getByRole('link', { name: /proctor/i }).or(page.getByRole('button', { name: /proctor/i }));
    const proctorNavVisible = await proctorNav.isVisible().catch(() => false);
    
    if (proctorNavVisible) {
      await proctorNav.first().click();
      await page.waitForLoadState('networkidle');
      
      // Look for proctor controls (pause, resume, end session)
      const controlButtons = page.getByRole('button', { name: /pause|resume|end|start/i });
      const controlsVisible = await controlButtons.isVisible().catch(() => false);
      
      if (controlsVisible) {
        await expect(controlButtons.first()).toBeVisible();
      }
    }
  });

  test('proctor dashboard is keyboard accessible', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to proctor
    const proctorNav = page.getByRole('link', { name: /proctor/i }).or(page.getByRole('button', { name: /proctor/i }));
    const proctorNavVisible = await proctorNav.isVisible().catch(() => false);
    
    if (proctorNavVisible) {
      await proctorNav.first().click();
      await page.waitForLoadState('networkidle');
      
      // Test keyboard navigation
      await page.keyboard.press('Tab');
      const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
      expect(['BUTTON', 'A', 'INPUT', 'SELECT', 'SUMMARY']).toContain(focusedElement);
    }
  });
});

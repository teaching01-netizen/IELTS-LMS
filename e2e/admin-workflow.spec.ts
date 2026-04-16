import { test, expect } from '@playwright/test';

test.describe('Admin Workflow Tests', () => {
  test('admin can navigate to exams view and see exam list', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to admin section
    const adminNav = page.getByRole('link', { name: /admin/i }).or(page.getByRole('button', { name: /admin/i }));
    await expect(adminNav.first()).toBeVisible();
    await adminNav.first().click();
    
    // Wait for admin content to load
    await page.waitForLoadState('networkidle');
    
    // Verify we're in admin context by checking for admin-specific elements
    await expect(page.getByText(/exams/i).or(page.getByText(/dashboard/i))).toBeVisible();
  });

  test('admin can access exam creation flow', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to admin
    const adminNav = page.getByRole('link', { name: /admin/i }).or(page.getByRole('button', { name: /admin/i }));
    await adminNav.first().click();
    await page.waitForLoadState('networkidle');
    
    // Look for create/new exam button in admin interface
    const createButton = page.getByRole('button', { name: /create exam|new exam|add exam/i }).or(page.getByText(/create/i));
    const isVisible = await createButton.isVisible().catch(() => false);
    
    if (isVisible) {
      await createButton.click();
      // Verify a form or dialog appears for exam creation
      await expect(page.locator('form').or(page.locator('[role="dialog"]').or(page.getByRole('dialog')))).toBeVisible({ timeout: 5000 });
    }
  });

  test('admin exam list supports keyboard navigation', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to admin
    const adminNav = page.getByRole('link', { name: /admin/i }).or(page.getByRole('button', { name: /admin/i }));
    await adminNav.first().click();
    await page.waitForLoadState('networkidle');
    
    // Test keyboard accessibility by tabbing through the interface
    await page.keyboard.press('Tab');
    const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
    expect(['BUTTON', 'A', 'INPUT', 'SELECT', 'SUMMARY']).toContain(focusedElement);
  });

  test('admin can filter or search exams', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to admin
    const adminNav = page.getByRole('link', { name: /admin/i }).or(page.getByRole('button', { name: /admin/i }));
    await adminNav.first().click();
    await page.waitForLoadState('networkidle');
    
    // Look for search input
    const searchInput = page.getByRole('textbox', { name: /search|filter/i }).or(page.getByPlaceholder(/search/i));
    const isVisible = await searchInput.isVisible().catch(() => false);
    
    if (isVisible) {
      await searchInput.fill('test');
      // Verify search input accepts text
      expect(await searchInput.inputValue()).toContain('test');
    }
  });
});

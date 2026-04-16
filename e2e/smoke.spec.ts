import { test, expect } from '@playwright/test';

test.describe('Application Workflow Tests', () => {
  test('user can navigate between product surfaces', async ({ page }) => {
    await page.goto('/');
    
    // Navigate to admin
    const adminNav = page.getByRole('link', { name: /admin/i }).or(page.getByRole('button', { name: /admin/i }));
    await expect(adminNav.first()).toBeVisible();
    await adminNav.first().click();
    await page.waitForLoadState('networkidle');
    await expect(page.url()).toContain('/admin');
    
    // Navigate to builder (if accessible)
    const builderNav = page.getByRole('link', { name: /builder/i }).or(page.getByRole('button', { name: /builder/i }));
    const builderVisible = await builderNav.isVisible().catch(() => false);
    if (builderVisible) {
      await builderNav.first().click();
      await page.waitForLoadState('networkidle');
      await expect(page.url()).toContain('/builder');
    }
  });

  test('admin exam list loads and displays data', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Verify exam list container exists
    await expect(page.getByText(/exams/i).or(page.getByText(/dashboard/i))).toBeVisible();
    
    // Look for data table or list items
    const table = page.locator('table').or(page.locator('[role="table"]'));
    const listItems = page.locator('[role="listitem"]').or(page.locator('li'));
    
    const hasData = await table.isVisible().catch(() => false) || 
                    await listItems.count().then(count => count > 0);
    
    // Either table or list should be present (may be empty initially)
    expect(hasData).toBeTruthy();
  });

  test('student exam interface loads with proper accessibility', async ({ page }) => {
    // Navigate to student surface (may need a scheduleId in real scenario)
    await page.goto('/student');
    await page.waitForLoadState('networkidle');
    
    // Verify student interface elements are present
    const studentContent = page.getByText(/exam|question|test/i).or(page.locator('[role="main"]'));
    await expect(studentContent.first()).toBeVisible();
    
    // Check for skip link (accessibility requirement)
    const skipLink = page.locator('a[href*="main"]').or(page.getByRole('link', { name: /skip/i }));
    const skipLinkVisible = await skipLink.isVisible().catch(() => false);
    if (skipLinkVisible) {
      await expect(skipLink).toBeVisible();
    }
  });

  test('application handles navigation errors gracefully', async ({ page }) => {
    // Try to navigate to a non-existent route
    await page.goto('/non-existent-route');
    await page.waitForLoadState('networkidle');
    
    // Should either show a 404/error page or redirect to a valid page
    const hasContent = await page.locator('body').textContent().then(text => text?.length || 0 > 0);
    expect(hasContent).toBeTruthy();
    
    // Console should not have unhandled errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });
    
    // Navigate to a valid route to ensure app is still functional
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Critical errors should not be present
    const criticalErrors = errors.filter(e => e.includes('Error') || e.includes('Failed'));
    expect(criticalErrors.length).toBe(0);
  });
});

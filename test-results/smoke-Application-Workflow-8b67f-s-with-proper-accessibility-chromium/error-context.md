# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Application Workflow Tests >> student exam interface loads with proper accessibility
- Location: e2e/smoke.spec.ts:42:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/exam|question|test/i).or(locator('[role="main"]')).first()
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText(/exam|question|test/i).or(locator('[role="main"]')).first()

```

# Page snapshot

```yaml
- generic [ref=e4]:
  - heading "Route Not Found" [level=2] [ref=e5]
  - paragraph [ref=e6]: This path is not part of the active route tree.
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Application Workflow Tests', () => {
  4  |   test('user can navigate between product surfaces', async ({ page }) => {
  5  |     await page.goto('/');
  6  |     
  7  |     // Navigate to admin
  8  |     const adminNav = page.getByRole('link', { name: /admin/i }).or(page.getByRole('button', { name: /admin/i }));
  9  |     await expect(adminNav.first()).toBeVisible();
  10 |     await adminNav.first().click();
  11 |     await page.waitForLoadState('networkidle');
  12 |     await expect(page.url()).toContain('/admin');
  13 |     
  14 |     // Navigate to builder (if accessible)
  15 |     const builderNav = page.getByRole('link', { name: /builder/i }).or(page.getByRole('button', { name: /builder/i }));
  16 |     const builderVisible = await builderNav.isVisible().catch(() => false);
  17 |     if (builderVisible) {
  18 |       await builderNav.first().click();
  19 |       await page.waitForLoadState('networkidle');
  20 |       await expect(page.url()).toContain('/builder');
  21 |     }
  22 |   });
  23 | 
  24 |   test('admin exam list loads and displays data', async ({ page }) => {
  25 |     await page.goto('/admin');
  26 |     await page.waitForLoadState('networkidle');
  27 |     
  28 |     // Verify exam list container exists
  29 |     await expect(page.getByText(/exams/i).or(page.getByText(/dashboard/i))).toBeVisible();
  30 |     
  31 |     // Look for data table or list items
  32 |     const table = page.locator('table').or(page.locator('[role="table"]'));
  33 |     const listItems = page.locator('[role="listitem"]').or(page.locator('li'));
  34 |     
  35 |     const hasData = await table.isVisible().catch(() => false) || 
  36 |                     await listItems.count().then(count => count > 0);
  37 |     
  38 |     // Either table or list should be present (may be empty initially)
  39 |     expect(hasData).toBeTruthy();
  40 |   });
  41 | 
  42 |   test('student exam interface loads with proper accessibility', async ({ page }) => {
  43 |     // Navigate to student surface (may need a scheduleId in real scenario)
  44 |     await page.goto('/student');
  45 |     await page.waitForLoadState('networkidle');
  46 |     
  47 |     // Verify student interface elements are present
  48 |     const studentContent = page.getByText(/exam|question|test/i).or(page.locator('[role="main"]'));
> 49 |     await expect(studentContent.first()).toBeVisible();
     |                                          ^ Error: expect(locator).toBeVisible() failed
  50 |     
  51 |     // Check for skip link (accessibility requirement)
  52 |     const skipLink = page.locator('a[href*="main"]').or(page.getByRole('link', { name: /skip/i }));
  53 |     const skipLinkVisible = await skipLink.isVisible().catch(() => false);
  54 |     if (skipLinkVisible) {
  55 |       await expect(skipLink).toBeVisible();
  56 |     }
  57 |   });
  58 | 
  59 |   test('application handles navigation errors gracefully', async ({ page }) => {
  60 |     // Try to navigate to a non-existent route
  61 |     await page.goto('/non-existent-route');
  62 |     await page.waitForLoadState('networkidle');
  63 |     
  64 |     // Should either show a 404/error page or redirect to a valid page
  65 |     const hasContent = await page.locator('body').textContent().then(text => text?.length || 0 > 0);
  66 |     expect(hasContent).toBeTruthy();
  67 |     
  68 |     // Console should not have unhandled errors
  69 |     const errors: string[] = [];
  70 |     page.on('console', msg => {
  71 |       if (msg.type() === 'error') {
  72 |         errors.push(msg.text());
  73 |       }
  74 |     });
  75 |     
  76 |     // Navigate to a valid route to ensure app is still functional
  77 |     await page.goto('/admin');
  78 |     await page.waitForLoadState('networkidle');
  79 |     
  80 |     // Critical errors should not be present
  81 |     const criticalErrors = errors.filter(e => e.includes('Error') || e.includes('Failed'));
  82 |     expect(criticalErrors.length).toBe(0);
  83 |   });
  84 | });
  85 | 
```
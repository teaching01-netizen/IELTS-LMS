# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Application Workflow Tests >> admin exam list loads and displays data
- Location: e2e/smoke.spec.ts:24:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/exams/i).or(getByText(/dashboard/i))
Expected: visible
Error: strict mode violation: getByText(/exams/i).or(getByText(/dashboard/i)) resolved to 2 elements:
    1) <span class="text-sm font-medium">Exams</span> aka getByRole('button', { name: 'Exams' })
    2) <div class="px-6 py-12 text-center text-gray-500">No exams found matching your filters</div> aka getByText('No exams found matching your')

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText(/exams/i).or(getByText(/dashboard/i))

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "Skip to main content" [ref=e4] [cursor=pointer]:
    - /url: "#main-content"
  - navigation "Admin navigation" [ref=e5]:
    - generic [ref=e6]:
      - generic [ref=e7]:
        - generic [ref=e8]: IP
        - generic [ref=e9]: IELTS Platform
      - button "Collapse sidebar" [ref=e10]:
        - img [ref=e11]
    - navigation "Main navigation" [ref=e13]:
      - button "Exams" [ref=e14]:
        - img [ref=e15]
        - generic [ref=e17]: Exams
      - button "Scheduling" [ref=e18]:
        - img [ref=e19]
        - generic [ref=e21]: Scheduling
      - button "Grading" [ref=e22]:
        - img [ref=e23]
        - generic [ref=e26]: Grading
      - button "Results" [ref=e27]:
        - img [ref=e28]
        - generic [ref=e30]: Results
      - button "Settings" [ref=e31]:
        - img [ref=e32]
        - generic [ref=e35]: Settings
      - button "Live Proctoring" [ref=e38]:
        - img [ref=e39]
        - generic [ref=e42]: Live Proctoring
    - button "Exit Admin" [ref=e44]
  - generic [ref=e45]:
    - banner [ref=e46]:
      - generic [ref=e48]:
        - img [ref=e49]
        - textbox "Search resources, students, exams" [ref=e52]:
          - /placeholder: Search resources, students, exams...
      - generic [ref=e53]:
        - button "Notifications" [ref=e54]:
          - img [ref=e55]
        - generic [ref=e59] [cursor=pointer]:
          - generic [ref=e60]:
            - paragraph [ref=e61]: Sarah Chen
            - paragraph [ref=e62]: Administrator
          - generic [ref=e63]: SC
    - main [ref=e64]:
      - generic [ref=e65]:
        - generic [ref=e66]:
          - heading "Exam Library" [level=1] [ref=e67]
          - generic [ref=e68]:
            - generic [ref=e69]:
              - img [ref=e70]
              - textbox "Search exams..." [ref=e73]
            - button "Filters" [ref=e74]:
              - img [ref=e75]
              - text: Filters
            - button "Create Exam" [ref=e77]:
              - img [ref=e78]
              - text: Create Exam
            - generic [ref=e79]:
              - button "Grid" [ref=e80]
              - button "List" [ref=e81]
        - generic [ref=e82]:
          - table [ref=e84]:
            - rowgroup [ref=e85]:
              - row "Title Type Status Questions Creator Modified Actions" [ref=e86]:
                - columnheader [ref=e87]:
                  - checkbox [ref=e88]
                - columnheader "Title" [ref=e89]
                - columnheader "Type" [ref=e90]
                - columnheader "Status" [ref=e91]
                - columnheader "Questions" [ref=e92]
                - columnheader "Creator" [ref=e93]
                - columnheader "Modified" [ref=e94]
                - columnheader "Actions" [ref=e95]
            - rowgroup
          - generic [ref=e96]: No exams found matching your filters
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
> 29 |     await expect(page.getByText(/exams/i).or(page.getByText(/dashboard/i))).toBeVisible();
     |                                                                             ^ Error: expect(locator).toBeVisible() failed
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
  49 |     await expect(studentContent.first()).toBeVisible();
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
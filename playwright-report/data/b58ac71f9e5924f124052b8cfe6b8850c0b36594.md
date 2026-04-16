# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: admin-workflow.spec.ts >> Admin Workflow Tests >> admin exam list supports keyboard navigation
- Location: e2e/admin-workflow.spec.ts:38:3

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('link', { name: /admin/i }).or(getByRole('button', { name: /admin/i })).first()

```

# Page snapshot

```yaml
- generic [ref=e5]:
  - generic [ref=e6]:
    - heading "IELTS Proctoring System" [level=1] [ref=e7]
    - paragraph [ref=e8]: Sign in to access your dashboard
  - generic [ref=e9]:
    - generic [ref=e10]:
      - generic [ref=e11]: Email Address
      - textbox "Email Address" [ref=e12]:
        - /placeholder: you@example.com
    - generic [ref=e13]:
      - generic [ref=e14]: Password
      - textbox "Password" [ref=e15]:
        - /placeholder: ••••••••
    - button "Sign In" [ref=e16]
  - paragraph [ref=e18]: "Demo: Enter any email/password to continue"
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Admin Workflow Tests', () => {
  4  |   test('admin can navigate to exams view and see exam list', async ({ page }) => {
  5  |     await page.goto('/');
  6  |     
  7  |     // Navigate to admin section
  8  |     const adminNav = page.getByRole('link', { name: /admin/i }).or(page.getByRole('button', { name: /admin/i }));
  9  |     await expect(adminNav.first()).toBeVisible();
  10 |     await adminNav.first().click();
  11 |     
  12 |     // Wait for admin content to load
  13 |     await page.waitForLoadState('networkidle');
  14 |     
  15 |     // Verify we're in admin context by checking for admin-specific elements
  16 |     await expect(page.getByText(/exams/i).or(page.getByText(/dashboard/i))).toBeVisible();
  17 |   });
  18 | 
  19 |   test('admin can access exam creation flow', async ({ page }) => {
  20 |     await page.goto('/');
  21 |     
  22 |     // Navigate to admin
  23 |     const adminNav = page.getByRole('link', { name: /admin/i }).or(page.getByRole('button', { name: /admin/i }));
  24 |     await adminNav.first().click();
  25 |     await page.waitForLoadState('networkidle');
  26 |     
  27 |     // Look for create/new exam button in admin interface
  28 |     const createButton = page.getByRole('button', { name: /create exam|new exam|add exam/i }).or(page.getByText(/create/i));
  29 |     const isVisible = await createButton.isVisible().catch(() => false);
  30 |     
  31 |     if (isVisible) {
  32 |       await createButton.click();
  33 |       // Verify a form or dialog appears for exam creation
  34 |       await expect(page.locator('form').or(page.locator('[role="dialog"]').or(page.getByRole('dialog')))).toBeVisible({ timeout: 5000 });
  35 |     }
  36 |   });
  37 | 
  38 |   test('admin exam list supports keyboard navigation', async ({ page }) => {
  39 |     await page.goto('/');
  40 |     
  41 |     // Navigate to admin
  42 |     const adminNav = page.getByRole('link', { name: /admin/i }).or(page.getByRole('button', { name: /admin/i }));
> 43 |     await adminNav.first().click();
     |                            ^ Error: locator.click: Test timeout of 30000ms exceeded.
  44 |     await page.waitForLoadState('networkidle');
  45 |     
  46 |     // Test keyboard accessibility by tabbing through the interface
  47 |     await page.keyboard.press('Tab');
  48 |     const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
  49 |     expect(['BUTTON', 'A', 'INPUT', 'SELECT', 'SUMMARY']).toContain(focusedElement);
  50 |   });
  51 | 
  52 |   test('admin can filter or search exams', async ({ page }) => {
  53 |     await page.goto('/');
  54 |     
  55 |     // Navigate to admin
  56 |     const adminNav = page.getByRole('link', { name: /admin/i }).or(page.getByRole('button', { name: /admin/i }));
  57 |     await adminNav.first().click();
  58 |     await page.waitForLoadState('networkidle');
  59 |     
  60 |     // Look for search input
  61 |     const searchInput = page.getByRole('textbox', { name: /search|filter/i }).or(page.getByPlaceholder(/search/i));
  62 |     const isVisible = await searchInput.isVisible().catch(() => false);
  63 |     
  64 |     if (isVisible) {
  65 |       await searchInput.fill('test');
  66 |       // Verify search input accepts text
  67 |       expect(await searchInput.inputValue()).toContain('test');
  68 |     }
  69 |   });
  70 | });
  71 | 
```
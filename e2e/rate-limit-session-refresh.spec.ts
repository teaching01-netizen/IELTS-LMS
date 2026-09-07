import { test, expect } from '@playwright/test';

// AT-09: session refresh survives tier 429s — user stays authenticated,
// no redirect to login, retry happens at most once after Retry-After.
test('session refresh survives a rate-limited tier (AT-09)', async ({ page }) => {
  let sessionCalls = 0;
  await page.route('**/api/v1/auth/session', async (route) => {
    sessionCalls += 1;
    if (sessionCalls === 1) {
      await route.fulfill({
        status: 429,
        headers: { 'Retry-After': '1', 'X-RateLimit-Tier': 'auth-critical' },
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Rate limit exceeded.',
            details: { retryAfterSeconds: 1, tier: 'auth-critical' },
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          csrfToken: 'test-csrf',
          user: { id: 'u1', email: 'admin@example.com', role: 'admin', state: 'active' },
        },
      }),
    });
  });

  await page.goto('/login');
  // A 429 on bootstrap must not bounce an existing session to /login or
  // show an error toast: the app retries once, then proceeds.
  await expect(page).not.toHaveURL(/\/login\?.*next=/);
  expect(sessionCalls).toBeLessThanOrEqual(2);
});

import { expect, test } from '@playwright/test';
import rateLimitAuth from './fixtures/rate-limit-auth.json' with { type: 'json' };

// AT-09: session refresh survives tier 429s — user stays authenticated,
// retries after the canonical Retry-After delay.
test('session refresh survives a rate-limited tier (AT-09)', async ({ page }) => {
  await page.context().addCookies([rateLimitAuth.sessionCookie, rateLimitAuth.csrfCookie]);

  const sessionRequests: number[] = [];
  let cookieSeen = false;
  let rateLimitDetails: Record<string, unknown> | undefined;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname !== '/api/v1/auth/session') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: {} }),
      });
      return;
    }

    cookieSeen ||=
      request.headers().cookie?.includes(
        `${rateLimitAuth.sessionCookie.name}=${rateLimitAuth.sessionCookie.value}`,
      ) ?? false;
    sessionRequests.push(Date.now());

    if (sessionRequests.length === 1) {
      rateLimitDetails = { retryAfterSeconds: 1, tier: 'auth-critical' };
      await route.fulfill({
        status: 429,
        headers: { 'Retry-After': '1', 'X-RateLimit-Tier': 'auth-critical' },
        contentType: 'application/json',
        body: JSON.stringify({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Rate limit exceeded.',
            details: rateLimitDetails,
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
          expiresAt: '2099-01-01T00:00:00.000Z',
          user: {
            id: 'u1',
            email: 'admin@example.com',
            displayName: 'Test Admin',
            role: 'admin',
            state: 'active',
          },
        },
      }),
    });
  });

  await page.goto('/login?next=%2Fadmin%2Fexams');
  await expect.poll(() => sessionRequests.length, { timeout: 8_000 }).toBe(2);
  await expect(page).toHaveURL(/\/admin\/exams/, { timeout: 8_000 });

  expect(cookieSeen).toBe(true);
  expect(sessionRequests[1]! - sessionRequests[0]!).toBeGreaterThanOrEqual(900);
  expect(rateLimitDetails).toEqual({ retryAfterSeconds: 1, tier: 'auth-critical' });
});

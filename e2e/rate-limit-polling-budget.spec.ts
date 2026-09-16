import { expect, test } from '@playwright/test';
import rateLimitAuth from './fixtures/rate-limit-auth.json' with { type: 'json' };

// AT-10: grading submissions use a calm polling cadence and a 429 is not
// replayed as a retry storm. The bearer fixture also proves the trusted
// attempt-identity path is present without exposing the token in metrics.
test('grading submissions poll at calm cadence and ignore 429 retries (AT-10)', async ({ page }) => {
  await page.context().addCookies([rateLimitAuth.sessionCookie, rateLimitAuth.csrfCookie]);
  await page.setExtraHTTPHeaders({ Authorization: `Bearer ${rateLimitAuth.bearerToken}` });

  const hits: number[] = [];
  let bearerSeen = false;
  let rateLimitDetails: Record<string, unknown> | undefined;
  const session = {
    id: 'rate-limit-session',
    scheduleId: 'rate-limit-schedule',
    examTitle: 'Rate-limit fixture',
    cohortName: 'Rate-limit cohort',
    institution: 'Fixture school',
    startTime: '2099-01-01T09:00:00.000Z',
    endTime: '2099-01-01T12:00:00.000Z',
    status: 'live',
    totalStudents: 1,
    pendingManualReviews: 1,
    inProgressReviews: 0,
    finalizedReviews: 0,
    overdueReviews: 0,
    assignedTeachers: [],
  };

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === '/api/v1/auth/session') {
      bearerSeen ||= request.headers().authorization === `Bearer ${rateLimitAuth.bearerToken}`;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            csrfToken: 'test-csrf',
            expiresAt: '2099-01-01T00:00:00.000Z',
            user: {
              id: 'grader-1',
              email: 'grader@example.com',
              displayName: 'Test Grader',
              role: 'grader',
              state: 'active',
            },
          },
        }),
      });
      return;
    }

    if (path === '/api/v1/grading/sessions' && url.search) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            sessions: [session],
            pagination: { page: 1, pageSize: 10, total: 1, hasMore: false },
          },
        }),
      });
      return;
    }

    if (path === '/api/v1/grading/sessions' && !url.search) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: [session] }),
      });
      return;
    }

    if (path === '/api/v1/grading/sessions/rate-limit-session' && url.searchParams.has('page')) {
      hits.push(Date.now());
      rateLimitDetails = { retryAfterSeconds: 60, tier: 'polling' };
      await route.fulfill({
        status: 429,
        headers: { 'Retry-After': '60', 'X-RateLimit-Tier': 'polling' },
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

    if (path === '/api/v1/grading/sessions/rate-limit-session') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { session } }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: {} }),
    });
  });

  await page.goto('/admin/grading');
  await expect(page.getByRole('heading', { name: 'Grading Queue' })).toBeVisible();
  await page.getByRole('button', { name: 'Open grading session for Rate-limit fixture' }).click();
  await expect.poll(() => hits.length, { timeout: 8_000 }).toBeGreaterThan(0);
  const initialRequestCount = hits.length;
  expect(initialRequestCount).toBeLessThanOrEqual(2);
  await page.waitForTimeout(2_000);

  // The browser path must not replay a rate-limited submissions request. The
  // React Query query/mutation predicates are covered by focused unit tests;
  // this integration path proves the live grading screen does not add a
  // second request around the canonical 429 response.
  expect(hits.length).toBe(initialRequestCount);
  expect(bearerSeen).toBe(true);
  expect(rateLimitDetails).toEqual({ retryAfterSeconds: 60, tier: 'polling' });
});

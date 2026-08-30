import type { Browser, BrowserContext } from '@playwright/test';
import { ADMIN_STORAGE_STATE_PATH } from './backendE2e';
import { queryDb } from './db';

/**
 * Shared proctor-side control helpers for the backend-backed e2e journey
 * specs (E2E-01, E2E-02).
 *
 * The proctor drives the seeded schedule's runtime through the admin storage
 * state (the seed registers an admin user); every command POST requires the
 * CSRF cookie that the admin storage state carries. All URLs are relative —
 * the playwright baseURL routes them through the vite dev proxy to the
 * backend on :4000.
 */

/** Admin-storage-state context used to drive proctor runtime commands. */
export async function newAdminControlContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    storageState: process.env['ADMIN_STORAGE_STATE'] || ADMIN_STORAGE_STATE_PATH,
  });
}

export async function postProctorApi(
  adminContext: BrowserContext,
  url: string,
  data: Record<string, unknown>,
): Promise<{ status: number; body: string }> {
  const cookies = await adminContext.cookies();
  const csrfNames = [process.env['AUTH_CSRF_COOKIE_NAME'], '__Host-csrf', 'csrf'].filter(
    (value): value is string => Boolean(value),
  );
  const csrfToken = cookies.find((cookie) => csrfNames.includes(cookie.name))?.value;
  if (!csrfToken) {
    throw new Error('Admin E2E storage state is missing its CSRF cookie.');
  }
  const response = await adminContext.request.post(url, {
    headers: { 'x-csrf-token': csrfToken },
    data,
  });
  return { status: response.status(), body: await response.text() };
}

/** Authoritative runtime section key from the DB (used to resolve 409 races). */
async function currentRuntimeSection(scheduleId: string): Promise<string | null> {
  const rows = await queryDb<{ current_section_key: string | null }>(
    'SELECT current_section_key FROM exam_session_runtimes WHERE schedule_id = ?',
    [scheduleId],
  );
  return rows[0]?.current_section_key ?? null;
}

/**
 * "Proctor starts exam": start_runtime. The seeded runtime is already started
 * by global-setup's seed, so an "already started" 409 is tolerated (the
 * runtime command is idempotent by design).
 */
export async function proctorStartExam(adminContext: BrowserContext, scheduleId: string) {
  const { status, body } = await postProctorApi(
    adminContext,
    `/api/v1/schedules/${scheduleId}/runtime/commands`,
    {
      action: 'start_runtime',
      reason: 'e2e proctor starts exam',
    },
  );
  if (status !== 200 && status !== 409) {
    throw new Error(`start_runtime failed: ${status} ${body.slice(0, 300)}`);
  }
}

/**
 * "Proctor advances": end the active section now. The next section goes live
 * in the same transaction; ending the last section completes the runtime and
 * auto-submits the attempt (backend, in-transaction). A 409 means the runtime
 * advanced concurrently — refresh the authoritative section key from the DB
 * and retry once.
 */
export async function proctorEndSection(
  adminContext: BrowserContext,
  scheduleId: string,
  expectedActiveSectionKey: string,
  description: string,
) {
  const url = `/api/v1/proctor/sessions/${scheduleId}/control/end-section-now`;
  let { status, body } = await postProctorApi(adminContext, url, {
    reason: `e2e ${description}`,
    expectedActiveSectionKey,
  });
  if (status === 409) {
    const current = await currentRuntimeSection(scheduleId);
    if (current === null || current === expectedActiveSectionKey) {
      throw new Error(`end-section-now conflict without section change: ${body.slice(0, 300)}`);
    }
    ({ status, body } = await postProctorApi(adminContext, url, {
      reason: `e2e ${description}`,
      expectedActiveSectionKey: current,
    }));
  }
  if (status !== 200) {
    throw new Error(`end-section-now(${description}) failed: ${status} ${body.slice(0, 300)}`);
  }
}

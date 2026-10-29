import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { closeDb, executeUpdate, queryDb } from "./support/db";

/**
 * Persistent staff login (docs/plans/2026-10-29-persistent-login-low-level.md).
 * Uses a real on-disk browser profile closed and relaunched — not a
 * storageState shortcut — so cookie persistence is the browser's own. The
 * database row stays the authority: revocation, idle expiry and stale password
 * confirmation are all enforced server-side on the next request.
 *
 * Requires the API to run with PERSISTENT_LOGIN_ENABLED=true (playwright.config.ts).
 */

const BUILDER_EMAIL = "e2e.builder@example.com";
const BUILDER_PASSWORD = "Password123!";
const SESSION_COOKIE = process.env["SESSION_COOKIE_NAME"] ?? "session";
const CSRF_COOKIE = process.env["CSRF_COOKIE_NAME"] ?? "csrf";

interface SessionRow {
  id: string;
  remembered: number;
  idle_window_seconds: number | null;
  credential_authenticated_at: string | null;
  revoked_at: string | null;
}

function tokenHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function launchProfile(
  browser: Browser,
  userDataDir: string,
  baseURL: string
): Promise<BrowserContext> {
  return browser.browserType().launchPersistentContext(userDataDir, { baseURL });
}

async function signIn(context: BrowserContext, remember: boolean): Promise<void> {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("/login");
  await page.getByLabel("Email Address").fill(BUILDER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(BUILDER_PASSWORD);
  const keep = page.getByLabel("Keep me signed in on this device");
  await expect(keep).toBeChecked();
  if (!remember) await keep.uncheck();
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/admin\/exams/);
}

async function sessionCookie(context: BrowserContext) {
  const cookie = (await context.cookies()).find((entry) => entry.name === SESSION_COOKIE);
  expect(cookie, "session cookie").toBeDefined();
  return cookie!;
}

async function sessionRow(context: BrowserContext): Promise<SessionRow> {
  const cookie = await sessionCookie(context);
  const rows = await queryDb<SessionRow>(
    `SELECT id, remembered, idle_window_seconds, credential_authenticated_at, revoked_at
       FROM user_sessions WHERE session_token_hash = ?`,
    [tokenHash(cookie.value)]
  );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

async function expectWorkspace(context: BrowserContext): Promise<void> {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("/admin/exams");
  // The admin shell's exit control only renders after the session restored;
  // waiting on it avoids passing before RequireAuth's redirect has happened.
  await expect(page.getByRole("button", { name: /^Exit( Admin)?$/ })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/exams/);
}

async function expectLogin(context: BrowserContext): Promise<void> {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("/admin/exams");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
}

test.describe("persistent staff login", () => {
  test.afterAll(closeDb);
  // Profiles contain live cookies. Retain assertions/traces, never credentials
  // or hundreds of megabytes of browser cache in test artifacts.
  test.afterEach(async ({ browserName: _browserName }, testInfo) => {
    await rm(testInfo.outputPath('profile'), { recursive: true, force: true });
  });
  // Each test owns its own on-disk profile; the shared storageState is unused.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("offline logout hides both tabs and completes before restoration after browser restart", async ({ browser, baseURL }, testInfo) => {
    const profile = testInfo.outputPath("profile");
    let context = await launchProfile(browser, profile, baseURL!);
    try {
      await signIn(context, true);
      const row = await sessionRow(context);
      const first = context.pages()[0]!;
      const second = await context.newPage();
      await second.goto('/admin/exams');
      const exit = (page: typeof first) => page.getByRole('button', { name: /^Exit( Admin)?$/ });
      await expect(exit(second)).toBeVisible();
      await context.setOffline(true);
      await exit(first).click();
      await expect(exit(first)).not.toBeVisible();
      await expect(exit(second)).not.toBeVisible();
      await expect.poll(() => first.evaluate(() => localStorage.getItem('ielts-auth:logout-intent:v1'))).not.toBeNull();
      await context.close();
      context = await launchProfile(browser, profile, baseURL!);
      await expectLogin(context);
      await expect.poll(async () => (await queryDb<SessionRow>('SELECT revoked_at FROM user_sessions WHERE id = ?', [row.id]))[0]?.revoked_at).not.toBeNull();
      const page = context.pages()[0]!;
      expect(await page.evaluate(() => localStorage.getItem('ielts-auth:logout-intent:v1'))).toBeNull();
    } finally {
      await context.close();
    }
  });

  test("a remembered sign-in survives a real browser restart until the server revokes it", async ({
    browser,
    baseURL,
  }, testInfo) => {
    const profile = testInfo.outputPath("profile");
    let context = await launchProfile(browser, profile, baseURL!);
    try {
      await signIn(context, true);
      const cookie = await sessionCookie(context);
      // Persistent cookie bounded by the absolute lifetime, not a session cookie.
      expect(cookie.expires).toBeGreaterThan(Date.now() / 1000 + 6 * 24 * 3600);
      expect(cookie.httpOnly).toBe(true);
      const csrf = (await context.cookies()).find((entry) => entry.name === CSRF_COOKIE);
      expect(csrf?.httpOnly).toBe(false);
      const row = await sessionRow(context);
      expect(row.remembered).toBe(1);
      expect(row.idle_window_seconds).toBeGreaterThan(0);
      expect(row.credential_authenticated_at).not.toBeNull();

      await context.close();
      context = await launchProfile(browser, profile, baseURL!);
      await expectWorkspace(context);

      // Revocation in the database defeats the persistent cookie at once.
      await executeUpdate(
        "UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP, revocation_reason = 'e2e_revoked' WHERE id = ?",
        [row.id]
      );
      await expectLogin(context);
    } finally {
      await context.close();
    }
  });

  test("an unremembered sign-in ends with the browser session", async ({ browser, baseURL }, testInfo) => {
    const profile = testInfo.outputPath("profile");
    let context = await launchProfile(browser, profile, baseURL!);
    try {
      await signIn(context, false);
      const cookie = await sessionCookie(context);
      expect(cookie.expires).toBe(-1);
      expect((await sessionRow(context)).remembered).toBe(0);

      await context.close();
      context = await launchProfile(browser, profile, baseURL!);
      await expectLogin(context);
    } finally {
      await context.close();
    }
  });

  test("idle expiry is enforced by the server even while the cookie is still valid", async ({
    browser,
    baseURL,
  }, testInfo) => {
    const context = await launchProfile(browser, testInfo.outputPath("profile"), baseURL!);
    try {
      await signIn(context, true);
      const row = await sessionRow(context);
      await executeUpdate(
        "UPDATE user_sessions SET idle_timeout_at = TIMESTAMPADD(SECOND, -5, CURRENT_TIMESTAMP) WHERE id = ?",
        [row.id]
      );
      await expectLogin(context);
      // The expired row was not extended by the rejected lookup.
      const after = await queryDb<{ expired: number }>(
        "SELECT idle_timeout_at <= CURRENT_TIMESTAMP AS expired FROM user_sessions WHERE id = ?",
        [row.id]
      );
      expect(Number(after[0]?.expired)).toBe(1);
    } finally {
      await context.close();
    }
  });
});

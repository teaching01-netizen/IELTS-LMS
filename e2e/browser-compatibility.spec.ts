import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readBackendE2EManifest } from "./support/backendE2e";
import {
  completePreCheckIfPresent,
  deterministicWcode,
  openStudentSessionWithRetry,
  startLobbyIfPresent,
  studentCheckIn,
  stubScreenDetails,
} from "./support/studentUi";

async function openRuntimeBackedExam(
  browser: Browser,
  testInfo: { project: { name: string }; title: string }
): Promise<{ context: BrowserContext; page: Page }> {
  const manifest = readBackendE2EManifest();
  const wcode = deterministicWcode(`${testInfo.project.name}:${testInfo.title}`);
  const context = await browser.newContext();
  await stubScreenDetails(context);
  const page = await context.newPage();

  await studentCheckIn(page, manifest.student.scheduleId, {
    wcode,
    email: `e2e+${wcode.toLowerCase()}@example.com`,
    fullName: `E2E Candidate ${wcode}`,
  });
  await openStudentSessionWithRetry(page, manifest.student.scheduleId, wcode);
  await completePreCheckIfPresent(page);
  await startLobbyIfPresent(page);

  return { context, page };
}

async function openRegistration(page: Page) {
  const { studentSelfPaced } = readBackendE2EManifest();
  await page.goto(`/student/${studentSelfPaced.scheduleId}/register`);
  await expect(page.getByRole("heading", { name: "Exam Check-in" })).toBeVisible();
}

test.describe("Browser compatibility", () => {
  test.describe.configure({ timeout: 180_000 });

  test("runtime-backed student controls work in the active browser", async ({
    browser,
  }, testInfo) => {
    const { context, page } = await openRuntimeBackedExam(browser, testInfo);
    try {
      const answer = page.getByLabel("Answer for question 1");
      await expect(answer).toBeVisible({ timeout: 30_000 });
      await answer.fill("browser compatibility answer");
      await expect(answer).toHaveValue("browser compatibility answer");
    } finally {
      await context.close();
    }
  });

  test("student check-in remains usable on narrow and tablet viewports", async ({ page }) => {
    const viewports = [
      { width: 375, height: 667 },
      { width: 768, height: 1024 },
    ];

    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await openRegistration(page);
      await expect(page.getByLabel("Access code")).toBeVisible();
      await expect(page.getByLabel("Email")).toBeVisible();
      await expect(page.getByLabel("Full Name")).toBeVisible();
      await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
    }
  });

  test("student check-in exposes keyboard and screen-reader labels", async ({ page }) => {
    await openRegistration(page);

    const wcode = page.getByLabel("Access code");
    await wcode.focus();
    await expect(wcode).toBeFocused();
    await expect(page.getByLabel("Nickname")).toHaveAttribute("aria-label", "Nickname");
    await expect(page.getByLabel("IELTS Course")).toHaveAttribute("aria-label", "IELTS Course");
  });

  test("OS dark preference does not switch the active UI away from light mode", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await openRegistration(page);

    const preferences = await page.evaluate(() => ({
      dark: window.matchMedia("(prefers-color-scheme: dark)").matches,
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      devicePixelRatio: window.devicePixelRatio,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
    }));

    expect(preferences.dark).toBe(true);
    expect(preferences.reducedMotion).toBe(true);
    expect(preferences.devicePixelRatio).toBeGreaterThan(0);
    expect(preferences.colorScheme).toBe("light");
  });

  test("required browser primitives are available before check-in", async ({ page }) => {
    await page.goto("/login");
    const features = await page.evaluate(() => ({
      fetch: typeof fetch === "function",
      localStorage: typeof localStorage !== "undefined",
      sessionStorage: typeof sessionStorage !== "undefined",
      webSocket: typeof WebSocket === "function",
      webWorkers: typeof Worker === "function",
    }));

    expect(features).toEqual({
      fetch: true,
      localStorage: true,
      sessionStorage: true,
      webSocket: true,
      webWorkers: true,
    });
  });

  test("browser storage and cookies survive a page reload", async ({ page }) => {
    await page.goto("/login");
    await page.evaluate(() => {
      localStorage.setItem("browser-compatibility-local", "local-value");
      sessionStorage.setItem("browser-compatibility-session", "session-value");
    });
    await page.context().addCookies([
      {
        name: "browser-compatibility-cookie",
        value: "cookie-value",
        domain: "localhost",
        path: "/",
      },
    ]);

    await page.reload();

    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("browser-compatibility-local")))
      .toBe("local-value");
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem("browser-compatibility-session")))
      .toBe("session-value");
    expect(
      (await page.context().cookies()).find(
        (cookie) => cookie.name === "browser-compatibility-cookie"
      )?.value
    ).toBe("cookie-value");

    await page.evaluate(() => {
      localStorage.removeItem("browser-compatibility-local");
      sessionStorage.removeItem("browser-compatibility-session");
    });
  });
});

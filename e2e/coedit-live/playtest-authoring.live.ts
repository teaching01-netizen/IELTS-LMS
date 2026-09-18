/**
 * TEMPORARY playtest walk (delete when the pass is over).
 *
 * The default suite cannot answer the question this asks, because playwright's
 * default config starts no co-edit service and injects a placeholder public URL,
 * so the room never opens. This probe runs under the live config, where the Go
 * API, the Hocuspocus service and Vite are all real, and drives the SAT
 * workspace the way a first user would: create a question, write, reload
 * mid-write, and click the create button carelessly.
 */
import fs from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { LIVE } from "../../playwright.coedit-live.config";
import { BUILDER_STORAGE_STATE_PATH } from "../support/backendE2e";

const WEB = LIVE.WEB;
const LOG = "/tmp/playtest-authoring.txt";
test.use({ storageState: BUILDER_STORAGE_STATE_PATH });

function log(label: string, body: unknown) {
  const text = typeof body === "string" ? body : JSON.stringify(body, null, 1);
  fs.appendFileSync(LOG, `\n===== ${label} =====\n${text}\n`);
}

async function csrf(ctx: BrowserContext): Promise<string> {
  const response = await ctx.request.get(`${WEB}/api/v1/auth/session`);
  const body = (await response.json()) as { csrfToken?: string };
  return body.csrfToken ?? "";
}

async function createExam(ctx: BrowserContext): Promise<string> {
  const token = await csrf(ctx);
  const created = await ctx.request.post(`${WEB}/api/v1/exams`, {
    headers: { "x-csrf-token": token },
    data: {
      slug: `playtest-${Date.now()}`,
      title: `Playtest ${Date.now()}`,
      examType: "Academic",
      visibility: "organization",
      providerKey: "sat",
      providerExamType: "SAT",
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const examId = ((await created.json()) as { id: string }).id;
  await ctx.request.post(`${WEB}/api/v1/assessment-authoring/exams/${examId}/shell`, {
    headers: { "x-csrf-token": token },
    data: {},
  });
  return examId;
}

function watch(page: Page, sink: string[]) {
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") sink.push(`${m.type()}: ${m.text()}`.slice(0, 300));
  });
  page.on("pageerror", (e) => sink.push(`pageerror: ${e.message}`.slice(0, 300)));
}

async function bodyText(page: Page): Promise<string> {
  return (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
}

test("walk: fresh SAT exam, create and write a question as its first user", async ({ browser }) => {
  fs.writeFileSync(LOG, "SAT authoring playtest (live stack)");
  const ctx = await browser.newContext({ storageState: BUILDER_STORAGE_STATE_PATH });
  const page = await ctx.newPage();
  const console: string[] = [];
  const writes: string[] = [];
  const failures: string[] = [];
  watch(page, console);
  page.on("request", (r) => {
    if (r.method() !== "GET") writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && r.request().method() !== "OPTIONS") {
      failures.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
    }
  });

  // The service is the promise of this configuration; prove it is up before
  // blaming the product for anything that follows.
  const service = await (await fetch(`${LIVE.COEDIT}/readyz`)).json().catch(() => null);
  log("0. coedit service /readyz", service);

  const examId = await createExam(ctx);
  await page.goto(`${WEB}/sat/exams/${examId}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(4_000);
  log("1. fresh exam", { url: page.url(), text: (await bodyText(page)).slice(0, 900) });

  // ---- The user's first move: create a question ----------------------------
  const createNext = page.getByRole("button", { name: /create next question/i }).first();
  const addFirst = page.getByRole("button", { name: /^add question$/i }).first();
  const target = (await createNext.isVisible().catch(() => false)) ? createNext : addFirst;
  writes.length = 0;
  await target.click().catch((e) => log("2. click threw", String(e)));
  await page.waitForTimeout(5_000);
  log("2. after first create", {
    writes: writes.join(" | ") || "(none)",
    text: (await bodyText(page)).slice(0, 900),
    editorVisible: await page
      .getByRole("textbox", { name: "Question prompt" })
      .isVisible()
      .catch(() => false),
  });

  // ---- Type, then reload immediately (mid-write) ---------------------------
  const prompt = page.getByRole("textbox", { name: "Question prompt" });
  const editable = await prompt.isVisible().catch(() => false);
  log("3. prompt editor", { editable });
  if (editable) {
    const stamp = `PLAYTEST-${Date.now()}`;
    await prompt.click();
    await page.keyboard.type(` ${stamp}`, { delay: 10 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await prompt.waitFor({ timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(5_000);
    const after = await bodyText(page);
    log("4. reload mid-write", { stamp, survived: after.includes(stamp), text: after.slice(0, 700) });

    // ---- Careless: click create twice, fast ---------------------------------
    const before = (await bodyText(page)).match(/(\d+) of \d+ authored/)?.[1] ?? "?";
    writes.length = 0;
    const again = page.getByRole("button", { name: /create next question|add question/i }).first();
    await Promise.all([
      again.click().catch(() => undefined),
      again.click({ force: true, timeout: 2_000 }).catch(() => undefined),
    ]);
    await page.waitForTimeout(6_000);
    const afterText = await bodyText(page);
    log("5. double-click create", {
      writes: writes.join(" | ") || "(none)",
      authoredBefore: before,
      authoredAfter: afterText.match(/(\d+) of \d+ authored/)?.[1] ?? "?",
      notices: afterText.match(/(Offline|offline|reconnect|refused|being confirmed)[^.]*\./g) ?? [],
    });

    // ---- Leave mid-write: Preview, then back ---------------------------------
    writes.length = 0;
    await page.getByRole("link", { name: /preview/i }).first().click().catch(() => undefined);
    await page.waitForTimeout(3_000);
    const left = page.url();
    await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.waitForTimeout(4_000);
    log("6. preview and back", {
      leftUrl: left,
      backUrl: page.url(),
      stillHasEditor: await prompt.isVisible().catch(() => false),
      text: (await bodyText(page)).slice(0, 500),
    });
  }

  log("7. console (errors/warnings)", [...new Set(console)].join("\n").slice(0, 1500) || "(none)");
  log("8. http >= 400", [...new Set(failures)].join("\n").slice(0, 900) || "(none)");
  await ctx.close();
});

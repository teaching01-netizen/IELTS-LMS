import { test, type Page } from "@playwright/test";
import fs from "node:fs";
import { BUILDER_STORAGE_STATE_PATH } from "./support/backendE2e";

/**
 * TEMPORARY playtest walk (delete when the pass is over).
 *
 * Continues from a created SAT exam at /sat/exams/<id>: find how a draft is
 * opened on a fresh exam, create a question, write in it, reload mid-write.
 */

test.use({ storageState: BUILDER_STORAGE_STATE_PATH });

const LOG = "/tmp/playtest-sat-walk.txt";

function log(label: string, body: string) {
  fs.appendFileSync(LOG, `\n===== ${label} =====\n${body}\n`);
}

async function state(page: Page, label: string) {
  const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
  log(label, `url=${page.url()}\nTEXT: ${text.slice(0, 1400)}`);
  return text;
}

async function openMenuItems(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("button, [role=menuitem], a"))
      .map((node) => (node.textContent ?? "").trim())
      .filter((label) => label.length > 0 && label.length < 60)
  );
}

test("walk: draft on a fresh SAT exam, author, reload", async ({ page }) => {
  fs.writeFileSync(LOG, "SAT playtest walk (round 3)");
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const badResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 250));
  });
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 250)));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      badResponses.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
    }
  });

  // This box has no internet, so Chromium reports navigator.onLine === false
  // even though the API on 127.0.0.1 is reachable. Force the online posture so
  // the walk exercises the product rather than the sandbox's network.
  await page.context().setOffline(false);

  // Fresh SAT exam through the SAT library.
  await page.goto("/sat/exams");
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /create sat/i }).first().click();
  await page.waitForTimeout(1000);
  const title = `Playtest SAT ${Date.now()}`;
  await page.locator("input[type=text], input:not([type])").first().fill(title);
  await page.getByRole("button", { name: /^create$/i }).last().click();
  await page.waitForTimeout(5000);

  const examId = /\/sat\/exams\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? null;
  log("created", `title=${title} id=${examId} url=${page.url()}`);
  const workspace = examId ? `/sat/exams/${examId}` : "/sat/exams";

  log("A0. browser posture", `navigator.onLine=${await page.evaluate(() => navigator.onLine)}`);
  await state(page, "A. fresh exam, no questions");

  // Where would a builder look first? The actions menu and the first slot.
  log("A1. online check", `onLine=${await page.evaluate(() => navigator.onLine)} banner=${(await page.locator("body").innerText()).includes("Offline")}`);
  const menu = page.getByRole("button", { name: /more authoring actions/i }).first();
  if (await menu.isVisible().catch(() => false)) {
    await menu.click().catch(() => undefined);
    await page.waitForTimeout(800);
    log("B. actions menu", (await openMenuItems(page)).join(" | ").slice(0, 1200));
    await page.keyboard.press("Escape");
  }

  const addFirst = page.getByRole("button", { name: /^add question$/i }).first();
  const createNext = page.getByRole("button", { name: /create next question/i }).first();
  log(
    "C. affordances",
    `addQuestion=${await addFirst.isVisible().catch(() => false)} createNextQuestion=${await createNext.isVisible().catch(() => false)}`
  );

  const target = (await createNext.isVisible().catch(() => false)) ? createNext : addFirst;
  const requests: string[] = [];
  const onRequest = (request: { method: () => string; url: () => string }) => {
    if (request.method() !== "GET") requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
  };
  page.on("request", onRequest as never);
  await target.click().catch(() => undefined);
  await page.waitForTimeout(4000);
  page.off("request", onRequest as never);
  log("D0. writes attempted by the create action", requests.join(" | ") || "(none)");
  await state(page, "D. after first question action");

  // The editor, if one appeared.
  const editable = page.locator('[contenteditable="true"]').first();
  const canType = await editable.isVisible().catch(() => false);
  log("E. editor", `contenteditable=${canType}`);
  if (canType) {
    const stamp = `playtest-${Date.now()}`;
    await editable.click();
    await page.keyboard.press("End");
    await page.keyboard.type(` ${stamp}`);
    await page.waitForTimeout(1000);
    await state(page, "F. after typing");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(4000);
    const after = await state(page, "G. after reload");
    log("H. durability", `typed text survived reload=${after.includes(stamp)}`);
  }

  log("Z. console errors", [...new Set(consoleErrors)].join("\n").slice(0, 1500) || "(none)");
  log("Z. page errors", [...new Set(pageErrors)].join("\n").slice(0, 800) || "(none)");
  log("Z. http>=400", [...new Set(badResponses)].join("\n").slice(0, 1200) || "(none)");
});

/**
 * LIVE SAT workspace co-editing: two independent browser clients, the real Go
 * API, the real Hocuspocus service and real MySQL.
 *
 * Nothing here is mocked. Every assertion below is made against processes
 * `playwright.coedit-live.config.ts` started: the Go API built from this working
 * tree, the singleton co-edit service, and a vite dev server whose SAT
 * workspace collaboration is enabled by product default. Staff sessions come
 * from the repository's e2e seed
 * (`e2e/global-setup.ts`). Where a claim cannot be made from the live surface,
 * the test says so instead of asserting it.
 */
import { createHash, createHmac } from "node:crypto";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { LIVE } from "../../playwright.coedit-live.config";
import { ADMIN_STORAGE_STATE_PATH, BUILDER_STORAGE_STATE_PATH } from "../support/backendE2e";

const ROOT = LIVE.ROOT;
const API = LIVE.API;
const WEB = LIVE.WEB;
const COEDIT = LIVE.COEDIT;
const BUILDER_STATE = BUILDER_STORAGE_STATE_PATH;
const ADMIN_STATE = ADMIN_STORAGE_STATE_PATH;
const SERVICE_SECRET = LIVE.SERVICE_SECRET;
const SCRATCH = process.env.COEDIT_LIVE_SCRATCH ?? path.join(os.tmpdir(), "coedit-live");
// The pool follows the same DSN the API and the seed used, so the assertions
// below cannot read a different database than the one under test.
const DATABASE = new URL(LIVE.DATABASE_URL);
const DB = DATABASE.pathname.replace(/^\//, "");

const require_ = createRequire(`${ROOT}/package.json`);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mysql = require_("mysql2/promise") as typeof import("mysql2/promise");

let pool: import("mysql2/promise").Pool;
const evidence: Record<string, unknown> = {};

function record(key: string, value: unknown): void {
  evidence[key] = value;
  // eslint-disable-next-line no-console
  console.log(`### ${key} ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

async function db<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

/** Private control call, signed exactly as the Go API signs it. */
async function control(path: string, payload: Record<string, unknown>): Promise<unknown> {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const mac = createHmac("sha256", SERVICE_SECRET);
  mac.update("authoring-coedit-service.v1\n");
  mac.update("POST\n");
  mac.update(path);
  mac.update("\n");
  mac.update(timestamp);
  mac.update("\n");
  mac.update(createHash("sha256").update(body).digest("hex"));
  const response = await fetch(`${COEDIT}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-coedit-timestamp": timestamp,
      "x-coedit-signature": mac.digest("base64url"),
    },
    body,
  });
  const text = await response.text();
  return { status: response.status, body: text };
}

async function csrf(ctx: BrowserContext): Promise<string> {
  const response = await ctx.request.get(`${WEB}/api/v1/auth/session`);
  const body = (await response.json()) as { csrfToken?: string };
  if (!body.csrfToken) throw new Error("no csrf token");
  return body.csrfToken;
}

interface Shell {
  examId: string;
  versionId: string;
  sections: {
    id: string;
    modules: {
      id: string;
      questions?: { examQuestionId: string; questionRevisionId: string }[];
    }[];
  }[];
}

async function createExam(ctx: BrowserContext): Promise<{ examId: string; moduleId: string }> {
  const token = await csrf(ctx);
  const created = await ctx.request.post(`${WEB}/api/v1/exams`, {
    headers: { "x-csrf-token": token },
    data: {
      slug: `coedit-live-${Date.now()}`,
      title: "Co-edit live check",
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
  const shellResponse = await ctx.request.get(
    `${WEB}/api/v1/assessment-authoring/exams/${examId}/shell`,
  );
  const body = (await shellResponse.json()) as { data?: Shell } & Partial<Shell>;
  const shell = (body.data ?? body) as Shell;
  return { examId, moduleId: shell.sections[0]!.modules[0]!.id };
}

async function readShell(ctx: BrowserContext, examId: string): Promise<Shell> {
  const response = await ctx.request.get(`${WEB}/api/v1/assessment-authoring/exams/${examId}/shell`);
  const body = (await response.json()) as { data?: Shell } & Partial<Shell>;
  return (body.data ?? body) as Shell;
}

const PROMPT = { role: "textbox", name: "Question prompt" } as const;

async function openWorkspace(ctx: BrowserContext, examId: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`${WEB}/builder/${examId}`);
  // The prompt composer only becomes an editable textbox once the provider
  // reports initial sync — so its appearance IS proof the client connected to
  // the real service over its own WebSocket.
  await page.getByRole(PROMPT.role, { name: PROMPT.name }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: "Question 1", exact: false }).first().click().catch(() => undefined);
  return page;
}

async function promptOf(page: Page): Promise<string> {
  return page.getByRole(PROMPT.role, { name: PROMPT.name }).evaluate((node) => {
    // CollaborationCaret renders its visible name inside the contenteditable.
    // It is UI chrome, not document content, so remove it before asserting
    // convergence.
    const copy = node.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("[data-coedit-caret]").forEach((caret) => caret.remove());
    return copy.innerText.trim();
  });
}

async function typeInto(page: Page, text: string): Promise<void> {
  const editor = page.getByRole(PROMPT.role, { name: PROMPT.name });
  await editor.click();
  await page.keyboard.type(text, { delay: 15 });
}

const consoleLines: { a: string[]; b: string[] } = { a: [], b: [] };

function watch(page: Page, sink: string[]): void {
  page.on("console", (message) => sink.push(`${message.type()}: ${message.text()}`.slice(0, 300)));
  page.on("pageerror", (error) => sink.push(`pageerror: ${error.message}`.slice(0, 300)));
}

test.beforeAll(async () => {
  pool = mysql.createPool({
    host: DATABASE.hostname,
    port: Number(DATABASE.port || 3306),
    user: decodeURIComponent(DATABASE.username),
    password: decodeURIComponent(DATABASE.password),
    database: DB,
    connectionLimit: 4,
  });
});

test.afterAll(async () => {
  await pool?.end();
  // eslint-disable-next-line no-console
  console.log(`\n=== EVIDENCE ===\n${JSON.stringify(evidence, null, 1)}`);
});

test("two live clients, one prompt, real service and database", async ({ browser }) => {
  const builderCtx = await browser.newContext({ storageState: BUILDER_STATE });
  const adminCtx = await browser.newContext({ storageState: ADMIN_STATE });

  // ---- 0. The stack is really up -------------------------------------------
  const health = await (await fetch(`${COEDIT}/healthz`)).json();
  const ready = await (await fetch(`${COEDIT}/readyz`)).json();
  record("service /healthz", health);
  record("service /readyz", ready);
  expect(health).toMatchObject({ ok: true });
  expect(ready).toMatchObject({ ready: true });

  // ---- 1. Real exam, draft shell and question through the real API ---------
  const { examId, moduleId } = await createExam(builderCtx);
  const token = await csrf(builderCtx);
  const questionResponse = await builderCtx.request.post(
    `${WEB}/api/v1/assessment-authoring/modules/${moduleId}/questions`,
    { headers: { "x-csrf-token": token }, data: {} },
  );
  expect(questionResponse.status(), await questionResponse.text()).toBeLessThan(300);
  const shell = await readShell(builderCtx, examId);
  const question = shell.sections[0]!.modules[0]!.questions![0]!;
  record("exam", { examId, moduleId, ...question });

  // ---- 2. Both actors mint the same exam-level room ------------------------
  const tokens: Record<string, { documentName: string; serviceUrl: string }> = {};
  for (const [who, ctx] of [
    ["builder", builderCtx],
    ["admin", adminCtx],
  ] as const) {
    const ownToken = await csrf(ctx);
    const minted = await ctx.request.post(
      `${WEB}/api/v1/assessment-authoring/exams/${examId}/coedit-token`,
      { headers: { "x-csrf-token": ownToken }, data: {} },
    );
    const body = (await minted.json()) as {
      documentName: string;
      serviceUrl: string;
      mode: string;
      token: string;
    };
    record(`coedit-token as ${who}`, { status: minted.status(), ...body, token: `${body.token.slice(0, 24)}…` });
    expect(minted.status()).toBe(200);
    expect(body.mode).toBe("write");
    expect(body.serviceUrl).toBe(`ws://127.0.0.1:1235`);
    expect(body.documentName).toMatch(/^coedit:v2:/);
    tokens[who] = body;
  }

  const rowAfterToken = await db(
    "select id, exam_id, draft_version_id, field_set, lifecycle_state, materialized_revision from authoring_coedit_workspaces where exam_id = ?",
    [examId],
  );
  record("workspace row after token (real MySQL)", rowAfterToken);
  expect(rowAfterToken).toHaveLength(1);
  expect(rowAfterToken[0]!.field_set).toBe("workspace");
  expect(tokens.builder?.documentName).toBe(tokens.admin?.documentName);

  // ---- 3. Two independent browsers open the same prompt -------------------
  const pageA = await openWorkspace(builderCtx, examId);
  watch(pageA, consoleLines.a);
  const pageB = await openWorkspace(adminCtx, examId);
  watch(pageB, consoleLines.b);
  record("A url", pageA.url());
  record("B url", pageB.url());
  await expect(pageA.getByRole(PROMPT.role, { name: PROMPT.name })).toBeVisible();
  await expect(pageB.getByRole(PROMPT.role, { name: PROMPT.name })).toBeVisible();
  record("editors mounted", { a: (await promptOf(pageA)).slice(0, 40), b: (await promptOf(pageB)).slice(0, 40) });

  // ---- 4. A types; B sees it with no reload ------------------------------
  await typeInto(pageA, "TYPOGRAPHED-BY-A");
  await pageA.waitForTimeout(1_500);
  record("A after typing (own echo)", await promptOf(pageA));
  record("service metrics (after A typing)", await (await fetch(`${COEDIT}/metrics`)).text());
  record("page A console", consoleLines.a.slice(-12));
  record("page B console", consoleLines.b.slice(-12));
  await expect
    .poll(() => promptOf(pageB), { timeout: 30_000, message: "B never received A's edit" })
    .toContain("TYPOGRAPHED-BY-A");
  // Awareness is separate from document persistence: B should also receive
  // A's live caret without a page reload.
  await expect(pageB.locator("[data-coedit-caret]")).toHaveCount(1, { timeout: 30_000 });
  record("A -> B propagated", { a: await promptOf(pageA), b: await promptOf(pageB) });

  // ---- 5. Concurrent edits from both sides converge ----------------------
  await typeInto(pageA, "-ALPHA");
  await typeInto(pageB, "-BRAVO");
  await expect
    .poll(async () => [await promptOf(pageA), await promptOf(pageB)].join("|"), {
      timeout: 30_000,
      message: "the two clients did not converge",
    })
    .toMatch(/^([^|]*)\|\1$/);
  const converged = await promptOf(pageA);
  record("converged after concurrent edits", {
    a: await promptOf(pageA),
    b: await promptOf(pageB),
    equal: (await promptOf(pageA)) === (await promptOf(pageB)),
  });
  expect(converged).toContain("-ALPHA");
  expect(converged).toContain("-BRAVO");

  // ---- 6. B goes offline, edits, comes back ------------------------------
  await adminCtx.setOffline(true);
  await typeInto(pageB, "-OFFLINE");
  await adminCtx.setOffline(false);
  await expect
    .poll(() => promptOf(pageA), { timeout: 45_000, message: "A never received B's offline edit" })
    .toContain("-OFFLINE");
  record("offline edit reconciled", { a: await promptOf(pageA), b: await promptOf(pageB) });

  // ---- 6b. The acknowledgement really reaches the client -----------------
  // The save area only says "Saved" after the service broadcasts an ack for the
  // exact committed state hash, so this is the end-to-end ack proof.
  await expect
    .poll(
      async () => (await pageA.locator('[data-save-status], [role="status"]').allInnerTexts()).join(" | "),
      { timeout: 45_000, message: "the client never acknowledged its own state as Saved" },
    )
    .toContain("Saved");
  record("save area after ack", await pageA.locator('[data-save-status], [role="status"]').allInnerTexts());

  // ---- 6c. A non-prompt field shares the same exam-level room --------------
  await pageA.getByRole("radio", { name: /choice b/i }).first().click();
  await pageA.waitForTimeout(3_000);
  await control("/control/flush", { documentNames: [tokens["builder"]!.documentName] });
  const afterFieldSave = await db<{ revision: number; answer_definition: string; prompt: string }>(
    "select revision, answer_definition, left(prompt, 2000) as prompt from assessment_question_revisions where id = ?",
    [question.questionRevisionId],
  );
  record("row after non-prompt field edit", afterFieldSave);

  // ---- 7. The service stored the exam workspace + question projection ------
  const flush = await control("/control/flush", { documentNames: [tokens["builder"]!.documentName] });
  record("control /control/flush", flush);
  const stored = await db<{ ydoc_bytes: number | null; state_hash: Buffer | null; materialized_revision: number; lifecycle_state: string }>(
    "select length(ydoc_state) as ydoc_bytes, state_hash, materialized_revision, lifecycle_state from authoring_coedit_workspaces where exam_id = ?",
    [examId],
  );
  record("coedit row after flush", stored);
  const revisions = await db<{ revision: number; prompt: string }>(
    "select revision, left(prompt, 2000) as prompt from assessment_question_revisions where id = ?",
    [question.questionRevisionId],
  );
  record("materialized revision", revisions);
  // The CRDT bytes and the acknowledged hash are durable, and the question
  // projection the rest of the app reads carries the collaborative text.
  expect(stored[0]!.ydoc_bytes ?? 0).toBeGreaterThan(0);
  expect(stored[0]!.state_hash).not.toBeNull();
  expect(stored[0]!.materialized_revision).toBeGreaterThan(0);
  expect(revisions[0]!.prompt).toContain("-BRAVO");
  expect(revisions[0]!.prompt).toContain("-OFFLINE");

  // The partial save wrote the answer key without the prompt being carried: the
  // collaborative text survives in the materialized projection.
  expect(JSON.stringify(afterFieldSave[0]!.answer_definition ?? {})).toContain('"B"');
  expect(afterFieldSave[0]!.prompt).toContain("-OFFLINE");

  // ---- 8. A frozen room refuses further writes ---------------------------
  const frozen = await control("/control/freeze", {
    documentNames: [tokens["builder"]!.documentName],
  });
  record("control /control/freeze", frozen);
  const before = await promptOf(pageA);
  await typeInto(pageA, "-REFUSED-WHILE-FROZEN");
  await pageA.waitForTimeout(3_000);
  const aText = await promptOf(pageA);
  const bText = await promptOf(pageB);
  record("frozen write attempt", { a: aText, b: bText, bReceivedIt: bText.includes("-REFUSED-WHILE-FROZEN") });
  expect(before).not.toContain("-REFUSED-WHILE-FROZEN");
  expect(bText).not.toContain("-REFUSED-WHILE-FROZEN");
  // The refused edit never became durable either.
  const afterFreeze = await db<{ ydoc_bytes: number; materialized_revision: number }>(
    "select length(ydoc_state) as ydoc_bytes, materialized_revision from authoring_coedit_workspaces where exam_id = ?",
    [examId],
  );
  record("stored state after frozen attempt", afterFreeze);
  expect(afterFreeze[0]!.materialized_revision).toBe(stored[0]!.materialized_revision);
  await control("/control/unfreeze", {
    freezeToken: (frozen as { body: string }).body
      ? (JSON.parse((frozen as { body: string }).body) as { freezeToken: string }).freezeToken
      : "",
  });

  // ---- 9. A closed room says WHY and offers the prompt --------------------
  // The design: a lifecycle replacement freezes the old editor and offers
  // copy/export of the prompt before the new draft opens.
  const closed = await control("/control/close", {
    documentNames: [tokens["builder"]!.documentName],
    reason: "draft_replaced",
  });
  record("control /control/close", closed);
  expect((closed as { status: number }).status).toBe(200);

  const replacedNotice = pageA.getByText(/a newer version is active/i);
  await replacedNotice.waitFor({ timeout: 15_000 });
  const copy = pageA.getByRole("button", { name: "Copy my work" });
  await copy.waitFor();
  await copy.click();
  const exported = await pageA.evaluate(() => navigator.clipboard.readText());
  record("copy prompt export", { length: exported.length, sample: exported.slice(0, 120) });
  // The export is the room's own prompt, so it survives the closed room.
  expect(exported).toContain("TYPOGRAPHED-BY-A");

  // Frozen: the room no longer accepts writes from this editor.
  const editorAfterClose = pageA.getByRole(PROMPT.role, { name: PROMPT.name });
  record("editor contenteditable after close", await editorAfterClose.evaluate((n) => n.getAttribute("contenteditable")));
  expect(await editorAfterClose.evaluate((n) => n.getAttribute("contenteditable"))).toBe("false");

  const notices = await pageA
    .locator('[role="status"], [role="alert"]')
    .evaluateAll((nodes) => nodes.map((n) => (n.textContent ?? "").trim()).filter(Boolean));
  record("client notices after close", notices);

  // A room the service has closed must never let the save vocabulary claim
  // durability for work that was not committed.
  const saveTexts = await pageA
    .locator("[data-save-status], [role='status']")
    .evaluateAll((nodes) => nodes.map((n) => (n.textContent ?? "").trim()).filter(Boolean));
  record("save area after close", saveTexts);
  expect(saveTexts.join(" | ")).not.toContain("Saved");

  // Nothing after the close reaches the service either: the stored revision is
  // exactly the one the last flush acknowledged.
  const afterClose = await db<{ materialized_revision: number; state_hash: Buffer | null }>(
    "select materialized_revision, state_hash from authoring_coedit_workspaces where exam_id = ?",
    [examId],
  );
  record("stored state after close", afterClose);
  await typeInto(pageA, "-AFTER-CLOSE").catch(() => undefined);
  await pageA.waitForTimeout(2_000);
  const stillAfterClose = await db<{ materialized_revision: number; state_hash: Buffer | null }>(
    "select materialized_revision, state_hash from authoring_coedit_workspaces where exam_id = ?",
    [examId],
  );
  record("stored state after a post-close attempt", stillAfterClose);
  expect(stillAfterClose[0]!.materialized_revision).toBe(afterClose[0]!.materialized_revision);
  // mysql2 may return each BINARY column read as a distinct Buffer object.
  // Compare the value, not object identity.
  expect(Buffer.from(stillAfterClose[0]!.state_hash ?? "").toString("hex")).toBe(
    Buffer.from(afterClose[0]!.state_hash ?? "").toString("hex"),
  );

  await pageA.screenshot({ path: path.join(SCRATCH, "10-after-close.png") });
  await pageB.screenshot({ path: path.join(SCRATCH, "11-after-close-b.png") });

  await builderCtx.close();
  await adminCtx.close();
});

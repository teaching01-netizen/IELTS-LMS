// Run against the EXISTING Vite app; this script never starts a server or saves
// an exam. Only media HTTP responses are mocked. Real React/TipTap components,
// DOM clipboard events, PNG decoding, checksums and upload requests execute.
// Usage: node scripts/verify-sat-clipboard.mjs [http://127.0.0.1:3000]
import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const origin = process.argv[2] ?? "http://127.0.0.1:3000";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  const requests = [];
  const unexpectedWrites = [];
  const results = [];
  let assetCounter = 0;
  let png;
  const asset = id => ({ id, fileName: "clipboard.png", contentType: "image/png", uploadStatus: "ready", downloadUrl: origin + "/__clipboard-regression/" + id + ".png" });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const reply = data => route.fulfill({ json: { success: true, data } });
    if (path === "/api/v1/media/uploads" && req.method() === "POST") {
      const body = req.postDataJSON();
      assert.equal(body.ownerKind, "assessment_question");
      assert.equal(body.ownerId, "browser-regression-question");
      assert.match(body.checksumSha256, /^[a-f0-9]{64}$/);
      const id = "asset-" + ++assetCounter;
      requests.push("intent");
      return reply({ asset: asset(id), uploadUrl: origin + "/__clipboard-regression/upload", headers: { "Content-Type": "image/png" } });
    }
    if (path.startsWith("/api/v1/media/uploads/asset-") && path.endsWith("/complete") && req.method() === "POST") {
      assert.ok(req.postDataJSON().sizeBytes > 0);
      requests.push("complete");
      return reply(asset(path.split("/")[5]));
    }
    if (path.startsWith("/api/v1/media/asset-") && req.method() === "GET") return reply(asset(path.split("/").at(-1)));
    if (req.method() !== "GET" && !path.includes("/auth/")) unexpectedWrites.push(req.method() + " " + path);
    return route.fulfill({ status: 401, json: { success: false, error: { code: "UNAUTHORIZED", message: "Isolated clipboard regression" } } });
  });
  await page.route("**/__clipboard-regression/**", async route => {
    if (route.request().method() === "PUT") {
      const bytes = route.request().postDataBuffer();
      assert.ok(bytes?.length > 0);
      assert.equal(bytes.subarray(0, 4).toString("hex"), "89504e47");
      requests.push("put");
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ contentType: "image/png", body: png });
  });
  await page.goto(origin + "/login", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Sign In", exact: true }).waitFor();
  const dataUrl = await page.evaluate(async () => {
    const source = await (await fetch("/src/main.tsx")).text();
    const deps = [...source.matchAll(/from "([^"]+)"/g)].map(match => match[1]);
    const React = await import(deps.find(path => path.includes("/react.js?")));
    const client = await import(deps.find(path => path.includes("/react-dom_client.js?")));
    const { FastQuestionComposer } = await import("/src/features/exam-authoring/editor/FastQuestionComposer.tsx");
    const { SAT_RICH_COMPOSER_CAPABILITIES, SAT_CHOICE_COMPOSER_CAPABILITIES } = await import("/src/features/exam-authoring/editor/RichQuestionComposer.tsx");
    const { createElement: h, useState } = React.default ?? React;
    const host = document.createElement("section");
    document.body.append(host);
    window.__clipboardRegression = { root: (client.createRoot ?? client.default.createRoot)(host), changes: [], notices: [], render: null };
    const diagnostic = window.__clipboardRegression;
    function ControlledComposer({ mode }) {
      const [value, setValue] = useState({ version: 2, nodes: [], document: { type: "doc", content: [{ type: "paragraph" }] } });
      const capabilities = mode === "choice" ? SAT_CHOICE_COMPOSER_CAPABILITIES : mode === "no-images" ? { ...SAT_RICH_COMPOSER_CAPABILITIES, image: false } : SAT_RICH_COMPOSER_CAPABILITIES;
      return h(FastQuestionComposer, { label: "SAT browser clipboard regression", assetOwnerId: "browser-regression-question", capabilities, value, onChange: next => { diagnostic.changes.push(next); setValue(next); }, onSmartPaste: info => diagnostic.notices.push(info) });
    }
    let key = 0;
    diagnostic.render = (mode = "rich") => {
      diagnostic.changes = [];
      diagnostic.notices = [];
      diagnostic.root.render(h(ControlledComposer, { key: ++key, mode }));
    };
    diagnostic.render();
    const canvas = document.createElement("canvas");
    canvas.width = 4; canvas.height = 4;
    canvas.getContext("2d").fillRect(0, 0, 4, 4);
    diagnostic.png = canvas.toDataURL("image/png");
    return diagnostic.png;
  });
  png = Buffer.from(dataUrl.split(",")[1], "base64");
  const textbox = page.getByRole("textbox", { name: "SAT browser clipboard regression", exact: true });
  await textbox.waitFor();

  async function reset(mode = "rich", doc) {
    const previous = await textbox.elementHandle();
    await page.evaluate(mode => window.__clipboardRegression.render(mode), mode);
    await page.waitForFunction(old => !old.isConnected, previous);
    await textbox.waitFor();
    if (doc) await textbox.evaluate((el, content) => el.editor.commands.setContent(content), doc);
    await textbox.focus();
    await page.evaluate(() => { window.__clipboardRegression.changes = []; window.__clipboardRegression.notices = []; });
  }
  async function paste({ text = "", html = "", images = 0, kind = "paste", shift = false }) {
    const received = await textbox.evaluate((el, input) => {
      const dt = new DataTransfer();
      if (input.text) dt.setData("text/plain", input.text);
      if (input.html) dt.setData("text/html", input.html);
      const encoded = window.__clipboardRegression.png.split(",")[1];
      for (let i = 0; i < input.images; i += 1) dt.items.add(new File([Uint8Array.from(atob(encoded), ch => ch.charCodeAt(0))], "clipboard-" + i + ".png", { type: "image/png" }));
      const bounds = el.getBoundingClientRect();
      const event = input.kind === "drop" ? new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: bounds.left + 5, clientY: bounds.top + 5 }) : new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
      if (input.shift) Object.defineProperty(event, "shiftKey", { value: true });
      el.dispatchEvent(event);
      return { prevented: event.defaultPrevented, types: [...dt.types] };
    }, { text, html, images, kind, shift });
    if (!shift) await page.waitForFunction(() => window.__clipboardRegression.notices.length > 0);
    return received;
  }
  async function checkSavedState() {
    const serialized = await page.evaluate(() => JSON.stringify(window.__clipboardRegression.changes));
    assert.doesNotMatch(serialized, /blob:|data:image/);
    return serialized;
  }

  for (const mode of ["rich", "choice"]) {
    await reset(mode);
    const event = await paste({ text: "**Advanced Real Analysis Problem**", html: "<p><span>**Advanced Real Analysis Problem**</span></p>" });
    await expect(textbox.locator("strong")).toHaveText("Advanced Real Analysis Problem");
    assert.equal(event.prevented, true);
    assert.match(await checkSavedState(), /"type":"bold"/);
    results.push(mode + ": HTML-wrapped Markdown → bold");
  }
  await reset();
  await paste({ text: "**Plain Markdown**" });
  await expect(textbox.locator("strong")).toHaveText("Plain Markdown");
  results.push("plain-text Markdown → bold");

  for (const [kind, mode, images, text] of [["paste", "rich", 1, ""], ["drop", "rich", 1, ""], ["paste", "choice", 1, ""], ["paste", "rich", 2, "**Mixed caption**"]]) {
    await reset(mode);
    const start = requests.length;
    await paste({ kind, images, text, html: text ? "<p>" + text + "</p>" : "" });
    await expect(textbox.locator("img")).toHaveCount(images);
    await expect.poll(() => textbox.locator("img").evaluateAll(elements => elements.every(el => el.complete && el.naturalWidth === 4))).toBe(true);
    const requestSteps = requests.slice(start);
    for (const step of ["intent", "put", "complete"]) assert.equal(requestSteps.filter(value => value === step).length, images);
    assert.match(await checkSavedState(), /"assetId":"asset-/);
    if (text) await expect(textbox.locator("strong")).toHaveText("Mixed caption");
    await textbox.evaluate(el => el.editor.commands.undo());
    await expect(textbox.locator("img")).toHaveCount(0);
    await expect(textbox).toHaveText("");
    results.push(mode + " " + kind + ": " + images + " PNG(s), upload lifecycle, rendering, safe persistence, one undo");
  }

  await reset("rich", { type: "doc", content: [{ type: "codeBlock" }] });
  await paste({ text: "**literal code**", html: "<p>**literal code**</p>" });
  await expect(textbox.locator("pre")).toContainText("**literal code**");
  await expect(textbox.locator("strong")).toHaveCount(0);
  results.push("code block keeps Markdown literal");

  await reset("no-images");
  const prior = requests.length;
  await paste({ images: 1 });
  await expect(textbox.locator("img")).toHaveCount(0);
  assert.equal(requests.length, prior);
  assert.equal(await page.evaluate(() => window.__clipboardRegression.notices.at(-1).rejectedImageCount), 1);
  results.push("image capability gate rejects without upload");

  await reset();
  await paste({ html: String.raw`<p>**Formula**</p><p>\[</p><p>x_1+x_2</p><p>\]</p>`, text: String.raw`**Formula** \[x_1+x_2\]` });
  await expect(textbox.locator("strong")).toHaveText("Formula");
  const mathJson = await textbox.evaluate(el => JSON.stringify(el.editor.getJSON()));
  assert.match(mathJson, /"type":"blockMath"/);
  results.push("HTML display math remains intact alongside Markdown");

  assert.deepEqual(errors, []);
  assert.deepEqual(unexpectedWrites, []);
  console.log(JSON.stringify({ baseURL: origin, results, pageErrors: errors, unexpectedWrites, note: "Media HTTP mocked; real browser decoding, checksums, DOM events and production composer used. No saved exam modified." }, null, 2));
} finally {
  await browser.close();
}

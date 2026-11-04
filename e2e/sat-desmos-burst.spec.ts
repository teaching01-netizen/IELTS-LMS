/**
 * SAT Desmos burst gate — Track C E2E-A/E2E-B (plan 2026-11-04 §6 Track C).
 *
 * Owns the chaos + pin matrix the unit suites cannot prove because they need
 * a real browser, real iframe documents, and real timing:
 *
 *   C1  Desmos blackhole  → explicit error ≤15s, Retry recovers, answering intact (FR-01).
 *   C1b Desmos 503 shed    → bounded error, spinner never eternal (FR-01/ERR-01).
 *   C1c Client/CSP block   → bounded failure + answers-safe runbook hint (CONC-02).
 *   C2a Single-doc budget  → ≤1 Desmos document before activeReady (FR-02).
 *   C2b Bare RW surface    → zero Desmos documents (INV-002; route C14 owns the
 *                           form boundary — this is the harness complement, not a duplicate).
 *   C3a Blocked pin        → paused calculator inert + aria-disabled (FR-05/INV-005).
 *   C3b Locale freeze pin  → seeded en-US still renders lang=en (FR-06).
 *   C3c Close-persistence  → close survives question nav; reopen restores (review analog, INV-004).
 *
 * KNOWN RED (TRACK-A-01 residual, reported to lead — do NOT fix in Track C scope):
 * Playwright-synthesized failures (route.abort any reason, route.fulfill any
 * status incl. 503+TAO) are invisible to every same-origin probe by platform
 * construction (verified): the committed error document is cross-origin
 * opaque (location access throws — never a readable chrome-error URL) and
 * synthetic responses create NO Resource Timing entry
 * (getEntriesByName(src) === []), so neither the error-URL probe nor the
 * responseStatus probe can fire, and no frame `error` event reaches the
 * component. The load event still fires → ready. The Track A probes are
 * correct for BROWSER-OBSERVABLE failures (real DNS/TLS chrome-error
 * commits, real HTTP failures carrying Timing-Allow-Origin, native error
 * events: DNS-hijack school filters are caught; TCP-reset/proxy-200 blocks
 * are the documented indistinguishable residual). C1b/C1c stay RED as
 * regression pins until the component gains a positive-confirmation
 * mechanism (e.g. transfer-size heuristic / handshake) or real-failure
 * stub-origin infra exists. C1 (hang → watchdog timeout) is the realistic
 * burst stall and is GREEN.
 *
 * Route-level gates (prewarm: read-only, skew-hold inert+disabled re-resolve,
 * blocked command-guard, C1–C14 matrix) stay owned by the unit suites
 * (SatStudentSessionRoute.prewarm.test.tsx incl. C14, satCalculatorWorkspace.test.ts);
 * this spec references them instead of re-proving them.
 *
 * Throttled run: SAT_DESMOS_THROTTLE=1 emulates Fast-3G + 300ms RTT via CDP
 * (Chromium only) for the whole file. The 3-run gate is: 2× online + 1× throttled.
 */

import { expect, test, type Page } from "@playwright/test";

const ROUTE = "/__dev/sat-accessibility?mode=math";
const RW_ROUTE = "/__dev/sat-accessibility";
const DESMOS_TRUSTED = '[data-sat-trusted-tool="desmos"]';
const ERROR_UI = "[data-desmos-error-ui]";
const RETRY = "[data-desmos-retry]";

/** Watchdog budget the error bound is measured against (Track A: 14s). */
const ERROR_BOUND_MS = 15_000;

/**
 * Harness-load budget: wall-clock page/iframe attach under vite dev. Stretches
 * under SAT_DESMOS_THROTTLE=1 (Fast-3G + thousands of unbundled dev modules);
 * product bounds (watchdog page clock, doc budget) are asserted separately.
 */
const LOAD_TIMEOUT = process.env["SAT_DESMOS_THROTTLE"] === "1" ? 120_000 : 30_000;

interface DesmosOutcomeBeacon {
  name: string;
  mode?: string;
  outcome?: string;
  durationMs?: number;
  scheduleId?: string;
  attemptId?: string;
  moduleAttemptId?: string;
  retryCount?: number;
}

declare global {
  interface Window {
    __satDesmosOutcomes?: DesmosOutcomeBeacon[];
    __satDesmosMountedAt?: number | null;
    __satDesmosErrorAt?: number | null;
    __satDocMaxBeforeReady?: number;
  }
}

test.beforeEach(async ({ page, browserName }) => {
  if (process.env["SAT_DESMOS_THROTTLE"] === "1") {
    test.skip(
      browserName !== "chromium",
      "Fast-3G emulation needs Chromium CDP; WebKit runs unthrottled."
    );
    const session = await page.context().newCDPSession(page);
    await session.send("Network.emulateNetworkConditions", {
      offline: false,
      // Fast-3G: ~1.6 Mbps down / ~750 Kbps up, 300ms RTT (plan §6 C1).
      downloadThroughput: 200_000,
      uploadThroughput: 93_750,
      latency: 300,
    });
  }
});

/**
 * Installs the page-side markers BEFORE any navigation: outcome-beacon
 * collector, mount/error performance.now() stamps (page clock, immune to
 * Node round-trip jitter), and the pre-ready document max-tracker.
 */
async function installDesmosMarkers(page: Page, seedLocaleEnUS = false): Promise<void> {
  await page.addInitScript(
    (args) => {
      const w = window as Window & Record<string, unknown>;
      w["__satDesmosOutcomes"] = [];
      w["__satDesmosMountedAt"] = null;
      w["__satDesmosErrorAt"] = null;
      w["__satDocMaxBeforeReady"] = 0;
      if (args.seed) {
        window.sessionStorage.setItem(
          "sat-desmos-locale:v1:debug-schedule:debug-attempt:debug-module",
          JSON.stringify({ locale: "en-US" })
        );
      }
      window.addEventListener("student-observability-metric", (event) => {
        const detail = (event as CustomEvent).detail as DesmosOutcomeBeacon | undefined;
        if (detail && detail.name === "sat_desmos_outcome") {
          (w["__satDesmosOutcomes"] as DesmosOutcomeBeacon[]).push(detail);
        }
      });
      const mark = () => {
        const trusted = document.querySelector(args.trusted);
        if (!w["__satDesmosMountedAt"] && trusted) {
          w["__satDesmosMountedAt"] = performance.now();
        }
        if (!w["__satDesmosErrorAt"] && document.querySelector(args.errorUi)) {
          w["__satDesmosErrorAt"] = performance.now();
        }
        const ready = trusted?.getAttribute("data-desmos-ready") === "true";
        if (!ready) {
          const count = document.querySelectorAll("iframe[data-desmos-mode]").length;
          const prev = w["__satDocMaxBeforeReady"] as number;
          if (count > prev) w["__satDocMaxBeforeReady"] = count;
        }
      };
      // documentElement may not exist yet at document_start: watch the
      // document until it does, then hand over to the subtree observer.
      const root = document.documentElement ?? document;
      new MutationObserver(mark).observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
      });
      mark();
    },
    { seed: seedLocaleEnUS, trusted: DESMOS_TRUSTED, errorUi: ERROR_UI }
  );
}

async function desmosOutcomes(page: Page): Promise<DesmosOutcomeBeacon[]> {
  return page.evaluate(() => window.__satDesmosOutcomes ?? []);
}

/** Page-clock bound: error UI stamp minus mount stamp must fit the 15s exam bound. */
async function expectBoundedError(page: Page): Promise<number> {
  const elapsed = await page.evaluate(() => {
    const mounted = window.__satDesmosMountedAt;
    const errored = window.__satDesmosErrorAt;
    if (mounted == null || errored == null) return -1;
    return errored - mounted;
  });
  expect(
    elapsed,
    "error UI must appear on the page clock (mount → error)"
  ).toBeGreaterThanOrEqual(0);
  expect(
    elapsed,
    `Desmos failure must resolve ≤${ERROR_BOUND_MS}ms after mount`
  ).toBeLessThan(ERROR_BOUND_MS);
  return elapsed;
}

async function answerFirstMathOption(page: Page): Promise<void> {
  const firstRadio = page.getByRole("radio", { name: /Option A.*3/i });
  const inputId = await firstRadio.getAttribute("id");
  expect(inputId, "math option must expose a labelled input").toBeTruthy();
  await page.locator(`label[for="${inputId}"]`).click();
  await expect(firstRadio).toBeChecked();
}

test("C1 blackhole: stalled Desmos → explicit error ≤15s, Retry recovers, answering intact", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await installDesmosMarkers(page);
  // True burst blackhole: hold the Desmos document requests open forever
  // (tail-throttled school WiFi). Never abort: an aborted subframe commits
  // an error document that fires `load` (see TRACK-A-01 above).
  await page.route(
    (url) => url.hostname.includes("desmos.com"),
    () => new Promise(() => {})
  );
  await page.goto(`${ROUTE}&tool=calculator`);

  const trusted = page.locator(DESMOS_TRUSTED);
  await expect(trusted).toHaveAttribute("data-desmos-ready", "false");
  await expect(page.locator(ERROR_UI)).toBeVisible({ timeout: 30_000 });
  const elapsedMs = await expectBoundedError(page);

  const status = await trusted.getAttribute("data-desmos-status");
  expect(["timeout", "blocked", "error"], `terminal status, got ${status}`).toContain(status ?? "");
  await expect(page.locator(RETRY)).toBeVisible();
  await expect(page.getByText(/answers are safe/i)).toBeVisible();
  // The eternal spinner is gone: loading overlay unmounts once the error resolves.
  await expect(page.locator("[data-desmos-loading]")).toHaveCount(0);
  test.info().annotations.push({
    type: "desmos-blackhole",
    description: `error in ${Math.round(elapsedMs)}ms, status=${status}`,
  });

  // The exam never blocks on the calculator: answering works mid-outage.
  await answerFirstMathOption(page);

  const preRetry = await desmosOutcomes(page);
  expect(
    preRetry.filter((beacon) => ["timeout", "blocked", "error"].includes(beacon.outcome ?? "")),
    "one terminal non-ready beacon per failed mount"
  ).not.toHaveLength(0);

  // Network restores → student Retry (single remount, no reload herd) → ready.
  // ignoreErrors: the blackhole route handlers hang forever by design; do
  // not wait for them — the remount issues fresh requests that go direct.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.locator(RETRY).click();
  await expect(trusted).toHaveAttribute("data-desmos-ready", "true", { timeout: 60_000 });
  const postRetry = await desmosOutcomes(page);
  expect(
    postRetry.filter((beacon) => beacon.outcome === "ready"),
    "Retry remount must beacon ready"
  ).not.toHaveLength(0);

  // Answer survives the outage + remount (writeId-idempotent path untouched).
  await expect(page.getByRole("radio", { name: /Option A.*3/i })).toBeChecked();
});

test("C1b shed: Desmos 503 → bounded error, never an eternal spinner", async ({ page }) => {
  test.setTimeout(120_000);
  await installDesmosMarkers(page);
  await page.route(
    (url) => url.hostname.includes("desmos.com"),
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "exam-day shed rehearsal",
        // TRACK-A-01 residual contract: synthetic fulfills create NO Resource
        // Timing entry (verified: getEntriesByName(src) === []), so even a
        // TAO-bearing 503 is probe-invisible — the header below documents the
        // REAL-503 contract for readers, it cannot make the synthetic visible.
        headers: { "Timing-Allow-Origin": "*" },
      })
  );
  await page.goto(`${ROUTE}&tool=calculator`);

  const trusted = page.locator(DESMOS_TRUSTED);
  // INV-010 — TRACK-A-01 gate: a shed Desmos must never report ready.
  await expect(trusted).toHaveAttribute("data-desmos-ready", "false", { timeout: 30_000 });
  await expect(page.locator(ERROR_UI)).toBeVisible({ timeout: 30_000 });
  const elapsedMs = await expectBoundedError(page);
  const status = await trusted.getAttribute("data-desmos-status");
  expect(["timeout", "blocked", "error"], `terminal status, got ${status}`).toContain(status ?? "");
  await expect(page.locator("[data-desmos-loading]")).toHaveCount(0);
  await expect(page.getByText(/answers are safe/i)).toBeVisible();
  test.info().annotations.push({
    type: "desmos-503",
    description: `error in ${Math.round(elapsedMs)}ms, status=${status}`,
  });

  // Answering stays usable under shed.
  await answerFirstMathOption(page);
});

test("C1c client-block: instant failure → bounded error + answers-safe runbook hint", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await installDesmosMarkers(page);
  await page.route((url) => url.hostname.includes("desmos.com"), (route) =>
    route.abort("blockedbyclient")
  );
  await page.goto(`${ROUTE}&tool=calculator`);

  // INV-010 — TRACK-A-01 gate: a client-blocked Desmos must never report ready.
  await expect(page.locator(DESMOS_TRUSTED)).toHaveAttribute("data-desmos-ready", "false", {
    timeout: 30_000,
  });
  await expect(page.locator(ERROR_UI)).toBeVisible({ timeout: 30_000 });
  const elapsedMs = await expectBoundedError(page);
  // Blocked copy when the fast-error heuristic fires (≤1500ms), timeout copy
  // via the watchdog backstop otherwise — both carry the answers-safe promise.
  await expect(page.getByText(/answers are safe/i)).toBeVisible();
  const beacons = await desmosOutcomes(page);
  expect(beacons, "failed mount must emit a sat_desmos_outcome beacon").not.toHaveLength(0);
  const classified = beacons[0]!.outcome;
  expect(["timeout", "blocked", "error"]).toContain(classified ?? "");
  expect(typeof beacons[0]!.durationMs).toBe("number");
  const allowlistShown =
    (await page.getByText(/blocked on this network|allowlist/i).count()) > 0;
  test.info().annotations.push({
    type: "desmos-block-classification",
    description: `outcome=${classified} in ${Math.round(elapsedMs)}ms (allowlist hint: ${allowlistShown})`,
  });
});

test("C2a burst budget: ≤1 Desmos document before activeReady, hover releases the deferral", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await installDesmosMarkers(page);
  // Closed calculator: keepAlive prewarm mounts the active mode eager; the
  // inactive mode stays deferred until eagerInactive (ready/hover/idle).
  await page.goto(ROUTE);
  // Attached, not visible: the closed calculator is a hidden keepAlive tree.
  await page.waitForSelector(DESMOS_TRUSTED, { state: "attached", timeout: 30_000 });

  const preReadyMax = await page.evaluate(() => window.__satDocMaxBeforeReady ?? -1);
  expect(
    preReadyMax,
    `single-mode burst budget: at most 1 document before activeReady (saw ${preReadyMax})`
  ).toBeLessThanOrEqual(1);

  // NOTE: preconnect links are route-owned (ensureDesmosPreconnect at
  // SatStudentSessionRoute:430, unit-pinned) — the harness mounts the host
  // directly, so no link assertion here. The doc budget below is the
  // harness-observable half of FR-02.

  // Open → activeReady → deferral releases → both modes ready (spread post-burst).
  await page.getByRole("button", { name: "Calculator", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Calculator", exact: true });
  await expect(panel).toBeVisible();
  await expect(page.locator(DESMOS_TRUSTED)).toHaveAttribute("data-desmos-ready", "true", {
    timeout: 60_000,
  });
  await panel.hover();
  await expect(page.locator('iframe[data-desmos-mode="scientific"]')).toBeAttached({
    timeout: 30_000,
  });
  await expect(page.locator('iframe[data-desmos-mode="graphing"]')).toBeAttached({
    timeout: 30_000,
  });
  await expect(page.locator(DESMOS_TRUSTED)).toHaveAttribute(
    "data-desmos-both-modes-ready",
    "true",
    { timeout: 60_000 }
  );
});

test("C2b bare surface: RW mode mounts zero Desmos documents (C14 harness complement)", async ({
  page,
}) => {
  // Route C14 (SatStudentSessionRoute.prewarm.test.tsx) owns the section-entry
  // form boundary; this pins the harness side: a non-Math surface never mounts
  // a hidden Desmos document (INV-002).
  await page.goto(RW_ROUTE);
  await expect(page.getByText("Which choice best states the main idea")).toBeVisible({
    timeout: LOAD_TIMEOUT,
  });
  await expect(page.locator("iframe[data-desmos-mode]")).toHaveCount(0);
  await expect(page.locator(DESMOS_TRUSTED)).toHaveCount(0);
});

test("C3a blocked pin: paused calculator is inert, disabled, and keeps answers governed", async ({
  page,
}) => {
  // Extends (not duplicates) the existing pause-inert coverage: adds the
  // aria-disabled contract on the Desmos tree plus the answering-disabled pin.
  await page.goto(`${ROUTE}&paused=1&tool=calculator`);
  const panel = page.locator('[data-sat-tool-window="Calculator"]');
  await expect(panel).toHaveAttribute("inert");
  await expect(page.locator(DESMOS_TRUSTED)).toHaveAttribute("aria-disabled", "true");
  for (const iframe of await page.locator("iframe[data-desmos-mode]").all()) {
    await expect(iframe).toHaveAttribute("inert");
    await expect(iframe).toHaveAttribute("tabindex", "-1");
  }
  await expect(page.getByText("Accessibility harness pause", { exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: /Option A.*3/i })).toBeDisabled();
});

test("C3b locale freeze: seeded en-US storage still renders lang=en", async ({ page }) => {
  test.setTimeout(120_000);
  await installDesmosMarkers(page, true);
  await page.goto(`${ROUTE}&tool=calculator`);
  await page.waitForSelector('iframe[data-desmos-mode]', { timeout: 60_000 });
  const srcs = await page.locator("iframe[data-desmos-mode]").evaluateAll((frames) =>
    (frames as HTMLIFrameElement[]).map((frame) => frame.src)
  );
  expect(srcs.length, "calculator must mount at least the active document").toBeGreaterThan(0);
  for (const src of srcs) {
    expect(src, `embed URL must carry the frozen exam locale, got ${src}`).toContain("lang=en");
    expect(src, `seeded en-US must never leak into the embed, got ${src}`).not.toContain("en-US");
  }
});

test("C3c close persistence + prewarm storage hygiene across question nav", async ({ page }) => {
  // Review analog at harness level: closing the tool keeps it closed across
  // question navigation (no remount herd); reopening restores the same nodes.
  await page.goto(`${ROUTE}&tool=calculator`);
  const dialog = page.getByRole("dialog", { name: "Calculator", exact: true });
  await expect(dialog).toBeVisible({ timeout: LOAD_TIMEOUT });
  await page.getByRole("button", { name: "Close Calculator", exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Question 2" })).toBeVisible();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Calculator", exact: true }).click();
  await expect(dialog).toBeVisible();

  // Prewarm read-only hygiene (unit-gated by isPrewarmKey + C14): a real
  // moduleAttemptId never mints prewarm: keys, even across mode switches.
  await page.getByRole("radio", { name: "Scientific", exact: true }).click();
  await page.getByRole("radio", { name: "Graphing", exact: true }).click();
  const storageKeys = await page.evaluate(() => Object.keys(window.sessionStorage));
  expect(
    storageKeys.filter((key) => key.includes("prewarm:")),
    "no prewarm: writes under a real module attempt"
  ).toEqual([]);
});

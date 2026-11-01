import { defineConfig, devices } from "@playwright/test";

/**
 * SAT calculator touch-resize suite (iPad / mobile first).
 *
 * The harness route is dev-only and needs no backend: it mounts the real
 * SatExamShell + SatCalculatorHost + Desmos embed, so the suite measures the
 * production CSS and pointer handlers. Desmos is a live embed, hence the
 * generous per-test budgets and `retries: 0` (a retry would hide a real
 * race in the gesture).
 */
const port = Number(process.env["PLAYWRIGHT_SAT_CALC_TOUCH_PORT"] ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PLAYWRIGHT_SAT_CALC_TOUCH_PORT must be a valid TCP port.");
}
const baseURL = `http://127.0.0.1:${port}`;

const { defaultBrowserType: _ignored, ...iPad } = devices["iPad (gen 7)"];
void _ignored;

const iPadLandscape = { ...iPad, viewport: { width: 1080, height: 810 } };
const iPadPortrait = { ...iPad, viewport: { width: 810, height: 1080 } };
const iPadMiniPortrait = { ...iPad, viewport: { width: 744, height: 1133 } };
const iPadProLandscape = { ...iPad, viewport: { width: 1194, height: 834 } };
const iPadSplit = { ...iPad, viewport: { width: 507, height: 810 } };
const iPhonePortrait = { ...iPad, viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 };
const iPhoneLandscape = { ...iPad, viewport: { width: 844, height: 390 }, deviceScaleFactor: 3 };
const pixelLandscape = {
  ...iPad,
  viewport: { width: 915, height: 412 },
  userAgent: devices["Pixel 7"].userAgent,
  deviceScaleFactor: 2.625,
};

const touchProfiles = [
  ["ipad-landscape", iPadLandscape],
  ["ipad-portrait", iPadPortrait],
  ["ipad-mini-portrait", iPadMiniPortrait],
  ["ipad-pro-landscape", iPadProLandscape],
  ["ipad-split", iPadSplit],
  ["iphone-portrait", iPhonePortrait],
  ["iphone-landscape", iPhoneLandscape],
  ["pixel-landscape", pixelLandscape],
] as const;

const projects = touchProfiles.flatMap(([name, profile]) => [
  {
    name: `${name}-chromium`,
    // CDP native touch for the input cases; Chromium rendering for the CSS.
    use: { ...profile },
  },
  {
    name: `${name}-webkit`,
    // Safari engine + coarse-pointer emulation: rendering, media query and
    // pointer-handler coverage (WebKit has no CDP touch dispatch).
    use: { ...profile },
  },
]);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "sat-calculator-touch-resize.spec.ts",
  fullyParallel: true,
  retries: 0,
  reporter: "list",
  expect: {
    timeout: 15_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.03, animations: "disabled" },
  },
  timeout: 120_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    ...projects,
    {
      name: "desktop-chromium",
      // Fine pointer guard: the legacy inside-the-window handles must not move.
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: `bunx vite --port=${port} --host=127.0.0.1`,
    url: `${baseURL}/__dev/sat-accessibility`,
    timeout: 120_000,
    reuseExistingServer: true,
  },
});

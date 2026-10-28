import { defineConfig, devices } from "@playwright/test";

/**
 * Staff interaction profile: production build, fixture transport only, no
 * backend or database. Owns its own preview port so it never reuses a dev server.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "staff-perf.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4317",
    timezoneId: "Asia/Bangkok",
    locale: "en-US",
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], deviceScaleFactor: 1 } }],
  webServer: {
    command: "bun run build && bunx vite preview --host 127.0.0.1 --port 4317 --strictPort",
    url: "http://127.0.0.1:4317/login",
    timeout: 300_000,
    reuseExistingServer: false,
  },
});

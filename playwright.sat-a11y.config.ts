import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env["PLAYWRIGHT_SAT_A11Y_PORT"] ?? "3000");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PLAYWRIGHT_SAT_A11Y_PORT must be a valid TCP port.");
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "sat-student-accessibility.spec.ts",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "touch-chromium", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: `bunx vite --port=${port} --host=127.0.0.1`,
    url: `${baseURL}/__dev/sat-accessibility`,
    timeout: 120_000,
    reuseExistingServer: true,
  },
});

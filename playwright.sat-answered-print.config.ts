import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env["SAT_PRINT_E2E_PORT"] ?? "3000");
const baseURL = `http://127.0.0.1:${port}`;

// PDF-05 / PDF-10 print fidelity: API mocked with page.route, real engines.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "sat-answered-exam-print.spec.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure", viewport: { width: 794, height: 1123 } },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 794, height: 1123 } } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 794, height: 1123 } } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport: { width: 794, height: 1123 } } },
  ],
  webServer: {
    command: `bun run dev -- --host 127.0.0.1 --port ${port}`,
    url: `${baseURL}/login`,
    timeout: 120_000,
    reuseExistingServer: true,
  },
});

import { defineConfig } from "@playwright/test";

const port = Number(process.env["PLAYWRIGHT_SAT_LIBRARY_PORT"] ?? "3100");
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PLAYWRIGHT_SAT_LIBRARY_PORT must be a valid TCP port.");
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "sat-library-folders.spec.ts",
  fullyParallel: false,
  timeout: 60_000,
  retries: 0,
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure" },
  webServer: {
    command: `bunx vite --port=${port} --host=127.0.0.1`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: true,
  },
});

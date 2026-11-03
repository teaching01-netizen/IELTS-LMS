import { defineConfig, devices } from "@playwright/test";

/**
 * The SAT authoring lifecycle suite.
 *
 * WHY ITS OWN CONFIG
 * ------------------
 * The plan's mandatory regression is about a BROWSER: a pre-draft exam must
 * answer 200 NO_DRAFT, issue zero POSTs, and print nothing to the console. That
 * evidence needs a real browser and a real app build, but NOT the Go/MySQL
 * stack — the spec answers the transport itself, and the harness route mounts
 * the shipped authoring workspace.
 *
 * Keeping it out of the default project set is deliberate: the default set
 * starts the Go-backed harness, so a shell-lifecycle regression would otherwise
 * be hidden behind whatever the backend needs that day. This suite runs against
 * `vite dev` alone and is wired as its own CI job (Phase 16).
 *
 * sat-flexible-m1-only.spec.ts rides the same harness (mocked transport, no
 * Go/MySQL): it proves the H1/H2/F1/F6 browser contracts for flexible M1-only
 * exams plus the H4 Full-SAT smoke. The real-DB half of H2 lives in
 * backend/go/cmd/api/sat_flexible_m1only_mysql_test.go.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["sat-authoring-lifecycle.spec.ts", "sat-flexible-m1-only.spec.ts"],
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bun run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:3000/__dev/sat-authoring",
    timeout: 120_000,
    reuseExistingServer: true,
  },
});

import { randomBytes } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * Focused live acceptance config for SAT retakes and answer-key PDFs.
 *
 * It reuses the repository's real `playwright.config.ts` server stack,
 * globalSetup, and desktop/mobile/WebKit project names. The only differences
 * are the selected spec, unused verified ports, no server reuse, and an
 * explicit live-classroom frontend/backend flag set.
 *
 * A full run is intentionally INCONCLUSIVE unless the caller supplies a
 * disposable environment:
 *
 *   TEST_DATABASE_URL=mysql://... \
 *   SAT_RETAKE_E2E_DISPOSABLE=1 \
 *   bunx playwright test --config playwright.sat-room-retakes.config.ts --project=chromium --workers=1
 *
 * Do not point TEST_DATABASE_URL at a shared or production database: the
 * global E2E seed is destructive to its own fixture rows.
 */

const VERIFIED_PORTS = {
  frontend: "PLAYWRIGHT_FRONTEND_PORT",
  backendUrl: "VITE_BACKEND_API_URL",
  port: "PORT",
  apiPort: "API_PORT",
  coedit: "AUTHORING_COEDIT_PORT",
} as const;

function validPort(value: string | undefined): number | null {
  if (!value) return null;
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1" }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function pickUnusedPort(
  explicit: string | undefined,
  reserved: readonly number[]
): Promise<number> {
  const requested = validPort(explicit);
  if (requested && !reserved.includes(requested) && (await portIsFree(requested))) {
    return requested;
  }
  for (let port = 34_810; port < 35_010; port += 1) {
    if (reserved.includes(port)) continue;
    if (await portIsFree(port)) return port;
  }
  throw new Error("Could not find an unused TCP port for the SAT retakes E2E run.");
}

const frontendPort = await pickUnusedPort(process.env[VERIFIED_PORTS.frontend], []);
// The API serves the built print bundle; backend/.env leaves this empty, and
// the base config captures its runtime env before our webServer overrides run.
if (!process.env["FRONTEND_DIST_DIR"]) process.env["FRONTEND_DIST_DIR"] = path.resolve("dist");
if (!process.env["ANSWEREDPDF_DIST"]) process.env["ANSWEREDPDF_DIST"] = path.resolve("dist");
const explicitBackendUrl = process.env[VERIFIED_PORTS.backendUrl];
const explicitApiPort =
  validPort(process.env[VERIFIED_PORTS.port]) ?? validPort(process.env[VERIFIED_PORTS.apiPort]);
const explicitBackendPort = explicitBackendUrl ? validPort(new URL(explicitBackendUrl).port) : null;
const apiPort =
  explicitBackendPort ?? explicitApiPort ?? (await pickUnusedPort(undefined, [frontendPort]));
const coeditPort = await pickUnusedPort(process.env[VERIFIED_PORTS.coedit], [
  frontendPort,
  apiPort,
]);

process.env[VERIFIED_PORTS.frontend] = String(frontendPort);
process.env[VERIFIED_PORTS.backendUrl] = explicitBackendUrl ?? `http://localhost:${apiPort}`;
process.env[VERIFIED_PORTS.port] = String(apiPort);
process.env[VERIFIED_PORTS.apiPort] = String(apiPort);
process.env[VERIFIED_PORTS.coedit] = String(coeditPort);
process.env["SAT_STUDY_FRONTEND_URL"] = `http://localhost:${frontendPort}`;

// Import after the verified env keys are set: the real config captures the
// frontend/backend/co-edit ports at module evaluation time.
const { default: baseConfig } = await import("./playwright.config");

const { globalSetup: _baseGlobalSetup, ...baseConfigWithoutGlobalSetup } = baseConfig;

const baseServers = Array.isArray(baseConfig.webServer)
  ? baseConfig.webServer
  : baseConfig.webServer
    ? [baseConfig.webServer]
    : [];

const liveClassroomEnv = {
  SAT_CLASSROOM_ENABLED: "true",
  EXAM_ACCESS_ENABLED: "true",
  SAT_PERSONAL_TIMING: "on",
  SAT_ACCESS_CODE_START: "true",
  SAT_START_CODE_KEYS: `retakes-e2e:${randomBytes(32).toString("base64")}`,
  // The API must serve the built print bundle; backend/.env leaves this empty.
  FRONTEND_DIST_DIR: process.env["FRONTEND_DIST_DIR"] ?? path.resolve("dist"),
  ANSWEREDPDF_DIST: process.env["ANSWEREDPDF_DIST"] ?? path.resolve("dist"),
};

const hasDisposableEnvironment =
  process.env["SAT_RETAKE_E2E_DISPOSABLE"] === "1" &&
  Boolean(process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"]);
if (!hasDisposableEnvironment) {
  console.warn(
    "[sat-room-retakes] INCONCLUSIVE: SAT_RETAKE_E2E_DISPOSABLE=1 plus TEST_DATABASE_URL or a " +
      "disposable DATABASE_URL are required; global setup and live servers are intentionally disabled."
  );
}

export default defineConfig({
  ...baseConfigWithoutGlobalSetup,
  testDir: "./e2e",
  testMatch: "sat-room-retakes.spec.ts",
  testIgnore: [],
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  outputDir: "test-results/sat-room-retakes",
  ...(hasDisposableEnvironment ? { globalSetup: "./e2e/global-setup.ts" } : {}),
  metadata: {
    feature: "SAT room retakes and answer-key PDFs",
    portAllocation: {
      PLAYWRIGHT_FRONTEND_PORT: frontendPort,
      VITE_BACKEND_API_URL: process.env[VERIFIED_PORTS.backendUrl],
      PORT: process.env[VERIFIED_PORTS.port],
      API_PORT: process.env[VERIFIED_PORTS.apiPort],
      AUTHORING_COEDIT_PORT: coeditPort,
    },
    fullRunRequirement:
      "SAT_RETAKE_E2E_DISPOSABLE=1 plus TEST_DATABASE_URL or a disposable DATABASE_URL; otherwise scenarios skip as INCONCLUSIVE.",
  },
  use: {
    ...baseConfig.use,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: (baseConfig.projects ?? []).filter((project) =>
    ["chromium", "mobile-chromium", "webkit"].includes(project.name ?? "")
  ),
  webServer: hasDisposableEnvironment
    ? baseServers.map((server) => ({
        ...server,
        reuseExistingServer: false,
        env: {
          ...(server.env ?? {}),
          ...liveClassroomEnv,
        },
      }))
    : [],
});

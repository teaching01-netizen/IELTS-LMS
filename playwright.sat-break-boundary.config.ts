import type { PlaywrightTestConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

if (!process.env["TEST_DATABASE_URL"]?.trim()) {
  throw new Error(
    "SAT break boundary E2E requires TEST_DATABASE_URL because its setup authors, publishes, and starts a real SAT room.",
  );
}

const chromiumProjects = (baseConfig.projects ?? []).filter(
  (project) => project.name === "chromium",
);
if (chromiumProjects.length === 0) {
  throw new Error("The base Playwright config must include the desktop Chromium project.");
}

// This flow joins an open access link without entering a code, so the API and
// worker must run with code-start off even when backend/.env enables it.
const breakBoundaryWebServer = (Array.isArray(baseConfig.webServer)
  ? baseConfig.webServer
  : []
).map((server) =>
  server.command.includes("cmd/api") || server.command.includes("cmd/worker")
    ? { ...server, env: { ...server.env, SAT_ACCESS_CODE_START: "false" } }
    : server,
);

const breakBoundaryConfig = {
  ...baseConfig,
  testMatch: "**/sat-break-boundary.spec.ts",
  projects: chromiumProjects,
  webServer: breakBoundaryWebServer,
} as PlaywrightTestConfig;

export default breakBoundaryConfig;

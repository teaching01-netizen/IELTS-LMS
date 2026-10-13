import type { PlaywrightTestConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

if (!process.env["TEST_DATABASE_URL"]?.trim()) {
  throw new Error(
    "SAT transition E2E requires TEST_DATABASE_URL because its setup seeds and advances a real SAT session.",
  );
}

const chromiumProjects = (baseConfig.projects ?? []).filter(
  (project) => project.name === "chromium",
);
if (chromiumProjects.length === 0) {
  throw new Error("The base Playwright config must include the desktop Chromium project.");
}

// This flow starts the room without entering an access code, so the API and
// worker must run with code-start off even when backend/.env enables it. The
// code-start flow has its own config (playwright.sat-code-start.config.ts).
const transitionWebServer = (Array.isArray(baseConfig.webServer) ? baseConfig.webServer : []).map(
  (server) =>
    server.command.includes("cmd/api") || server.command.includes("cmd/worker")
      ? { ...server, env: { ...server.env, SAT_ACCESS_CODE_START: "false" } }
      : server,
);

const transitionConfig = {
  ...baseConfig,
  testMatch: "**/sat-transition-flow.spec.ts",
  projects: chromiumProjects,
  webServer: transitionWebServer,
} as PlaywrightTestConfig;

export default transitionConfig;

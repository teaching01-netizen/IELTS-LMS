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

const transitionConfig = {
  ...baseConfig,
  testMatch: "**/sat-transition-flow.spec.ts",
  projects: chromiumProjects,
} as PlaywrightTestConfig;

export default transitionConfig;

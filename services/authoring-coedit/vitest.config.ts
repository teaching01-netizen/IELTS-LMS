import { defineConfig } from "vitest/config";

/**
 * The service has its own vitest config on purpose: the repository root config
 * targets the browser bundle (jsdom, DOM setup) and would leak that environment
 * into a Node service whose whole point is running outside the browser.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "@app": path.resolve(__dirname, "./src/app"),
      "@components": path.resolve(__dirname, "./src/components"),
      "@services": path.resolve(__dirname, "./src/services"),
      "@admin": path.resolve(__dirname, "./src/features/admin"),
      "@builder": path.resolve(__dirname, "./src/features/builder"),
      "@proctor": path.resolve(__dirname, "./src/features/proctor"),
      "@student": path.resolve(__dirname, "./src/features/student"),
      "@shared": path.resolve(__dirname, "./src/shared"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // The co-edit service is a Node/Hocuspocus process with its own Vitest
    // config and lifecycle suite. Keep it out of the browser bundle gate;
    // `bun run coedit:test` owns that verification boundary.
    exclude: [
      "**/node_modules/**",
      ".mimocode/**",
      "dist/**",
      "e2e/**",
      "services/authoring-coedit/**",
    ],
    coverage: {
      // The gate measures shipped product code. Storybook stories are
      // interactive demos (built by the storybook job), and test files
      // trivially cover themselves at 100% — both must not dilute or
      // inflate the unit-test coverage signal.
      exclude: [
        "**/*.stories.ts",
        "**/*.stories.tsx",
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/__tests__/**",
      ],
    },
  },
});

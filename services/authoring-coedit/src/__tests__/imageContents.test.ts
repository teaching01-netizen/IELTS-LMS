/**
 * The deployed image has to contain everything the service imports.
 *
 * The service is carried by ONE image — `backend/Dockerfile`, which Railway
 * builds and which supervises the co-edit process beside the Go API and worker.
 *
 * This service deliberately imports across the package boundary — the DOM-free
 * rich-text schema, the shared workspace-command envelope, the assessment
 * contracts — so both ends of a wire format share ONE definition. Those imports
 * resolve everywhere except in the container, because the image carries an
 * explicit allowlist of sources rather than the repository.
 *
 * That is not hypothetical, and it has now happened three times. Collapsing the
 * two command-envelope validators moved a browser import into `main.ts`, the
 * image kept its old COPY list, and the containerized entry point failed to
 * resolve `workspaceCommands.js`. Then the store-request frame was added to a
 * second, standalone `services/authoring-coedit/Dockerfile` — a list nothing
 * deployed — so the image that actually runs stayed without it and every
 * co-edit container crash-looped on `ERR_MODULE_NOT_FOUND` at import time. Then
 * a new module in the schema graph (`schema/imageNode.ts`) shipped as a dangling
 * import for the same reason. Every failure was invisible to typecheck, to every
 * suite, and to `bun run coedit:service`, which resolves from the repository
 * checkout.
 *
 * The allowlist is now `backend/coedit-runtime-manifest.json` and the Dockerfile
 * block is generated from it, so this file no longer reads COPY instructions.
 * One list is the truth, one walk decides what it must contain
 * (`backend/scripts/coeditRuntimeManifest.ts`), and the CI-enforced guard
 * `src/test/architecture/coedit-runtime-manifest.test.ts` owns the Dockerfile's
 * half of the contract. What is left here is the container's own premise: the
 * imports really do cross the boundary, and the runtime really does run on Node.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COEDIT_ENTRY,
  DOCKERFILE_PATH,
  MANIFEST_PATH,
  REPO_ROOT,
  findUnshippedRuntimeModules,
  reachableRuntimeModules,
} from "../../../../backend/scripts/coeditRuntimeManifest";

describe("co-editing service image", () => {
  it("reaches the cross-package modules this check exists to protect", () => {
    const reached = reachableRuntimeModules();
    // If resolution or the manifest's entry point moves, the assertions below
    // would pass against a graph that no longer leaves this package.
    expect(reached).toContain(COEDIT_ENTRY);
    expect(reached).toContain("src/features/exam-authoring/editor/schema/imageNode.ts");
    expect(reached).toContain("src/features/exam-authoring/realtime/coedit/workspaceCommands.ts");
  });

  it("ships every module the runtime reaches", () => {
    const gaps = findUnshippedRuntimeModules();
    expect(
      gaps.map((gap) => gap.target),
      `Add these to ${MANIFEST_PATH} and run \`bun run coedit:manifest\`:\n${gaps
        .map((gap) => `${gap.target} (imported by ${gap.importer} via ${gap.specifier})`)
        .join("\n")}`
    ).toEqual([]);
  });

  it("runs Hocuspocus with the Node runtime instead of Bun", () => {
    const dockerfile = readFileSync(join(REPO_ROOT, DOCKERFILE_PATH), "utf8");
    expect(dockerfile).toContain("FROM node:22-bookworm-slim AS runner");
    expect(dockerfile).toContain(
      `/usr/local/bin/node /app/node_modules/tsx/dist/cli.mjs /app/${COEDIT_ENTRY} &`
    );
    expect(dockerfile).not.toContain(`/usr/local/bin/bun run /app/${COEDIT_ENTRY} &`);
  });

  it("ships co-edit dependencies in a production-only runtime layer", () => {
    const dockerfile = readFileSync(join(REPO_ROOT, DOCKERFILE_PATH), "utf8");
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(packageJson.dependencies["tsx"]).toBeTruthy();
    expect(packageJson.dependencies["mysql2"]).toBeTruthy();
    expect(packageJson.devDependencies["tsx"]).toBeUndefined();
    expect(packageJson.devDependencies["mysql2"]).toBeUndefined();
    expect(packageJson.devDependencies["@tailwindcss/vite"]).toBeTruthy();
    expect(packageJson.devDependencies["@vitejs/plugin-react"]).toBeTruthy();
    expect(dockerfile).toContain("FROM node:22-bookworm-slim AS production-deps");
    expect(dockerfile).toContain("RUN bun install --production --frozen-lockfile");
    expect(dockerfile).toContain("COPY --from=production-deps /app/node_modules /app/node_modules");
    expect(dockerfile).not.toContain(
      "COPY --from=frontend-builder /app/node_modules /app/node_modules"
    );
  });

  it("keeps backend-only source out of the frontend build cache key", () => {
    const dockerfile = readFileSync(join(REPO_ROOT, DOCKERFILE_PATH), "utf8");
    const frontendStage = dockerfile.split("FROM golang:")[0] ?? "";

    expect(frontendStage).not.toContain("COPY . .");
    expect(frontendStage).toContain("COPY src/ ./src");
    expect(frontendStage).toContain("COPY public/ ./public");
    expect(frontendStage).toContain(
      "COPY services/authoring-coedit/src ./services/authoring-coedit/src"
    );
  });

  it("excludes generated artifacts and compiled binaries from the Docker context", () => {
    const dockerignore = readFileSync(join(REPO_ROOT, ".dockerignore"), "utf8").split(/\r?\n/);

    for (const entry of [
      ".git",
      "dist",
      "coverage",
      "playwright-report",
      "test-results",
      "storybook-static",
      "verification",
      "archive.tar",
      "*.tar",
      "*.tar.gz",
      "backend/go/api",
      "backend/go/bin",
    ]) {
      expect(dockerignore).toContain(entry);
    }
  });
});

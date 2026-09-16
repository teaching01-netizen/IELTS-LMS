/**
 * The deployed image has to contain everything the service imports.
 *
 * The service is carried by ONE image — `backend/Dockerfile`, which Railway
 * builds and which supervises the co-edit process beside the Go API and worker.
 *
 * This service deliberately imports across the package boundary — the DOM-free
 * rich-text schema, the shared workspace-command envelope, the assessment
 * contracts — so both ends of a wire format share ONE definition. Those imports
 * resolve everywhere except in the container, because `backend/Dockerfile` is
 * the only place that records which outside files travel into the image, and
 * nothing else reads it.
 *
 * That is not hypothetical, and it has now happened three times. Collapsing the
 * two command-envelope validators moved a browser import into `main.ts`, the
 * image kept its old COPY list, and the containerized entry point failed to
 * resolve `workspaceCommands.js`. Then the store-request frame was added to a
 * second, standalone `services/authoring-coedit/Dockerfile` — a list nothing
 * deployed — so the image that actually runs stayed without it and every
 * co-edit container crash-looped on `ERR_MODULE_NOT_FOUND` at import time;
 * that standalone Dockerfile has since been deleted, and there is exactly one
 * image and one list. Every failure was invisible to typecheck, to every suite,
 * and to `bun run coedit:service`, which resolves from the repository checkout.
 *
 * So this test performs the container's check without a container: parse the
 * COPY instructions, resolve the cross-package imports — direct AND reachable —
 * and refuse the build when a file the runtime needs is neither copied nor
 * copied to a path the import can resolve.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SERVICE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO_ROOT = resolve(SERVICE_DIR, "..", "..");
const RAILWAY_DOCKERFILE = join(REPO_ROOT, "backend", "Dockerfile");

/** The runtime WORKDIR of the image, so `/app/src/x`, `./src/x`, and `src/x` are one path. */
function fromImageRoot(value: string): string {
  return (
    value
      .replace(/^\.\//, "")
      .replace(/^\/+/, "")
      .replace(/^app\//, "")
      // A directory destination is written both ways (`./src/x` and `src/x/`),
      // and the coverage check compares path prefixes.
      .replace(/\/+$/, "") || "."
  );
}

interface CopyInstruction {
  /** Repo-relative sources; the last COPY token is the destination. */
  sources: string[];
  destination: string;
}

/**
 * Every COPY in a Dockerfile, with build flags (`--from=…`) dropped and line
 * continuations joined: a multi-line COPY is ONE instruction, and a staged
 * source (`/app/src/…`) names the same path the service's import resolves to.
 */
function copyInstructions(dockerfile: string): CopyInstruction[] {
  const instructions: CopyInstruction[] = [];
  for (const raw of dockerfile.replace(/\\\r?\n\s*/g, " ").split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("COPY ")) continue;
    const tokens = line
      .slice("COPY ".length)
      .trim()
      .split(/\s+/)
      .filter((token) => !token.startsWith("--"));
    const destination = tokens.pop();
    if (!destination || tokens.length === 0) continue;
    instructions.push({
      sources: tokens.map(fromImageRoot),
      destination: fromImageRoot(destination),
    });
  }
  return instructions;
}

function runtimeFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      // Tests never run in the image; only what the service loads matters.
      if (entry === "__tests__") return [];
      if (statSync(full).isDirectory()) return walk(full);
      return full.endsWith(".ts") ? [full] : [];
    });
  return walk(join(SERVICE_DIR, "src"));
}

const SPECIFIER_RE = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

interface CrossPackageImport {
  importer: string;
  specifier: string;
  /** Repo-relative path of the imported file. */
  target: string;
}

/**
 * The file a resolved relative specifier names.
 *
 * The service's imports are written both ways and both are legitimate at
 * runtime: with the `.js` suffix a TS/ESM source needs to name a `.ts` file
 * (`./storeRequest.js`), and extension-less the way `richContent.ts` names its
 * ingestion modules (`./ingestion/domain/imagePolicy`). The loader tries the
 * same candidates, so the test does too. A specifier that names nothing is not a
 * file the image could contain, so it is not a coverage answer either.
 */
function resolveImportedFile(resolved: string): string | null {
  const candidates = [
    resolved.replace(/\.js$/, ".ts"),
    resolved,
    `${resolved}.ts`,
    `${resolved}.tsx`,
    join(resolved, "index.ts"),
    join(resolved, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Imports of another repository file under `src/`, resolved from one importing file. */
function srcImportsIn(importer: string): CrossPackageImport[] {
  const found: CrossPackageImport[] = [];
  const source = readFileSync(importer, "utf8");
  for (const match of source.matchAll(SPECIFIER_RE)) {
    // `?? ""` satisfies noUncheckedIndexedAccess; an empty specifier cannot
    // start with "." and is skipped by the same guard as a bare package name.
    const specifier = match[1] ?? "";
    if (!specifier.startsWith(".")) continue;
    const resolved = resolve(dirname(importer), specifier);
    if (!resolved.startsWith(join(REPO_ROOT, "src"))) continue;
    const file = resolveImportedFile(resolved);
    if (file === null) continue;
    found.push({
      importer: relative(REPO_ROOT, importer),
      specifier,
      target: relative(REPO_ROOT, file),
    });
  }
  return found;
}

/**
 * Imports that leave this service's directory. The specifier is written with a
 * `.js` suffix (a TS/ESM requirement) while the file on disk is `.ts`.
 */
function crossPackageImports(): CrossPackageImport[] {
  return runtimeFiles().flatMap(srcImportsIn);
}

/**
 * Everything reachable from the runtime, not only the service's own imports: a
 * shared module that imports a fourth file drags that file into the container's
 * needs too, and only following the graph finds it.
 */
function reachableCrossPackageImports(): CrossPackageImport[] {
  const found = crossPackageImports();
  const visited = new Set<string>();
  const queue = found.map((entry) => entry.target);
  for (let target = queue.pop(); target !== undefined; target = queue.pop()) {
    if (visited.has(target)) continue;
    visited.add(target);
    for (const entry of srcImportsIn(join(REPO_ROOT, target))) {
      found.push(entry);
      queue.push(entry.target);
    }
  }
  return found;
}

/**
 * The files the image is missing, named with the importer and the specifier that
 * needs them — enough to fix it without opening the Dockerfile.
 */
function filesMissingFromImage(imports: CrossPackageImport[]): string[] {
  const copies = copyInstructions(readFileSync(RAILWAY_DOCKERFILE, "utf8"));
  return imports
    .filter((entry) => !isCopied(entry.target, copies))
    .map((entry) => `${entry.target} (imported by ${entry.importer} via ${entry.specifier})`);
}

/**
 * A file is in the image only if some COPY takes it from a source that contains
 * it AND lands it at the path the import resolves to. The destination half is
 * not decoration: a module copied to the wrong directory is exactly as missing
 * as one that was never copied, and it fails the same way at startup.
 *
 * A `COPY . .` in the build stage covers nothing here, because its destination
 * is the image root and its source is not a path prefix of the target — which is
 * the correct answer: the stage that has the file is not the stage that runs it.
 */
function isCopied(target: string, instructions: CopyInstruction[]): boolean {
  return instructions.some(
    (instruction) =>
      instruction.sources.some((source) => target === source || target.startsWith(`${source}/`)) &&
      (target === instruction.destination ||
        target.startsWith(`${instruction.destination}/`)),
  );
}

describe("co-editing service image", () => {
  it("has cross-package imports for this check to protect", () => {
    const imports = crossPackageImports();
    // If the regex or the directory walk breaks, the real assertion below would
    // pass against an empty list — so the check asserts what it inspected.
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.every((entry) => existsSync(join(REPO_ROOT, entry.target)))).toBe(true);
    expect(imports.map((entry) => entry.target)).toContain(
      "src/features/exam-authoring/realtime/coedit/workspaceCommands.ts",
    );
  });

  it("copies every file the service imports from outside its directory", () => {
    expect(filesMissingFromImage(crossPackageImports())).toEqual([]);
  });

  it("copies everything reachable from the runtime, not only its direct imports", () => {
    const reachable = reachableCrossPackageImports();
    // The walk must reach further than the direct imports, or this test would
    // only restate the one above.
    expect(reachable.length).toBeGreaterThan(crossPackageImports().length);
    expect(filesMissingFromImage(reachable)).toEqual([]);
  });

  it("runs Hocuspocus with the Node runtime instead of Bun", () => {
    const dockerfile = readFileSync(RAILWAY_DOCKERFILE, "utf8");
    expect(dockerfile).toContain("FROM node:22-bookworm-slim AS runner");
    expect(dockerfile).toContain(
      "/usr/local/bin/node /app/node_modules/tsx/dist/cli.mjs /app/services/authoring-coedit/src/main.ts &",
    );
    expect(dockerfile).not.toContain(
      "/usr/local/bin/bun run /app/services/authoring-coedit/src/main.ts &",
    );
  });
});

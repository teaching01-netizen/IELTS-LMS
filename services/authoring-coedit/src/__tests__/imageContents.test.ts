/**
 * The image has to contain everything the service imports.
 *
 * This service deliberately imports across the package boundary — the DOM-free
 * rich-text schema, the shared workspace-command envelope, the assessment
 * contracts — so both ends of a wire format share ONE definition. Those imports
 * resolve everywhere except in the container, because the Dockerfile is the only
 * place that records which outside files travel into the image, and nothing else
 * reads it.
 *
 * That is not hypothetical: collapsing the two command-envelope validators moved
 * a browser import into `main.ts`, the image kept its old COPY list, and the
 * containerized entry point failed to resolve `workspaceCommands.js` — invisible
 * to typecheck, to every suite, and to `bun run coedit:service`, which resolves
 * from the repository checkout. This test performs the container's check without
 * a container: parse the COPY sources, resolve the cross-package imports, and
 * refuse the build when a file the runtime needs is not in the image.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SERVICE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO_ROOT = resolve(SERVICE_DIR, "..", "..");

/** COPY sources, repo-relative. The final token of each COPY is its destination. */
function copiedSources(): string[] {
  const dockerfile = readFileSync(join(SERVICE_DIR, "Dockerfile"), "utf8");
  const sources: string[] = [];
  for (const raw of dockerfile.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("COPY ")) continue;
    const tokens = line.slice("COPY ".length).trim().split(/\s+/);
    sources.push(...tokens.slice(0, -1));
  }
  return sources;
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
 * Imports that leave this service's directory. The specifier is written with a
 * `.js` suffix (a TS/ESM requirement) while the file on disk is `.ts`.
 */
function crossPackageImports(): CrossPackageImport[] {
  const found: CrossPackageImport[] = [];
  for (const importer of runtimeFiles()) {
    const source = readFileSync(importer, "utf8");
    for (const match of source.matchAll(SPECIFIER_RE)) {
      // `?? ""` satisfies noUncheckedIndexedAccess; an empty specifier cannot
      // start with "." and is skipped by the same guard as a bare package name.
      const specifier = match[1] ?? "";
      if (!specifier.startsWith(".")) continue;
      const resolved = resolve(dirname(importer), specifier);
      if (!resolved.startsWith(join(REPO_ROOT, "src"))) continue;
      const asTs = resolved.replace(/\.js$/, ".ts");
      const file = existsSync(asTs) ? asTs : resolved;
      found.push({
        importer: relative(REPO_ROOT, importer),
        specifier,
        target: relative(REPO_ROOT, file),
      });
    }
  }
  return found;
}

function isCopied(target: string, copies: string[]): boolean {
  return copies.some((copy) => target === copy || target.startsWith(`${copy}/`));
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
    const copies = copiedSources();
    const missing = crossPackageImports()
      .filter((entry) => !isCopied(entry.target, copies))
      .map((entry) => `${entry.target} (imported by ${entry.importer} via ${entry.specifier})`);
    expect(missing).toEqual([]);
  });
});

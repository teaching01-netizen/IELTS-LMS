/**
 * The co-edit runtime manifest, in ONE place.
 *
 * The backend image does not ship the repository. `backend/Dockerfile` copies an
 * explicit allowlist of sources into the `runner` stage, because the co-edit
 * service runs the shared rich-text schema under Node (Hocuspocus, not the SPA)
 * and the image exists to be small and deliberate. Two things used to record
 * that allowlist independently: the hand-typed COPY lines in the Dockerfile and
 * the tests that read them back. Neither was the source, so they drifted, and
 * the class of bug that followed is expensive: a path the runtime imports but
 * the image lacks is invisible to typecheck, to every suite, and to
 * `bun run coedit:service` (which resolves from the checkout) — it only fails
 * inside the container, as `ERR_MODULE_NOT_FOUND`, after `api: listening`, and
 * `start.sh` tears the container down, so it crash-loops. That has happened
 * three times; the most recent outage was one new module in the schema graph.
 *
 * So the truth lives in `backend/coedit-runtime-manifest.json`, and everything
 * else is derived from it:
 *
 *   backend/coedit-runtime-manifest.json      <- the only hand-edited list
 *            |  `bun run coedit:manifest`
 *            v
 *   backend/Dockerfile   (generated COPY block between the markers below)
 *            |  src/test/architecture/coedit-runtime-manifest.test.ts
 *            v
 *   fails when the block and the manifest disagree, when a shipped path does
 *   not exist, or when a module the runtime reaches is not shipped.
 *
 * Both halves live here so the generator and the guards cannot drift either:
 * there is one renderer, one reader, and one reachability walk.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** The repository root. Anchored to this file, so any cwd works. */
export const REPO_ROOT = resolve(MODULE_DIR, "..", "..");

/** The single source of truth: the shipped-source allowlist. */
export const MANIFEST_PATH = "backend/coedit-runtime-manifest.json";

/** The artifact generated from the manifest. */
export const DOCKERFILE_PATH = "backend/Dockerfile";

/** The Docker stage whose filesystem the runtime stage copies from. */
export const RUNTIME_BUILD_STAGE = "frontend-builder";

/**
 * Marker lines delimiting the generated block. Everything between them belongs
 * to the manifest — `applyRuntimeCopyBlock` rewrites that range and nothing else.
 */
export const RUNTIME_COPY_BLOCK_BEGIN = "# coedit-runtime-manifest:begin";
export const RUNTIME_COPY_BLOCK_END = "# coedit-runtime-manifest:end";

/** The co-edit runtime's entry point, as `start.sh` invokes it. */
export const COEDIT_ENTRY = "services/authoring-coedit/src/main.ts";

export interface CoeditRuntimeManifest {
  /** Repo-relative path of the manifest, so error messages can name it. */
  readonly path: string;
  /** Repo-relative POSIX paths, sorted, each an existing file or directory. */
  readonly sources: readonly string[];
}

export interface RuntimeShipTargets {
  /** Shipped paths that are files. */
  readonly files: ReadonlySet<string>;
  /** Shipped paths that are directories, each with a trailing slash. */
  readonly directories: readonly string[];
}

function toPosix(value: string): string {
  return value.replaceAll(sep, "/");
}

function isDirectory(absolutePath: string): boolean {
  return existsSync(absolutePath) && statSync(absolutePath).isDirectory();
}

function isFile(absolutePath: string): boolean {
  return existsSync(absolutePath) && statSync(absolutePath).isFile();
}

/**
 * Validates one manifest entry.
 *
 * Returns the reason it cannot be shipped, or `null`. Each check exists to turn
 * a class of silent misconfiguration into a message that names the fix: an
 * absolute path or a `..` segment writes outside the image root, a trailing
 * slash stops the generator's source and destination from matching, a
 * `./` prefix makes two entries for one path, and an unknown key means the
 * list was mistyped and shipped nothing.
 */
function rejectSource(source: unknown, index: number): string | null {
  if (typeof source !== "string" || source.trim().length === 0) {
    return `sources[${index}] is not a non-empty string`;
  }
  if (source.startsWith("/") || source.startsWith("./") || source.includes("\\")) {
    return `sources[${index}] (${source}) must be a clean repo-relative path, e.g. src/features/…`;
  }
  if (source.split("/").includes("..")) {
    return `sources[${index}] (${source}) must not climb out of the repository root`;
  }
  if (source.endsWith("/")) {
    return `sources[${index}] (${source}) must not end with "/": the generator copies each entry to the same absolute path`;
  }
  if (!isDirectory(join(REPO_ROOT, source)) && !isFile(join(REPO_ROOT, source))) {
    return `sources[${index}] (${source}) does not exist, so nothing would be copied`;
  }
  return null;
}

function readManifestDocument(manifestPath: string): Record<string, unknown> {
  const absolute = join(REPO_ROOT, manifestPath);
  if (!isFile(absolute)) {
    throw new Error(
      `${manifestPath} is missing. It is the single source of truth for the sources the co-edit runtime ships; restore it before touching ${DOCKERFILE_PATH}.`,
    );
  }

  const parsed: unknown = JSON.parse(readFileSync(absolute, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${manifestPath} must contain a JSON object.`);
  }

  const document = parsed as Record<string, unknown>;
  const unknownKeys = Object.keys(document).filter((key) => key !== "//" && key !== "sources");
  if (unknownKeys.length > 0) {
    throw new Error(
      `${manifestPath} has unknown key(s): ${unknownKeys.join(", ")}. Only "//" and "sources" are read, so a typo here would silently un-ship a path.`,
    );
  }
  return document;
}

/**
 * Reads and validates the manifest.
 *
 * Throws with an actionable message instead of returning a partial list —
 * every caller here is a guard or the generator, and both would rather fail
 * loudly than ship a shorter allowlist than intended.
 */
export function readCoeditRuntimeManifest(
  manifestPath: string = MANIFEST_PATH,
): CoeditRuntimeManifest {
  const document = readManifestDocument(manifestPath);
  const sources = document["sources"];

  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error(`${manifestPath} must have a non-empty "sources" array.`);
  }

  const rejections: string[] = [];
  const paths: string[] = [];
  sources.forEach((source, index) => {
    const rejection = rejectSource(source, index);
    if (rejection !== null) {
      rejections.push(rejection);
      return;
    }
    paths.push(source as string);
  });
  if (rejections.length > 0) {
    throw new Error(`${manifestPath} is not shippable:\n  ${rejections.join("\n  ")}`);
  }

  const duplicates = paths.filter((path, index) => paths.indexOf(path) !== index);
  if (duplicates.length > 0) {
    throw new Error(`${manifestPath} lists the same path twice: ${duplicates.join(", ")}`);
  }

  // Sorted is not cosmetic: the generator renders in manifest order, so an
  // out-of-order entry would show up as a diff noise in every future edit and
  // make a real change hard to spot in review.
  const sorted = [...paths].sort();
  if (paths.some((path, index) => path !== sorted[index])) {
    throw new Error(
      `${manifestPath} must stay sorted (${paths.join(", ")}). Keeping it sorted keeps the generated ${DOCKERFILE_PATH} block stable: append with the sort order in mind.`,
    );
  }

  return { path: manifestPath, sources: paths };
}

/**
 * Splits the manifest into shipped files and shipped directories.
 *
 * A directory entry ships everything beneath it, which is deliberate slack:
 * reachability is computed from static imports, and a runtime-loaded asset or a
 * dynamically-specified module would not show up as an edge. Callers that ask
 * "is this path in the image?" need the directory form to answer yes for
 * siblings of a module that is imported.
 */
export function runtimeShipTargets(
  manifest: CoeditRuntimeManifest = readCoeditRuntimeManifest(),
): RuntimeShipTargets {
  const files = new Set<string>();
  const directories: string[] = [];
  for (const source of manifest.sources) {
    if (isDirectory(join(REPO_ROOT, source))) {
      directories.push(`${source}/`);
    } else {
      files.add(source);
    }
  }
  return { files, directories };
}

/** Whether the image contains `target` (a repo-relative POSIX path). */
export function isShippedRuntimeSource(target: string, targets: RuntimeShipTargets): boolean {
  if (targets.files.has(target)) {
    return true;
  }
  return targets.directories.some((directory) => target.startsWith(directory));
}

/**
 * The COPY instruction for one shipped source.
 *
 * Source and destination are the same path so a shipped path always lands where
 * the runtime's import resolves it. That is why the guard no longer has to check
 * destinations: with a generated block, a wrong destination is unrepresentable.
 */
export function runtimeCopyInstruction(source: string): string {
  return `COPY --from=${RUNTIME_BUILD_STAGE} /app/${source} /app/${source}`;
}

/**
 * The generated block's body: the explanation, then one COPY per source.
 *
 * The explanation is generated too, so nobody has to remember to keep it true.
 */
export function renderRuntimeCopyBlockBody(
  manifest: CoeditRuntimeManifest = readCoeditRuntimeManifest(),
): string[] {
  return [
    `# Generated from ${manifest.path} — do not hand-edit.`,
    "# Regenerate with `bun run coedit:manifest`;",
    "# src/test/architecture/coedit-runtime-manifest.test.ts fails when this block",
    "# and the manifest disagree, so a missing path cannot reach production.",
    ...manifest.sources.map(runtimeCopyInstruction),
  ];
}

function markerIndexes(lines: readonly string[]): { begin: number; end: number } {
  const begin = lines.findIndex((line) => line.trim() === RUNTIME_COPY_BLOCK_BEGIN);
  const end = lines.findIndex((line) => line.trim() === RUNTIME_COPY_BLOCK_END);
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error(
      `${DOCKERFILE_PATH} must delimit the generated block with "${RUNTIME_COPY_BLOCK_BEGIN}" and "${RUNTIME_COPY_BLOCK_END}" (found begin=${begin}, end=${end}). Run \`bun run coedit:manifest\` to regenerate it.`,
    );
  }
  return { begin, end };
}

/** The body lines currently between the markers, markers excluded. */
export function readRuntimeCopyBlockBody(dockerfileText: string): string[] {
  const lines = dockerfileText.split("\n");
  const { begin, end } = markerIndexes(lines);
  return lines
    .slice(begin + 1, end)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** The Dockerfile with the generated block replaced by the manifest's rendering. */
export function applyRuntimeCopyBlock(
  dockerfileText: string,
  manifest: CoeditRuntimeManifest = readCoeditRuntimeManifest(),
): string {
  const lines = dockerfileText.split("\n");
  const { begin, end } = markerIndexes(lines);
  return [
    ...lines.slice(0, begin + 1),
    ...renderRuntimeCopyBlockBody(manifest),
    ...lines.slice(end),
  ].join("\n");
}

/**
 * COPY instructions that ship repository sources from OUTSIDE the generated
 * block.
 *
 * This is what keeps the manifest the single source of truth: a second list
 * cannot be added quietly next to the generated one, because the next guard run
 * names it.
 */
export function handWrittenRuntimeCopyLines(dockerfileText: string): string[] {
  const lines = dockerfileText.split("\n");
  const { begin, end } = markerIndexes(lines);
  return lines.filter((line, index) => {
    if (index > begin && index < end) {
      return false;
    }
    const trimmed = line.trim();
    if (!trimmed.startsWith("COPY ") || trimmed.startsWith("#")) {
      return false;
    }
    return /\s\/app\/(?:src|services)\/\S+/.test(trimmed);
  });
}

/** Resolves a relative specifier the way the TypeScript loader does. */
function resolveRuntimeModule(fromFile: string, specifier: string): string | null {
  const base = resolve(REPO_ROOT, dirname(fromFile), specifier);
  const candidates = specifier.endsWith(".js")
    ? [`${base.slice(0, -3)}.ts`, `${base.slice(0, -3)}.tsx`, base]
    : [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
  for (const candidate of candidates) {
    if (isFile(candidate)) {
      const repoRelative = toPosix(relative(REPO_ROOT, candidate));
      if (!repoRelative.startsWith("..")) {
        return repoRelative;
      }
    }
  }
  return null;
}

/**
 * Relative specifiers in one file, parsed rather than pattern-matched: a path
 * that only appears in a comment or a string is not an import, and this list
 * decides whether the image can start.
 */
function relativeSpecifiersIn(file: string): string[] {
  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(join(REPO_ROOT, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers: string[] = [];

  const collect = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = node.moduleSpecifier;
      if (specifier !== undefined && ts.isStringLiteral(specifier)) {
        specifiers.push(specifier.text);
      }
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const first = node.arguments[0];
      if (first !== undefined && ts.isStringLiteral(first)) {
        specifiers.push(first.text);
      }
    }
    node.forEachChild(collect);
  };
  collect(sourceFile);

  return [...new Set(specifiers)].filter((specifier) => specifier.startsWith(".")).sort();
}

export interface RuntimeModuleGap {
  /** Repo-relative path of the unshipped module. */
  readonly target: string;
  /** Repo-relative path of the module that reaches it. */
  readonly importer: string;
  /** The specifier that reaches it, so the fix needs no search. */
  readonly specifier: string;
}

/**
 * Every module the runtime reaches that the manifest does not ship.
 *
 * Walks the real import graph from the entry point, including edges reached
 * through shared modules — a fourth file pulled in by a third one needs to be in
 * the image just as much as the second does. Dynamic `import()` with a literal
 * specifier is an edge; one with a computed specifier is not, which is why the
 * manifest ships directories rather than only the files it can see.
 */
export function findUnshippedRuntimeModules(
  manifest: CoeditRuntimeManifest = readCoeditRuntimeManifest(),
  entry: string = COEDIT_ENTRY,
): RuntimeModuleGap[] {
  const targets = runtimeShipTargets(manifest);
  const gaps: RuntimeModuleGap[] = [];
  const visited = new Set<string>([entry]);
  const queue: string[] = [entry];

  for (let current = queue.pop(); current !== undefined; current = queue.pop()) {
    for (const specifier of relativeSpecifiersIn(current)) {
      const target = resolveRuntimeModule(current, specifier);
      if (target === null || visited.has(target)) {
        continue;
      }
      visited.add(target);
      queue.push(target);
      if (!isShippedRuntimeSource(target, targets)) {
        gaps.push({ target, importer: current, specifier });
      }
    }
  }

  return gaps.sort((left, right) => left.target.localeCompare(right.target));
}

/**
 * The entry graph, as repo-relative paths. Exported so a guard can prove the
 * walk inspected something and still reaches the module whose missing COPY took
 * production down.
 */
export function reachableRuntimeModules(entry: string = COEDIT_ENTRY): string[] {
  const reached = new Set<string>([entry]);
  const queue: string[] = [entry];
  for (let current = queue.pop(); current !== undefined; current = queue.pop()) {
    for (const specifier of relativeSpecifiersIn(current)) {
      const target = resolveRuntimeModule(current, specifier);
      if (target === null || reached.has(target)) {
        continue;
      }
      reached.add(target);
      queue.push(target);
    }
  }
  return [...reached].sort();
}

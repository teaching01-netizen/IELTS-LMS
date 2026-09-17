import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COEDIT_ENTRY,
  DOCKERFILE_PATH,
  MANIFEST_PATH,
  REPO_ROOT,
  applyRuntimeCopyBlock,
  findUnshippedRuntimeModules,
  handWrittenRuntimeCopyLines,
  readCoeditRuntimeManifest,
  readRuntimeCopyBlockBody,
  reachableRuntimeModules,
  renderRuntimeCopyBlockBody,
  runtimeCopyInstruction,
  type CoeditRuntimeManifest,
  type RuntimeModuleGap,
} from "../../../backend/scripts/coeditRuntimeManifest";

/**
 * The co-edit runtime travels in the backend image with an explicit allowlist of
 * sources, because the service runs the shared rich-text schema under Node
 * (Hocuspocus, not the SPA). That allowlist is
 * `backend/coedit-runtime-manifest.json` and nothing else: the Dockerfile's COPY
 * block is generated from it, and this guard is why the two cannot drift.
 *
 * Three failures are covered here, each of which has happened in production:
 *
 *  1. The Dockerfile's block disagrees with the manifest (a hand-edited COPY
 *     line, or a path added without regenerating).
 *  2. A runtime import is not shipped, so the container cannot resolve it. That
 *     is invisible to typecheck, to every suite, and to `bun run coedit:service`
 *     — all of which resolve from the checkout. It fails only inside the image,
 *     at import time, and `start.sh` then tears the container down, so the
 *     service crash-loops.
 *  3. A second, hand-written list appears beside the generated one.
 *
 * The generator and these assertions share one implementation
 * (`backend/scripts/coeditRuntimeManifest.ts`), so the guard cannot drift from
 * the script that writes the Dockerfile either.
 */
const manifest = readCoeditRuntimeManifest();
const dockerfile = readFileSync(join(REPO_ROOT, DOCKERFILE_PATH), "utf8");

const REGENERATE = `run \`bun run coedit:manifest\` and commit the result`;

function formatGaps(gaps: readonly RuntimeModuleGap[]): string {
  return [
    `These modules are reachable from ${COEDIT_ENTRY} but are not shipped to the image.`,
    `Add their paths to ${MANIFEST_PATH}, then ${REGENERATE}:`,
    ...gaps.map((gap) => `${gap.target} (imported by ${gap.importer} via ${gap.specifier})`),
  ].join("\n");
}

/** A manifest outside the repository, so validation is exercised without writing into it. */
function tempManifestPath(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), "coedit-runtime-manifest-"));
  const file = join(directory, "manifest.json");
  writeFileSync(file, contents);
  return relative(REPO_ROOT, file);
}

describe("co-edit runtime manifest", () => {
  it("states what ships, and nothing else does", () => {
    // Reading validates every entry: a typo, a `..` escape, an unsorted list, a
    // duplicate or a mistyped key throws instead of quietly shipping less than
    // intended.
    expect(manifest.path).toBe(MANIFEST_PATH);
    expect(manifest.sources.length).toBeGreaterThan(2);
    // The directory whose new module dangled in production (`schema/imageNode.ts`).
    expect(manifest.sources).toContain("src/features/exam-authoring/editor/schema");
  });

  it("agrees with the Dockerfile block generated from it", () => {
    expect(
      readRuntimeCopyBlockBody(dockerfile),
      `${DOCKERFILE_PATH} is stale: ${REGENERATE}.`
    ).toEqual(renderRuntimeCopyBlockBody(manifest));
  });

  it("has no hand-written COPY shipping repository sources beside the generated block", () => {
    expect(
      handWrittenRuntimeCopyLines(dockerfile),
      "Move these lines into the generated block by adding their paths to the manifest and running `bun run coedit:manifest`."
    ).toEqual([]);
  });

  it("walks a real graph, including the schema the service converts documents with", () => {
    const reached = reachableRuntimeModules();
    // Without this, a resolution change would let the coverage check below pass
    // against an empty edge set.
    expect(reached.length).toBeGreaterThan(10);
    expect(reached).toContain("src/features/exam-authoring/editor/schema/imageNode.ts");
    expect(reached).toContain("src/features/exam-authoring/realtime/coedit/workspaceCommands.ts");
  });

  it("ships every module the runtime reaches", () => {
    const gaps = findUnshippedRuntimeModules();
    expect(
      gaps.map((gap) => gap.target),
      formatGaps(gaps)
    ).toEqual([]);
  });

  it("would fail if a reached module were dropped from the manifest", () => {
    const withoutSchema: CoeditRuntimeManifest = {
      path: MANIFEST_PATH,
      sources: manifest.sources.filter(
        (source) => source !== "src/features/exam-authoring/editor/schema"
      ),
    };
    const missing = findUnshippedRuntimeModules(withoutSchema).map((gap) => gap.target);
    expect(missing).toContain("src/features/exam-authoring/editor/schema/imageNode.ts");
  });

  it("renders each shipped source to the same path it comes from", () => {
    // Destination correctness is what a generated block buys: an import resolves
    // to `/app/<path>`, and the instruction lands the file exactly there.
    for (const source of manifest.sources) {
      expect(runtimeCopyInstruction(source)).toBe(
        `COPY --from=frontend-builder /app/${source} /app/${source}`
      );
    }
  });

  it("rewrites only the generated block when the manifest grows", () => {
    // A path that can never legitimately be shipped, so this test does not break
    // when the real manifest grows.
    const addedSource = "src/__manifest-fixture__";
    const grown: CoeditRuntimeManifest = {
      path: MANIFEST_PATH,
      sources: [...manifest.sources, addedSource].sort(),
    };
    const regenerated = applyRuntimeCopyBlock(dockerfile, grown);
    const lines = dockerfile.split("\n");
    const added = regenerated.split("\n").filter((line) => !lines.includes(line));

    expect(added).toEqual([runtimeCopyInstruction(addedSource)]);
    // The manifest's order is the rendered order, which is why it is kept sorted.
    expect(renderRuntimeCopyBlockBody(grown).filter((line) => line.startsWith("COPY"))).toEqual(
      grown.sources.map(runtimeCopyInstruction)
    );
  });

  it("refuses to act on a Dockerfile whose markers are gone", () => {
    expect(() => readRuntimeCopyBlockBody("FROM node:22-bookworm-slim AS runner\n")).toThrow(
      /coedit-runtime-manifest:begin/
    );
  });

  it("detects a second, hand-written copy of repository sources", () => {
    const handWritten =
      "COPY --from=frontend-builder /app/src/features/exam-authoring/editor/schema /app/src/features/exam-authoring/editor/schema";
    const synthetic = [
      "FROM node:22-bookworm-slim AS runner",
      "# coedit-runtime-manifest:begin",
      "COPY --from=frontend-builder /app/services/authoring-coedit/src /app/services/authoring-coedit/src",
      "# coedit-runtime-manifest:end",
      handWritten,
      "COPY backend/go/migrations /app/migrations",
    ].join("\n");

    expect(handWrittenRuntimeCopyLines(synthetic)).toEqual([handWritten]);
  });
});

describe("manifest validation", () => {
  const source = "src/features/exam-authoring/contracts";

  it("rejects anything that would ship less than intended", () => {
    const cases: ReadonlyArray<{ name: string; contents: string; expected: RegExp }> = [
      {
        name: "a mistyped key",
        contents: JSON.stringify({ "//": "note", source: [source] }),
        expected: /unknown key/,
      },
      {
        name: "an empty list",
        contents: JSON.stringify({ sources: [] }),
        expected: /non-empty "sources"/,
      },
      {
        name: "a duplicate",
        contents: JSON.stringify({ sources: [source, source] }),
        expected: /the same path twice/,
      },
      {
        name: "an unsorted list",
        contents: JSON.stringify({ sources: [source, "services/authoring-coedit/src"] }),
        expected: /must stay sorted/,
      },
      {
        name: "a path that climbs out of the repository",
        contents: JSON.stringify({ sources: [`../${source}`] }),
        expected: /must not climb out/,
      },
      {
        name: "a path that does not exist",
        contents: JSON.stringify({ sources: ["src/features/exam-authoring/does-not-exist"] }),
        expected: /does not exist/,
      },
    ];

    for (const { name, contents, expected } of cases) {
      expect(() => readCoeditRuntimeManifest(tempManifestPath(contents)), name).toThrow(expected);
    }
  });

  it("rejects a missing manifest instead of shipping an empty list", () => {
    const absent = join(dirname(tempManifestPath("{}")), "absent.json");
    expect(() => readCoeditRuntimeManifest(absent)).toThrow(/is missing/);
  });

  it("accepts a valid manifest", () => {
    const accepted = readCoeditRuntimeManifest(
      tempManifestPath(JSON.stringify({ "//": "note", sources: [source] }))
    );
    expect(accepted.sources).toEqual([source]);
  });
});

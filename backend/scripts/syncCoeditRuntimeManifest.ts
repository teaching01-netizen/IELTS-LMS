/**
 * Regenerates the Dockerfile's co-edit runtime block from the manifest.
 *
 * `backend/Dockerfile` is the only place that states which outside sources the
 * co-edit runtime travels with, and it is no longer hand-edited: this writes the
 * block between the manifest markers from `backend/coedit-runtime-manifest.json`.
 *
 *   bun run coedit:manifest           # write the Dockerfile block
 *   bun run coedit:manifest --check   # fail when it is stale (no writes)
 *
 * `--check` is what a review gate would run; the architecture guard
 * (`src/test/architecture/coedit-runtime-manifest.test.ts`) already asserts the
 * same thing on every test run, so drift is caught even when nobody remembers
 * this script.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DOCKERFILE_PATH,
  MANIFEST_PATH,
  REPO_ROOT,
  applyRuntimeCopyBlock,
  readCoeditRuntimeManifest,
  readRuntimeCopyBlockBody,
  renderRuntimeCopyBlockBody,
} from "./coeditRuntimeManifest";

function added(lines: readonly string[], current: readonly string[]): string[] {
  return lines.filter((line) => !current.includes(line));
}

function removed(lines: readonly string[], current: readonly string[]): string[] {
  return current.filter((line) => !lines.includes(line));
}

const checkOnly = process.argv.includes("--check");
const manifest = readCoeditRuntimeManifest();
const dockerfilePath = join(REPO_ROOT, DOCKERFILE_PATH);
const current = readFileSync(dockerfilePath, "utf8");
const next = applyRuntimeCopyBlock(current, manifest);

if (next === current) {
  console.log(
    `${DOCKERFILE_PATH} already matches ${MANIFEST_PATH} (${manifest.sources.length} shipped sources).`,
  );
  process.exit(0);
}

const before = readRuntimeCopyBlockBody(current);
const after = renderRuntimeCopyBlockBody(manifest);
console.log(`+ ${added(after, before).join("\n+ ")}`);
console.log(`- ${removed(after, before).join("\n- ")}`);

if (checkOnly) {
  console.error(
    `\n${DOCKERFILE_PATH} is stale: run \`bun run coedit:manifest\` and commit the result.`,
  );
  process.exit(1);
}

writeFileSync(dockerfilePath, next);
console.log(`\nRewrote the co-edit runtime block in ${DOCKERFILE_PATH} from ${MANIFEST_PATH}.`);

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * P0-1 bundle-isolation guard (static level).
 *
 * The mock-level suite (`StudentSessionRoute.bundle.test.tsx`) proves the
 * router resolves branches lazily, but its `vi.mock` calls replace the branch
 * modules wholesale — a static `import { StudentAppWrapper } from ...` added
 * inside `SatStudentDeliveryBranch` would pass that suite while merging both
 * provider runtimes back into one chunk. These assertions read the real source
 * and pin the dependency boundary from both sides:
 *
 *   StudentSessionRoute  ->  lazy() only, plus small shared surfaces
 *   SatStudentDeliveryBranch  ->  SAT tree only, never IELTS delivery
 *   IeltsStudentDeliveryBranch  ->  IELTS tree only, never student-delivery
 *
 * Type-only imports (`import type`) are ignored: they are erased at compile
 * time and cannot merge chunks. The production-manifest gate
 * (`bun run test:student-bundle`) proves the same boundary at chunk level.
 */
const here = dirname(fileURLToPath(import.meta.url));
const ROUTER = join(here, "..", "StudentSessionRoute.tsx");
const SAT_BRANCH = join(here, "..", "SatStudentDeliveryBranch.tsx");
const IELTS_BRANCH = join(here, "..", "IeltsStudentDeliveryBranch.tsx");

/** Static (non-lazy) module specifiers in a source file. */
function staticImportSpecifiers(source: string): string[] {
  // Type-only imports vanish before bundling and cannot merge chunks.
  const noTypes = source.replace(/import\s+type\s+[\s\S]*?;/g, "");
  // Dynamic import() is the lazy boundary itself, not a static edge.
  const noDynamic = noTypes.replace(/import\s*\(/g, "dynamicImport(");
  const specs: string[] = [];
  const fromRe = /\bfrom\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = fromRe.exec(noDynamic)) !== null) specs.push(match[1]);
  const sideEffectRe = /^\s*import\s*['"]([^'"]+)['"]/gm;
  while ((match = sideEffectRe.exec(noDynamic)) !== null) specs.push(match[1]);
  return specs;
}

function readStaticImports(path: string): string[] {
  return staticImportSpecifiers(readFileSync(path, "utf8"));
}

describe("student provider bundle boundary (static imports)", () => {
  it("routes providers through React.lazy, never static imports", () => {
    const source = readFileSync(ROUTER, "utf8");
    expect(source).toContain("import('./SatStudentDeliveryBranch')");
    expect(source).toContain("import('./IeltsStudentDeliveryBranch')");
    expect(source).toContain("React.lazy");

    const specs = readStaticImports(ROUTER);
    for (const spec of specs) {
      expect(spec, `router statically imports provider code: ${spec}`).not.toMatch(
        /SatStudentDeliveryBranch|IeltsStudentDeliveryBranch|StudentAppWrapper|SatStudentSessionRoute|@components\/student/
      );
    }
    // The only student-delivery module the thin router may touch statically
    // is the small loading surface (the resume locator stays a dynamic
    // import on the exit path so it never joins the router chunk).
    const deliveryStatics = specs.filter((spec) => spec.includes("student-delivery"));
    expect(deliveryStatics).toEqual(["../../student-delivery/api/satStateSurfaces"]);
  });

  it("keeps the SAT branch out of the IELTS delivery tree", () => {
    const specs = readStaticImports(SAT_BRANCH);
    // Positive pin: the branch exists to mount the SAT route.
    expect(
      specs.some((spec) => spec.endsWith("student-delivery/routes/SatStudentSessionRoute"))
    ).toBe(true);
    for (const spec of specs) {
      expect(spec, `SAT branch statically imports IELTS delivery: ${spec}`).not.toMatch(
        /StudentAppWrapper|IeltsStudentDeliveryBranch|@components\/student/
      );
    }
  });

  it("keeps the IELTS branch out of the SAT delivery tree", () => {
    const specs = readStaticImports(IELTS_BRANCH);
    // Positive pin: the branch exists to mount the IELTS wrapper.
    expect(specs.some((spec) => spec.endsWith("StudentAppWrapper"))).toBe(true);
    for (const spec of specs) {
      expect(spec, `IELTS branch statically imports SAT delivery: ${spec}`).not.toMatch(
        /student-delivery|SatStudent/
      );
    }
  });
});

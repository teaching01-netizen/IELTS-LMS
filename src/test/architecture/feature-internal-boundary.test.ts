import { describe, expect, it } from "vitest";
import {
  collectFeatureInternalBoundaryViolations,
  findNewArchitectureViolations,
  formatArchitectureViolations,
  loadArchitectureBaseline,
  readProductionSourceFiles,
} from "./architectureTestUtils";

/**
 * The UI → infrastructure edge, which the other guards cannot see.
 *
 * `layer-dependencies` describes layers inside a feature; `feature-isolation`
 * only compares two files that are both under `src/features/`. A legacy
 * consumer in `components/` or `utils/` reaching into a feature's
 * `infrastructure/` therefore passed every guard — and twenty-odd of them did.
 *
 * The rule is scoped to the audited feature (see the collector) and the
 * baseline is empty: this feature's consumers now go through its `api/` entry
 * points, so any future bypass fails here instead of being discovered as a
 * direction-of-dependency surprise.
 */
describe("feature internal boundary", () => {
  it("does not let consumers outside a feature import its internals directly", () => {
    const violations = findNewArchitectureViolations(
      collectFeatureInternalBoundaryViolations(readProductionSourceFiles()),
      loadArchitectureBaseline()
    );

    expect(violations, formatArchitectureViolations(violations)).toEqual([]);
  });
});

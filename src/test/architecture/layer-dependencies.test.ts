import { describe, expect, it } from 'vitest';
import {
  findNewArchitectureViolations,
  formatArchitectureViolations,
  collectLayerDependencyViolations,
  loadArchitectureBaseline,
  readProductionSourceFiles,
} from './architectureTestUtils';

describe('frontend layer dependencies', () => {
  it('does not add dependencies outside the permitted layer direction', () => {
    const violations = findNewArchitectureViolations(
      collectLayerDependencyViolations(readProductionSourceFiles()),
      loadArchitectureBaseline(),
    );

    expect(violations, formatArchitectureViolations(violations)).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  collectFeatureIsolationViolations,
  findNewArchitectureViolations,
  formatArchitectureViolations,
  loadArchitectureBaseline,
  readProductionSourceFiles,
} from './architectureTestUtils';

describe('feature isolation', () => {
  it('does not add imports across feature internals', () => {
    const violations = findNewArchitectureViolations(
      collectFeatureIsolationViolations(readProductionSourceFiles()),
      loadArchitectureBaseline(),
    );

    expect(violations, formatArchitectureViolations(violations)).toEqual([]);
  });
});

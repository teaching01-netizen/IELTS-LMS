import { describe, expect, it } from 'vitest';
import {
  collectForbiddenBrowserBoundaryViolations,
  findNewArchitectureViolations,
  formatArchitectureViolations,
  loadArchitectureBaseline,
  readProductionSourceFiles,
} from './architectureTestUtils';

describe('domain and application boundaries', () => {
  it('does not add framework or browser dependencies to domain/application code', () => {
    const violations = findNewArchitectureViolations(
      collectForbiddenBrowserBoundaryViolations(readProductionSourceFiles()),
      loadArchitectureBaseline(),
    );

    expect(violations, formatArchitectureViolations(violations)).toEqual([]);
  });
});

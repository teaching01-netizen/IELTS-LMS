import { describe, expect, it } from 'vitest';
import {
  collectDomainPurityViolations,
  findNewArchitectureViolations,
  formatArchitectureViolations,
  loadArchitectureBaseline,
  readProductionSourceFiles,
} from './architectureTestUtils';

describe('feature domain purity', () => {
  it('does not add framework, browser, or service dependencies to domain code', () => {
    const violations = findNewArchitectureViolations(
      collectDomainPurityViolations(readProductionSourceFiles()),
      loadArchitectureBaseline(),
    );

    expect(violations, formatArchitectureViolations(violations)).toEqual([]);
  });
});

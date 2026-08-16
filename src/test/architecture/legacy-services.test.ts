import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectLegacyServiceViolations,
  findNewArchitectureViolations,
  formatArchitectureViolations,
  loadArchitectureBaseline,
  readProductionSourceFiles,
} from './architectureTestUtils';

describe('legacy service architecture guard', () => {
  it('has a checked-in baseline for existing service imports', () => {
    const baselinePath = path.resolve('src/test/architecture/architecture-baseline.json');

    expect(fs.existsSync(baselinePath)).toBe(true);
  });

  it('does not add service imports outside approved infrastructure adapters', () => {
    const violations = findNewArchitectureViolations(
      collectLegacyServiceViolations(readProductionSourceFiles()),
      loadArchitectureBaseline(),
    );

    expect(violations, formatArchitectureViolations(violations)).toEqual([]);
  });
});

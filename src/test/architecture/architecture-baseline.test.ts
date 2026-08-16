import { describe, expect, it } from 'vitest';
import {
  findNewArchitectureViolations,
  isBrowserBoundaryPackage,
  type ArchitectureBaseline,
  type ArchitectureViolation,
} from './architectureTestUtils';

describe('architecture baseline comparison', () => {
  it('reports an edge that is absent from the approved baseline', () => {
    const baseline = {
      version: 1,
      violations: ['legacy-services|src/components/Old.tsx|src/services/oldService'],
    } satisfies ArchitectureBaseline;
    const newViolation = {
      rule: 'legacy-services',
      file: 'src/components/New.tsx',
      detail: 'src/services/newService',
    } satisfies ArchitectureViolation;

    expect(findNewArchitectureViolations([newViolation], baseline)).toEqual([newViolation]);
  });

  it('recognizes scoped framework packages as boundary dependencies', () => {
    expect(isBrowserBoundaryPackage('@tanstack/react-query')).toBe(true);
  });
});

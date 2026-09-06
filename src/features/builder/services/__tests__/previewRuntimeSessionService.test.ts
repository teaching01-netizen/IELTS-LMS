import { describe, expect, it } from 'vitest';
import {
  buildPreviewRuntimeCohortName,
  isPreviewRuntimeCohortName,
  parsePreviewRuntimeSection,
  PREVIEW_COHORT_PREFIX,
} from '../previewRuntimeSessionService';

describe('previewRuntimeSessionService', () => {
  it('detects preview runtime cohort names', () => {
    expect(isPreviewRuntimeCohortName('__preview_runtime__:exam-1:user-1:reading')).toBe(true);
    expect(isPreviewRuntimeCohortName('Cohort A')).toBe(false);
  });

  it('builds science preview cohort names in the isolated namespace', () => {
    const name = buildPreviewRuntimeCohortName('exam-1', 'user-1', 'science');
    expect(name.startsWith('__preview_runtime__:')).toBe(true);
    expect(name).toContain('exam-1');
    expect(name).toContain('user-1');
    expect(name).toContain('science');
    expect(isPreviewRuntimeCohortName(name)).toBe(true);
  });

  it('documents the honesty contract: preview namespace can never collide with real cohorts', () => {
    expect(PREVIEW_COHORT_PREFIX).toBe('__preview_runtime__');
    // A real cohort named e.g. 'Cohort A' never carries the isolated prefix.
    expect(isPreviewRuntimeCohortName('Cohort A')).toBe(false);
  });

  it('parses the science section from a science preview cohort name', () => {
    expect(
      parsePreviewRuntimeSection({
        cohortName: buildPreviewRuntimeCohortName('e', 'u', 'science'),
      }),
    ).toBe('science');
  });
});

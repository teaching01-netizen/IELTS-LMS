import { describe, expect, it } from 'vitest';
import {
  getStudentLayoutMode,
  panesFitWidth,
  resolveStudentLayoutMode,
  scalePaneMinimumsForFontScale,
  STUDENT_MIN_ANSWER_PANE_WIDTH_PX,
  STUDENT_MIN_MATERIAL_PANE_WIDTH_PX,
  STUDENT_SPLIT_RAIL_WIDTH_PX,
  type StudentLayoutFacts,
} from '../studentLayoutMode';

const MIN_TOTAL_SPLIT_WIDTH =
  STUDENT_MIN_MATERIAL_PANE_WIDTH_PX + STUDENT_SPLIT_RAIL_WIDTH_PX + STUDENT_MIN_ANSWER_PANE_WIDTH_PX;

function facts(overrides: Partial<StudentLayoutFacts> = {}): StudentLayoutFacts {
  return {
    containerWidth: 1280,
    stableShellHeight: 800,
    workspaceHeight: 500,
    minMaterialWidth: STUDENT_MIN_MATERIAL_PANE_WIDTH_PX,
    minAnswerWidth: STUDENT_MIN_ANSWER_PANE_WIDTH_PX,
    railWidth: STUDENT_SPLIT_RAIL_WIDTH_PX,
    ...overrides,
  };
}

describe('student layout mode policy (P2.1)', () => {
  it.each([
    [360, 'phone'],
    [599, 'phone'],
    [600, 'compact'],
    [899, 'compact'],
    [900, 'standard'],
    [1179, 'standard'],
    [1180, 'wide'],
    [1440, 'wide'],
  ] as const)('width-only classification of %d via back-compat helper is %s', (width, expectedMode) => {
    // The width-only helper treats height as unmeasured (optimistic pane-fit);
    // real measurements decide downgrade via resolveStudentLayoutMode.
    expect(getStudentLayoutMode(width)).toBe(expectedMode);
  });

  it('keeps invalid/unmeasured geometry in the safe compact layout', () => {
    expect(resolveStudentLayoutMode(facts({ containerWidth: 0 })).layoutMode).toBe('compact');
    expect(resolveStudentLayoutMode(facts({ containerWidth: Number.NaN })).layoutMode).toBe('compact');
    expect(resolveStudentLayoutMode(facts({ containerWidth: -1 })).layoutMode).toBe('compact');
  });

  it('resolves wide at 1180+ with shell height >=650 and pane fit', () => {
    expect(resolveStudentLayoutMode(facts({ containerWidth: 1180, stableShellHeight: 650 }))).toEqual({
      layoutMode: 'wide',
      splitView: true,
    });
    expect(resolveStudentLayoutMode(facts({ containerWidth: 1440, stableShellHeight: 900 }))).toEqual({
      layoutMode: 'wide',
      splitView: true,
    });
  });

  it('resolves standard at 900+ with shell height >=600 and pane fit', () => {
    expect(resolveStudentLayoutMode(facts({ containerWidth: 900, stableShellHeight: 600 }))).toEqual({
      layoutMode: 'standard',
      splitView: true,
    });
    expect(resolveStudentLayoutMode(facts({ containerWidth: 1179, stableShellHeight: 640 }))).toEqual({
      layoutMode: 'standard',
      splitView: true,
    });
  });

  it('uses height boundaries 599/600 and 649/650 correctly', () => {
    // 649px shell height: wide fails, standard fits.
    expect(
      resolveStudentLayoutMode(facts({ containerWidth: 1280, stableShellHeight: 649 })).layoutMode,
    ).toBe('standard');
    expect(
      resolveStudentLayoutMode(facts({ containerWidth: 1280, stableShellHeight: 650 })).layoutMode,
    ).toBe('wide');
    // 599px shell height: standard fails at 900..1179 → compact.
    expect(
      resolveStudentLayoutMode(facts({ containerWidth: 1000, stableShellHeight: 599 })).layoutMode,
    ).toBe('compact');
    expect(
      resolveStudentLayoutMode(facts({ containerWidth: 1000, stableShellHeight: 600 })).layoutMode,
    ).toBe('standard');
  });

  it('keeps 1280x720 wide with roughly 596px workspace (shell-height rule)', () => {
    const decision = resolveStudentLayoutMode(
      facts({ containerWidth: 1280, stableShellHeight: 720, workspaceHeight: 596 }),
    );
    expect(decision.layoutMode).toBe('wide');
    expect(decision.splitView).toBe(true);
  });

  it('downgrades split when workspace height is insufficient (focus override)', () => {
    const decision = resolveStudentLayoutMode(
      facts({ containerWidth: 1280, stableShellHeight: 800, workspaceHeight: 359 }),
    );
    expect(decision.splitView).toBe(false);
    expect(decision.layoutMode).toBe('wide'); // wide chrome, single pane
  });

  it('requires both readable pane minimums plus one rail to fit (pane-fit decisive)', () => {
    expect(panesFitWidth(facts({ containerWidth: MIN_TOTAL_SPLIT_WIDTH }))).toBe(true);
    expect(panesFitWidth(facts({ containerWidth: MIN_TOTAL_SPLIT_WIDTH - 1 }))).toBe(false);
    // Enlarged text raises the required widths (1.16 scale).
    const scaled = facts({
      containerWidth: 949,
      minMaterialWidth: scalePaneMinimumsForFontScale(STUDENT_MIN_MATERIAL_PANE_WIDTH_PX, 1.16),
      minAnswerWidth: scalePaneMinimumsForFontScale(STUDENT_MIN_ANSWER_PANE_WIDTH_PX, 1.16),
    });
    expect(panesFitWidth(scaled)).toBe(false);
    expect(panesFitWidth({ ...scaled, containerWidth: 950 })).toBe(true);
    expect(panesFitWidth({ ...scaled, containerWidth: MIN_TOTAL_SPLIT_WIDTH + 130 })).toBe(true);
  });

  it('classifies phone below 600px and compact between 600 and 899', () => {
    expect(resolveStudentLayoutMode(facts({ containerWidth: 599 })).layoutMode).toBe('phone');
    expect(resolveStudentLayoutMode(facts({ containerWidth: 600 })).layoutMode).toBe('compact');
    expect(resolveStudentLayoutMode(facts({ containerWidth: 899 })).layoutMode).toBe('compact');
  });

  it('keeps 844x390 phone landscape compact (portrait-tablet no longer medium)', () => {
    expect(resolveStudentLayoutMode(facts({ containerWidth: 844, stableShellHeight: 390 })).layoutMode).toBe('compact');
  });

  it('keeps 768 portrait compact (old medium expectation intentionally retired)', () => {
    expect(resolveStudentLayoutMode(facts({ containerWidth: 768, stableShellHeight: 1024 })).layoutMode).toBe('compact');
  });

  it('scales pane minimums for font preferences without dividing by zero', () => {
    expect(scalePaneMinimumsForFontScale(380, 1)).toBe(380);
    expect(scalePaneMinimumsForFontScale(380, 1.16)).toBe(441);
    expect(scalePaneMinimumsForFontScale(380, Number.NaN)).toBe(380);
    expect(scalePaneMinimumsForFontScale(380, 0)).toBe(380);
  });
});

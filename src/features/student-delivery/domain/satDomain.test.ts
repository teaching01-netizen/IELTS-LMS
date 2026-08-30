import { describe, expect, it } from 'vitest';
import { emptySatQuestionResponse } from './satResponses';
import { buildSatQuestionNavigationItems } from './satSelectors';
import { breakRemainingSeconds, formatSatTime, mergeAuthoritativeTiming, snapshotRemainingSeconds, timingForAttempt } from './satTiming';
import { resolveAuthoritativeRemainingSeconds } from '../../../shared/hooks/useAuthoritativeDeadlineClock';
import { nextSatActiveTool, resolveSatToolCapabilities } from './satTools';
import type { AssessmentDeliveryBootstrap, AssessmentDeliveryModule, AssessmentModuleAttemptSnapshot } from '../contracts/assessmentDelivery';
import { shouldAutoStartInitialModule, shouldAutoStartNextSectionAfterBreak } from '../application/satRuntimeSelectors';

describe('SAT delivery domain', () => {
  it('normalizes module tool policy without opening a tool', () => {
    const fromArray = resolveSatToolCapabilities(['calculator', 'reference_sheet']);
    const fromObject = resolveSatToolCapabilities({ calculator: true, reference_sheet: true });
    expect(fromArray).toEqual({ calculator: true, referenceSheet: true });
    expect(fromObject).toEqual(fromArray);
    expect(nextSatActiveTool(fromArray, null, 'calculator')).toBe('calculator');
    expect(nextSatActiveTool(fromArray, 'calculator', 'reference_sheet')).toBe('reference_sheet');
    expect(nextSatActiveTool({ calculator: false, referenceSheet: false }, null, 'calculator')).toBeNull();
  });

  it('keeps current and answer status independent in the shared navigator model', () => {
    const q1 = { ...emptySatQuestionResponse('q1'), answer: 'A' };
    const q2 = emptySatQuestionResponse('q2');
    const items = buildSatQuestionNavigationItems(['q1', 'q2'], 1, { q1, q2 });
    expect(items[0]).toMatchObject({ status: 'answered', current: false });
    expect(items[1]).toMatchObject({ status: 'unanswered', current: true });
  });



  it('never lets stale or same-revision SAT timing snapshots create extra time', () => {
    const current = {
      authority: 'cohort_runtime' as const,
      timingModel: 'cohort_stage_v2' as const,
      stageKey: 'reading-writing:m1',
      stageStatus: 'live',
      serverNow: '2026-08-29T05:00:00Z',
      deadlineAt: '2026-08-29T05:32:00Z',
      remainingSeconds: 1_920,
      runtimeRevision: 7,
    };
    expect(mergeAuthoritativeTiming(current, {
      ...current,
      deadlineAt: '2026-08-29T05:40:00Z',
      remainingSeconds: 2_400,
      runtimeRevision: 6,
    })).toEqual(current);
    expect(mergeAuthoritativeTiming(current, {
      ...current,
      deadlineAt: '2026-08-29T05:33:00Z',
      remainingSeconds: 1_980,
    }).deadlineAt).toBe(current.deadlineAt);
    expect(mergeAuthoritativeTiming(current, {
      ...current,
      deadlineAt: '2026-08-29T05:37:00Z',
      remainingSeconds: 2_220,
      runtimeRevision: 8,
    }).deadlineAt).toBe('2026-08-29T05:37:00Z');
  });

  it('derives remaining time from an absolute server deadline even with a skewed browser clock', () => {
    const browserNow = Date.parse('2026-08-29T12:00:10Z');
    const serverNow = Date.parse('2026-08-29T05:00:10Z');
    const remaining = resolveAuthoritativeRemainingSeconds({
      deadlineAt: '2026-08-29T05:01:10Z',
      clockOffsetMs: serverNow - browserNow,
      fallbackSeconds: 60,
      running: true,
      nowMs: browserNow,
    });
    expect(remaining).toBe(60);
  });

  it('projects remaining time from the last server snapshot without becoming authoritative', () => {
    const remaining = snapshotRemainingSeconds({
      id: 'attempt-module',
      moduleId: 'module',
      state: 'active',
      allocatedSeconds: 120,
      availableAt: null,
      startedAt: '2026-08-29T05:00:00Z',
      pausedAt: null,
      accumulatedPausedSeconds: 0,
      extensionSeconds: 0,
      deadlineAt: '2026-08-29T05:02:00Z',
      remainingSeconds: 90,
      completionReason: null,
      rawCorrect: null,
      operationalQuestionCount: null,
      toolState: {},
      revision: 1,
    }, 1_000, 11_500);
    expect(remaining).toBe(80);
    expect(formatSatTime(80)).toBe('1:20');
  });
  it('caps v3 module time at the fixed cohort section boundary and starts break only at the break stage', () => {
    const moduleAttempt: AssessmentModuleAttemptSnapshot = {
      id: 'module-attempt-v3',
      moduleId: 'rw-m2',
      state: 'active',
      allocatedSeconds: 900,
      availableAt: null,
      startedAt: '2026-08-30T03:20:00Z',
      pausedAt: null,
      accumulatedPausedSeconds: 0,
      extensionSeconds: 0,
      deadlineAt: '2026-08-30T03:35:00Z',
      remainingSeconds: 900,
      completionReason: null,
      rawCorrect: null,
      operationalQuestionCount: null,
      toolState: {},
      revision: 1,
    };
    const data: AssessmentDeliveryBootstrap = {
      scheduleId: 'schedule',
      examId: 'exam',
      providerKey: 'sat',
      versionId: 'version',
      serverNow: '2026-08-30T03:20:00Z',
      candidateName: 'Candidate',
      scheduleRuntimeStatus: 'live',
      timing: {
        authority: 'cohort_runtime',
        timingModel: 'cohort_section_v3',
        stageKey: 'reading-writing',
        stageStatus: 'live',
        serverNow: '2026-08-30T03:20:00Z',
        deadlineAt: '2026-08-30T03:30:00Z',
        remainingSeconds: 600,
        runtimeRevision: 4,
      },
      proctorStatus: 'active',
      proctorNote: null,
      deviceFingerprintHash: null,
      sections: [],
      attempt: { id: 'attempt', moduleAttempts: [moduleAttempt], responses: [] },
      result: null,
    };

    expect(timingForAttempt(data, moduleAttempt).endsAt).toBe('2026-08-30T03:30:00.000Z');
    expect(breakRemainingSeconds(data, moduleAttempt, 0, 0)).toBe(0);
    expect(breakRemainingSeconds({
      ...data,
      timing: {
        ...data.timing,
        stageKey: 'sat:break:reading-writing',
        deadlineAt: '2026-08-30T03:40:00Z',
        remainingSeconds: 600,
        runtimeRevision: 5,
      },
    }, moduleAttempt, 0, 0)).toBe(600);
  });

  it('auto-starts only the first SAT module after the proctor makes the runtime live', () => {
    const module = { id: 'rw-m1', adaptiveRole: 'base' } as AssessmentDeliveryModule;
    const pendingAttempt: AssessmentModuleAttemptSnapshot = {
      id: 'attempt-module', moduleId: module.id, state: 'not_started', allocatedSeconds: 600,
      availableAt: null, startedAt: null, pausedAt: null, accumulatedPausedSeconds: 0,
      extensionSeconds: 0, deadlineAt: null, remainingSeconds: 600, completionReason: null,
      rawCorrect: null, operationalQuestionCount: null, toolState: {}, revision: 0,
    };
    const data = {
      scheduleRuntimeStatus: 'live',
      proctorStatus: 'active',
      attempt: { moduleAttempts: [pendingAttempt] },
    } as AssessmentDeliveryBootstrap;

    expect(shouldAutoStartInitialModule(data, module, 0, true)).toBe(true);
    expect(shouldAutoStartInitialModule(data, module, 1, true)).toBe(false);
    expect(shouldAutoStartInitialModule(data, module, 0, false)).toBe(false);
    expect(shouldAutoStartInitialModule(
      { ...data, scheduleRuntimeStatus: 'scheduled' }, module, 0, true,
    )).toBe(false);
    expect(shouldAutoStartInitialModule(
      {
        ...data,
        attempt: { ...data.attempt, moduleAttempts: [{ ...pendingAttempt, startedAt: '2026-08-30T03:00:00Z', state: 'active' }] },
      },
      module,
      0,
      true,
    )).toBe(false);
  });

  it('auto-starts the next SAT section only after the authoritative break has ended', () => {
    const module = { id: 'math-m1', adaptiveRole: 'base' } as AssessmentDeliveryModule;
    const pendingAttempt: AssessmentModuleAttemptSnapshot = {
      id: 'math-attempt', moduleId: module.id, state: 'not_started', allocatedSeconds: 600,
      availableAt: null, startedAt: null, pausedAt: null, accumulatedPausedSeconds: 0,
      extensionSeconds: 0, deadlineAt: null, remainingSeconds: 600, completionReason: null,
      rawCorrect: null, operationalQuestionCount: null, toolState: {}, revision: 0,
    };
    const data = {
      scheduleRuntimeStatus: 'live',
      proctorStatus: 'active',
      attempt: { moduleAttempts: [pendingAttempt] },
    } as AssessmentDeliveryBootstrap;

    expect(shouldAutoStartNextSectionAfterBreak(data, module, 1, true, 0, 0)).toBe(true);
    expect(shouldAutoStartNextSectionAfterBreak(data, module, 1, true, 600, 0)).toBe(false);
    expect(shouldAutoStartNextSectionAfterBreak(data, module, 1, true, 0, 300)).toBe(false);
    expect(shouldAutoStartNextSectionAfterBreak(data, module, 1, false, 0, 0)).toBe(false);
    expect(shouldAutoStartNextSectionAfterBreak(
      { ...data, scheduleRuntimeStatus: 'paused' }, module, 1, true, 0, 0,
    )).toBe(false);
    expect(shouldAutoStartNextSectionAfterBreak(
      data, { ...module, adaptiveRole: 'higher_branch' }, 1, true, 0, 0,
    )).toBe(false);
  });

});

import { describe, expect, it } from 'vitest';
import { emptySatQuestionResponse } from './satResponses';
import { buildSatQuestionNavigationItems } from './satSelectors';
import { breakRemainingSeconds, formatSatTime, mergeAuthoritativeTiming, snapshotRemainingSeconds, timingForAttempt } from './satTiming';
import { resolveAuthoritativeRemainingSeconds } from '../../../shared/hooks/useAuthoritativeDeadlineClock';
import { resolveSatToolCapabilities, toggleSatActiveTool } from './satTools';
import type { AssessmentDeliveryBootstrap, AssessmentDeliveryModule, AssessmentModuleAttemptSnapshot, AssessmentTimingSnapshot } from '../contracts/assessmentDelivery';
import {
  deriveSatEntryDecision,
  moduleAttemptEndedByOwnClock,
  previousModuleTimedOut,
  type SatEntryDecisionInput,
} from '../application/satEntry';

describe('SAT delivery domain', () => {
  it('normalizes module tool policy without opening a tool', () => {
    const fromArray = resolveSatToolCapabilities(['calculator', 'reference_sheet']);
    const fromObject = resolveSatToolCapabilities({ calculator: true, reference_sheet: true });
    expect(fromArray).toEqual({ calculator: true, referenceSheet: true });
    expect(fromObject).toEqual(fromArray);
    // Coexistence (Phase 9): toggling one tool never closes the other.
    expect(toggleSatActiveTool(fromArray, { calculator: false, referenceSheet: false }, 'calculator')).toEqual({ calculator: true, referenceSheet: false });
    expect(toggleSatActiveTool(fromArray, { calculator: true, referenceSheet: false }, 'reference_sheet')).toEqual({ calculator: true, referenceSheet: true });
    expect(toggleSatActiveTool({ calculator: false, referenceSheet: false }, { calculator: false, referenceSheet: false }, 'calculator')).toEqual({ calculator: false, referenceSheet: false });
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
    // Cohort breaks are no longer read from a `sat:break:`-suffixed stage key
    // (no writer ever produced one). The authored break is the server's
    // nextSectionStartAt window, and the controller counts it down; the legacy
    // helper must stay silent for cohort models rather than invent a 0:00.
    expect(breakRemainingSeconds({
      ...data,
      timing: {
        ...data.timing,
        stageKey: 'sat:break:reading-writing',
        deadlineAt: '2026-08-30T03:40:00Z',
        remainingSeconds: 600,
        runtimeRevision: 5,
      },
    }, moduleAttempt, 0, 0)).toBe(0);
  });

  it('keeps a known between-sections start when a newer projection omits it', () => {
    const current: AssessmentTimingSnapshot = {
      authority: 'cohort_runtime',
      timingModel: 'cohort_section_v3',
      stageKey: 'reading-writing',
      stageStatus: 'completed',
      serverNow: '2026-08-30T03:30:00Z',
      deadlineAt: null,
      remainingSeconds: 0,
      nextSectionStartAt: '2026-08-30T03:40:00Z',
      waitingForNextSection: true,
      runtimeRevision: 9,
    };
    // A projection that simply lacks the keys must not clear the break window.
    const omitted = mergeAuthoritativeTiming(current, {
      ...current,
      runtimeRevision: 10,
      nextSectionStartAt: undefined,
      waitingForNextSection: undefined,
    });
    expect(omitted.nextSectionStartAt).toBe('2026-08-30T03:40:00Z');
    expect(omitted.waitingForNextSection).toBe(true);
    // An explicit null/false is the server saying the break is over.
    const ended = mergeAuthoritativeTiming(current, {
      ...current,
      stageKey: 'math',
      stageStatus: 'live',
      runtimeRevision: 11,
      nextSectionStartAt: null,
      waitingForNextSection: false,
    });
    expect(ended.nextSectionStartAt).toBeNull();
    expect(ended.waitingForNextSection).toBe(false);
  });

  it('auto-enters the first SAT module only after the proctor makes the runtime live', () => {
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
    const entry = (overrides: Partial<SatEntryDecisionInput> = {}) =>
      deriveSatEntryDecision({
        data, module, sectionDisplayOrder: 0, stageReady: true,
        breakSeconds: 0, sectionWaitSeconds: 0, phase: 'directions', ...overrides,
      });

    expect(entry()).toMatchObject({ shouldStart: true, reason: 'initial-entry', autoStartPending: true });
    // Section 0 only opens from the directions screen.
    expect(entry({ phase: 'break' })).toMatchObject({
      shouldStart: false, reason: 'initial-entry-not-on-directions',
    });
    expect(entry({ stageReady: false })).toMatchObject({ shouldStart: false, reason: 'stage-not-ready' });
    expect(entry({ data: { ...data, scheduleRuntimeStatus: 'scheduled' } })).toMatchObject({
      shouldStart: false, reason: 'runtime-not-live',
    });
    // not_started is the value the server actually projects before the proctor
    // presses Start (a SAT schedule has no exam_session_runtimes row yet), so
    // this is the case that decides whether a waiting student POSTs
    // /modules/start and eats a 409 RUNTIME_NOT_LIVE per retry window.
    expect(entry({
      data: {
        ...data,
        scheduleRuntimeStatus: 'not_started',
        timing: {
          authority: 'cohort_runtime', timingModel: 'cohort_section_v3',
          stageKey: null, stageStatus: 'not_started', serverNow: data.serverNow,
          deadlineAt: null, remainingSeconds: 0,
        },
      },
    })).toMatchObject({ shouldStart: false, reason: 'runtime-not-live' });
    // idle/connecting are legal attempt statuses but not a live exam: automatic
    // entry and the manual button now share this one verdict.
    expect(entry({ data: { ...data, proctorStatus: 'idle' } })).toMatchObject({
      shouldStart: false, reason: 'proctor-blocked',
    });
    // Module 2 is selected by the server. Once its unstarted attempt exists,
    // it opens automatically regardless of how Module 1 ended.
    expect(entry({ module: { ...module, adaptiveRole: 'higher_branch' } })).toMatchObject({
      shouldStart: true, reason: 'next-module-entry', autoStartPending: true,
    });
    // The hand-off needs a module to enter: an already-started row is not it.
    expect(entry({
      module: { ...module, adaptiveRole: 'higher_branch' },
      data: {
        ...data,
        attempt: { ...data.attempt, moduleAttempts: [{ ...pendingAttempt, startedAt: '2026-08-30T03:00:00Z', state: 'active' }] },
      },
    })).toMatchObject({ shouldStart: false, reason: 'already-started' });
    expect(entry({
      data: {
        ...data,
        attempt: { ...data.attempt, moduleAttempts: [{ ...pendingAttempt, startedAt: '2026-08-30T03:00:00Z', state: 'active' }] },
      },
    })).toMatchObject({ shouldStart: false, reason: 'already-started', autoStartPending: true });
    // The branch is the section, not the phase: a later section reached from
    // the directions screen is the next-section rule.
    expect(entry({ sectionDisplayOrder: 1 })).toMatchObject({
      shouldStart: true, reason: 'next-section-entry',
    });
  });

  it('auto-enters the next SAT section only after the authoritative break has ended', () => {
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
    const entry = (overrides: Partial<SatEntryDecisionInput> = {}) =>
      deriveSatEntryDecision({
        data, module, sectionDisplayOrder: 1, stageReady: true,
        breakSeconds: 0, sectionWaitSeconds: 0, phase: 'break', ...overrides,
      });

    expect(entry()).toMatchObject({ shouldStart: true, reason: 'next-section-entry' });
    expect(entry({ phase: 'directions' })).toMatchObject({ shouldStart: true });
    expect(entry({ breakSeconds: 600 })).toMatchObject({
      shouldStart: false, reason: 'break-active',
    });
    expect(entry({ sectionWaitSeconds: 300 })).toMatchObject({
      shouldStart: false, reason: 'section-wait',
    });
    expect(entry({ stageReady: false })).toMatchObject({
      shouldStart: false, reason: 'stage-not-ready',
    });
    expect(entry({ data: { ...data, scheduleRuntimeStatus: 'paused' } })).toMatchObject({
      shouldStart: false, reason: 'runtime-not-live',
    });
    expect(entry({ data: { ...data, proctorStatus: 'paused' } })).toMatchObject({
      shouldStart: false, reason: 'proctor-blocked',
    });
    expect(entry({ module: { ...module, adaptiveRole: 'higher_branch' } })).toMatchObject({
      shouldStart: true, reason: 'next-module-entry', autoStartPending: true,
    });
    expect(entry({ sectionDisplayOrder: null })).toMatchObject({
      shouldStart: false, reason: 'unknown-section',
    });
    expect(entry({
      data: {
        ...data,
        attempt: { ...data.attempt, moduleAttempts: [{ ...pendingAttempt, startedAt: '2026-08-30T04:00:00Z', state: 'active' }] },
      },
    })).toMatchObject({ shouldStart: false, reason: 'already-started' });
  });

  // Module-advance fix: "Module 1 ended on its own clock" is read from the
  // payload rather than from local submit state, so the live session, a poll
  // that discovers a server-side finalization, an offline reconnect, and a
  // reload all reach the same verdict. `completionReason` cannot answer it:
  // the client's own expiry submit is recorded as `student_submit`.
  it('derives the Module 2 hand-off from the finished module\'s own clock', () => {
    const baseModule = { id: 'rw-m1', adaptiveRole: 'base' } as AssessmentDeliveryModule;
    const branchModule = { id: 'rw-m2-lower', adaptiveRole: 'lower_branch' } as AssessmentDeliveryModule;
    const startedAt = '2026-09-19T09:00:00Z';
    const deadlineAt = '2026-09-19T09:32:00Z';
    const attempt = (
      moduleId: string,
      state: string,
      deadline: string | null,
    ): AssessmentModuleAttemptSnapshot => ({
      id: `ma-${moduleId}`, moduleId, state, allocatedSeconds: 1_920,
      availableAt: startedAt, startedAt, pausedAt: null, accumulatedPausedSeconds: 0,
      extensionSeconds: 0, deadlineAt: deadline, remainingSeconds: 0,
      completionReason: null, rawCorrect: null, operationalQuestionCount: null,
      toolState: {}, revision: 3,
    });
    const payloadAt = (serverNow: string, state: string, deadline: string | null) => ({
      serverNow,
      sections: [{
        id: 'sec-rw', sectionKey: 'reading-writing', displayOrder: 0,
        modules: [baseModule, branchModule],
      }],
      attempt: { moduleAttempts: [attempt(baseModule.id, state, deadline)] },
    } as unknown as AssessmentDeliveryBootstrap);

    expect(previousModuleTimedOut(payloadAt('2026-09-19T09:32:05Z', 'submitted', deadlineAt), branchModule)).toBe(true);
    // Submitted with time to spare: the finished module's own deadline is still
    // ahead, so the student owns the Module 2 entry.
    expect(previousModuleTimedOut(payloadAt('2026-09-19T09:20:00Z', 'submitted', deadlineAt), branchModule)).toBe(false);
    // A module that never started, or carries no deadline, proves nothing.
    expect(previousModuleTimedOut(payloadAt('2026-09-19T09:40:00Z', 'not_started', deadlineAt), branchModule)).toBe(false);
    expect(previousModuleTimedOut(payloadAt('2026-09-19T09:40:00Z', 'submitted', null), branchModule)).toBe(false);
    // A section the payload does not describe cannot hand off either.
    expect(previousModuleTimedOut(payloadAt('2026-09-19T09:40:00Z', 'submitted', deadlineAt), {
      id: 'math-m2-lower', adaptiveRole: 'lower_branch',
    } as AssessmentDeliveryModule)).toBe(false);
    expect(moduleAttemptEndedByOwnClock(attempt(baseModule.id, 'locked', deadlineAt), '2026-09-19T09:32:30Z')).toBe(true);
    expect(moduleAttemptEndedByOwnClock(attempt(baseModule.id, 'submitted', null), '2026-09-19T09:40:00Z')).toBe(false);
    // The tolerance covers the ceil-based countdown and the submit round trip.
    expect(moduleAttemptEndedByOwnClock(attempt(baseModule.id, 'submitted', deadlineAt), '2026-09-19T09:31:59.500Z')).toBe(true);
    expect(moduleAttemptEndedByOwnClock(attempt(baseModule.id, 'submitted', deadlineAt), '2026-09-19T09:31:58.000Z')).toBe(false);
  });

});

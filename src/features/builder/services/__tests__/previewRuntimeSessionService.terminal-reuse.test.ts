/**
 * Regression: preview must survive reused preview schedules whose runtime is
 * already terminal (completed/cancelled).
 *
 * Backend Start() is idempotent ONLY for live/paused runtimes; any other
 * existing row is a stable 409 "Runtime already exists for this schedule."
 * (backend/go/internal/runtime/service.go). The resolver reused the schedule
 * and unconditionally called startRuntime, so every revisit of a poisoned
 * preview slot failed with "Preview session failed".
 *
 * Companion guard: the section walk must never end sections toward a target
 * that is not part of the live backend plan (which would complete the
 * runtime and poison the slot for the next visit). Instead the resolver
 * falls back to the runtime's actual live section and reports the mismatch
 * as a notice (e.g. legacy ACT rows planned under the wrong provider).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPreviewRuntimeCohortName,
  resolvePreviewRuntimeSession,
} from '../previewRuntimeSessionService';
import { backendPost } from '../../../exam-authoring/api/examAuthoringBackendGateway';
import {
  examDeliveryService,
  examRepository,
  getEnabledModules,
} from '../../../exam-authoring/api/examAuthoringGateway';
import { studentAttemptRepository } from '../../../student/api/studentAttemptGateway';
import type { ModuleType } from '../../../../types';
import type { ExamState } from '../../../../types';
import type {
  ExamEntity,
  ExamSchedule,
  ExamSessionRuntime,
  SectionRuntimeState,
} from '../../../../types/domain';

vi.mock('../../../exam-authoring/api/examAuthoringBackendGateway', () => ({
  backendPost: vi.fn(),
  buildCreateSchedulePayload: vi.fn((payload: unknown) => payload),
  mapBackendSchedule: vi.fn((payload: unknown) => payload),
}));

vi.mock('../../../exam-authoring/api/examAuthoringGateway', () => ({
  examDeliveryService: {
    startRuntime: vi.fn(),
    getRuntimeSnapshot: vi.fn(),
    endCurrentSectionNow: vi.fn(),
  },
  examRepository: {
    getSchedulesByExam: vi.fn(),
    deleteSchedule: vi.fn(),
  },
  getEnabledModules: vi.fn(),
}));

vi.mock('../../../student/api/studentAttemptGateway', () => ({
  ensureClientSessionIdForAttempt: vi.fn(() => 'client-session-1'),
  studentAttemptRepository: {
    createAttempt: vi.fn(),
  },
}));

vi.mock('../../../student/api/studentSessionGateway', () => ({
  studentSessionTransport: {
    paths: {
      precheck: (scheduleId: string) => `/v1/student/sessions/${scheduleId}/precheck`,
    },
  },
}));

vi.mock('../../infrastructure/attemptCredential', () => ({
  buildAttemptAuthorizationHeader: vi.fn(() => ({})),
}));

const backendPostMock = vi.mocked(backendPost);
const startRuntimeMock = vi.mocked(examDeliveryService.startRuntime);
const getRuntimeSnapshotMock = vi.mocked(examDeliveryService.getRuntimeSnapshot);
const endCurrentSectionNowMock = vi.mocked(examDeliveryService.endCurrentSectionNow);
const getSchedulesByExamMock = vi.mocked(examRepository.getSchedulesByExam);
const deleteScheduleMock = vi.mocked(examRepository.deleteSchedule);
const getEnabledModulesMock = vi.mocked(getEnabledModules);
const createAttemptMock = vi.mocked(studentAttemptRepository.createAttempt);

const EXAM_ID = 'exam-1';
const AUTHOR_ID = 'builder-1';
const DRAFT_VERSION_ID = 'ver-1';
const NOW = new Date('2026-06-01T10:00:00.000Z');

function examFixture(): ExamEntity {
  return {
    id: EXAM_ID,
    slug: EXAM_ID,
    title: 'Preview exam',
    providerKey: 'ielts',
    type: 'Academic',
    status: 'draft',
    visibility: 'private',
    owner: AUTHOR_ID,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-06-01T09:00:00.000Z',
    currentDraftVersionId: DRAFT_VERSION_ID,
    currentPublishedVersionId: null,
    canEdit: true,
    canPublish: true,
    canDelete: true,
    schemaVersion: 4,
  };
}

function stateFixture(): ExamState {
  return {
    config: {
      sections: {
        listening: { enabled: true, order: 0 },
        reading: { enabled: true, order: 1 },
        writing: { enabled: true, order: 2 },
      },
    },
  } as unknown as ExamState;
}

function scheduleFixture(overrides: Partial<ExamSchedule> & { id: string; module: ModuleType }): ExamSchedule {
  const { module, ...rest } = overrides;
  return {
    id: rest.id,
    examId: EXAM_ID,
    providerKey: 'ielts',
    examTitle: 'Preview exam',
    proctorDisplayName: 'Preview exam (Preview)',
    gradingDisplayName: 'Preview exam (Preview)',
    publishedVersionId: DRAFT_VERSION_ID,
    cohortName: buildPreviewRuntimeCohortName(EXAM_ID, AUTHOR_ID, module),
    institution: 'preview-runtime',
    startTime: '2026-06-01T09:55:00.000Z',
    endTime: '2026-06-01T18:00:00.000Z',
    plannedDurationMinutes: 120,
    deliveryMode: 'proctor_start',
    autoStart: true,
    autoStop: false,
    status: 'scheduled',
    createdAt: '2026-06-01T09:55:00.000Z',
    createdBy: AUTHOR_ID,
    updatedAt: '2026-06-01T09:55:00.000Z',
    ...rest,
  } as unknown as ExamSchedule;
}

function sectionFixture(
  sectionKey: ModuleType,
  status: SectionRuntimeState['status'],
): SectionRuntimeState {
  return {
    sectionKey,
    label: sectionKey,
    order: 1,
    plannedDurationMinutes: 30,
    gapAfterMinutes: 0,
    status,
    availableAt: null,
    actualStartAt: null,
    actualEndAt: null,
    pausedAt: null,
    accumulatedPausedSeconds: 0,
    extensionMinutes: 0,
  };
}

function runtimeFixture(
  scheduleId: string,
  status: ExamSessionRuntime['status'],
  currentSectionKey: ModuleType | null,
  sectionKeys: ModuleType[],
): ExamSessionRuntime {
  return {
    id: `rt-${scheduleId}`,
    scheduleId,
    examId: EXAM_ID,
    providerKey: 'ielts',
    examTitle: 'Preview exam',
    cohortName: 'preview',
    deliveryMode: 'proctor_start',
    status,
    timingModel: 'legacy_section_v1',
    actualStartAt: '2026-06-01T09:55:00.000Z',
    actualEndAt: status === 'completed' || status === 'cancelled' ? '2026-06-01T10:00:00.000Z' : null,
    activeSectionKey: currentSectionKey,
    currentSectionKey,
    currentSectionRemainingSeconds: 1800,
    serverNow: '2026-06-01T10:00:00.000Z',
    waitingForNextSection: false,
    isOverrun: false,
    totalPausedSeconds: 0,
    revision: 3,
    sections: sectionKeys.map((key) =>
      sectionFixture(
        key,
        status === 'completed' || status === 'cancelled'
          ? 'completed'
          : key === currentSectionKey
            ? 'live'
            : 'locked',
      ),
    ),
    createdAt: '2026-06-01T09:55:00.000Z',
    updatedAt: '2026-06-01T10:00:00.000Z',
  } as unknown as ExamSessionRuntime;
}

function installAttemptDoubles(): void {
  createAttemptMock.mockResolvedValue({ integrity: {} } as never);
  backendPostMock.mockImplementation(async (endpoint: string) => {
    if (endpoint === '/v1/schedules') {
      throw new Error(`unexpected schedule creation: ${endpoint}`);
    }
    return {} as never;
  });
}

describe('previewRuntimeSessionService terminal-runtime reuse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnabledModulesMock.mockReturnValue(['listening', 'reading']);
    startRuntimeMock.mockResolvedValue({ success: true, runtime: null });
    endCurrentSectionNowMock.mockResolvedValue({ success: true, runtime: null });
    installAttemptDoubles();
  });

  it('replaces a reused schedule whose runtime already completed instead of 409ing', async () => {
    const stale = scheduleFixture({ id: 'sched-old', module: 'reading' });
    const replacement = scheduleFixture({ id: 'sched-new', module: 'reading' });
    getSchedulesByExamMock.mockResolvedValue([stale]);
    // The newborn replacement has no runtime row until start creates it:
    // pre-start snapshot is null, every later snapshot is live-positioned.
    // NOTE: shift() results must be checked with an explicit length guard —
    // `shift() ?? fallback` would swallow the intentional null (null is
    // nullish) and silently skip the start path under test.
    const freshSnapshots: Array<ExamSessionRuntime | null> = [
      null,
      runtimeFixture('sched-new', 'live', 'reading', ['listening', 'reading']),
    ];
    const freshLive = runtimeFixture('sched-new', 'live', 'reading', ['listening', 'reading']);
    getRuntimeSnapshotMock.mockImplementation(async (scheduleId: string) => {
      if (scheduleId === 'sched-old') {
        return runtimeFixture('sched-old', 'completed', null, ['listening', 'reading']);
      }
      return freshSnapshots.length > 0
        ? (freshSnapshots.shift() as ExamSessionRuntime | null)
        : freshLive;
    });
    backendPostMock.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/v1/schedules') {
        return replacement as never;
      }
      return {} as never;
    });

    const resolved = await resolvePreviewRuntimeSession({
      exam: examFixture(),
      state: stateFixture(),
      authorUserId: AUTHOR_ID,
      requestedModule: 'reading',
      now: NOW,
    });

    expect(resolved.scheduleId).toBe('sched-new');
    expect(startRuntimeMock).not.toHaveBeenCalledWith('sched-old', expect.any(String));
    expect(backendPostMock).toHaveBeenCalledWith('/v1/schedules', expect.anything());
    expect(endCurrentSectionNowMock).not.toHaveBeenCalled();
    // Null pre-start snapshot forces exactly one real start on the newborn.
    expect(startRuntimeMock).toHaveBeenCalledTimes(1);
    expect(startRuntimeMock).toHaveBeenCalledWith('sched-new', expect.any(String));
  });

  it('replaces a reused schedule whose runtime was cancelled', async () => {
    const stale = scheduleFixture({ id: 'sched-cancelled', module: 'reading' });
    const replacement = scheduleFixture({ id: 'sched-fresh', module: 'reading' });
    getSchedulesByExamMock.mockResolvedValue([stale]);
    const freshSnapshots: Array<ExamSessionRuntime | null> = [
      null,
      runtimeFixture('sched-fresh', 'live', 'reading', ['listening', 'reading']),
    ];
    const freshLive = runtimeFixture('sched-fresh', 'live', 'reading', ['listening', 'reading']);
    getRuntimeSnapshotMock.mockImplementation(async (scheduleId: string) => {
      if (scheduleId === 'sched-cancelled') {
        return runtimeFixture('sched-cancelled', 'cancelled', null, ['listening', 'reading']);
      }
      return freshSnapshots.length > 0
        ? (freshSnapshots.shift() as ExamSessionRuntime | null)
        : freshLive;
    });
    backendPostMock.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/v1/schedules') {
        return replacement as never;
      }
      return {} as never;
    });

    const resolved = await resolvePreviewRuntimeSession({
      exam: examFixture(),
      state: stateFixture(),
      authorUserId: AUTHOR_ID,
      requestedModule: 'reading',
      now: NOW,
    });

    expect(resolved.scheduleId).toBe('sched-fresh');
    expect(startRuntimeMock).not.toHaveBeenCalledWith(
      'sched-cancelled',
      expect.any(String),
    );
  });

  it('reuses the already-live runtime without issuing a start command', async () => {
    const schedule = scheduleFixture({ id: 'sched-raced', module: 'reading' });
    getSchedulesByExamMock.mockResolvedValue([schedule]);
    getRuntimeSnapshotMock.mockResolvedValue(
      runtimeFixture('sched-raced', 'live', 'reading', ['listening', 'reading']),
    );

    const resolved = await resolvePreviewRuntimeSession({
      exam: examFixture(),
      state: stateFixture(),
      authorUserId: AUTHOR_ID,
      requestedModule: 'reading',
      now: NOW,
    });

    expect(resolved.scheduleId).toBe('sched-raced');
    // Pre-start snapshot already shows a usable live runtime, so no start
    // command is issued at all: no 409 can occur on this path.
    expect(startRuntimeMock).not.toHaveBeenCalled();
    expect(backendPostMock).not.toHaveBeenCalledWith('/v1/schedules', expect.anything());
    expect(deleteScheduleMock).not.toHaveBeenCalled();
  });

  it('tolerates a 409 from a concurrent start race by reusing the live runtime', async () => {
    const schedule = scheduleFixture({ id: 'sched-start-race', module: 'reading' });
    getSchedulesByExamMock.mockResolvedValue([schedule]);
    // Nothing readable before start (quarantine scan + pre-start snapshot),
    // then a concurrent starter wins the race and our start command 409s
    // against its live row.
    getRuntimeSnapshotMock.mockReset();
    getRuntimeSnapshotMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(runtimeFixture('sched-start-race', 'live', 'reading', ['listening', 'reading']));
    startRuntimeMock.mockResolvedValueOnce({
      success: false,
      error: 'Runtime already exists for this schedule.',
    });

    const resolved = await resolvePreviewRuntimeSession({
      exam: examFixture(),
      state: stateFixture(),
      authorUserId: AUTHOR_ID,
      requestedModule: 'reading',
      now: NOW,
    });

    expect(resolved.scheduleId).toBe('sched-start-race');
    expect(startRuntimeMock).toHaveBeenCalledTimes(1);
    expect(startRuntimeMock).toHaveBeenCalledWith('sched-start-race', expect.any(String));
    expect(backendPostMock).not.toHaveBeenCalledWith('/v1/schedules', expect.anything());
    expect(deleteScheduleMock).not.toHaveBeenCalled();
    expect(endCurrentSectionNowMock).not.toHaveBeenCalled();
  });

  it('falls back to the live plan section when the target module is not planned', async () => {
    getEnabledModulesMock.mockReturnValue(['listening', 'writing']);
    // The requested writing schedule exists but its live plan only has
    // listening (legacy provider mismatch): the resolver reuses the
    // schedule slot and falls back without minting anything new. The
    // slot lookup keys off the requested module, so the fixture carries
    // the writing cohort name.
    const schedule = scheduleFixture({ id: 'sched-plan', module: 'writing' });
    getSchedulesByExamMock.mockResolvedValue([schedule]);
    getRuntimeSnapshotMock.mockResolvedValue(
      runtimeFixture('sched-plan', 'live', 'listening', ['listening']),
    );

    const resolved = await resolvePreviewRuntimeSession({
      exam: examFixture(),
      state: stateFixture(),
      authorUserId: AUTHOR_ID,
      requestedModule: 'writing',
      now: NOW,
    });

    expect(resolved.module).toBe('listening');
    expect(resolved.scheduleId).toBe('sched-plan');
    expect(resolved.planFallbackNotice).toMatch(/writing/);
    expect(resolved.planFallbackNotice).toMatch(/listening/);
    // No section was ever ended toward the unreachable target.
    expect(endCurrentSectionNowMock).not.toHaveBeenCalled();
    expect(startRuntimeMock).not.toHaveBeenCalled();
    expect(createAttemptMock).toHaveBeenCalledWith(
      expect.objectContaining({ currentModule: 'listening' }),
    );
  });

  it('still throws when neither the target nor the live section is enabled', async () => {
    getEnabledModulesMock.mockReturnValue(['writing']);
    const schedule = scheduleFixture({ id: 'sched-plan-unusable', module: 'writing' });
    getSchedulesByExamMock.mockResolvedValue([schedule]);
    getRuntimeSnapshotMock.mockResolvedValue(
      runtimeFixture('sched-plan-unusable', 'live', 'listening', ['listening']),
    );

    await expect(
      resolvePreviewRuntimeSession({
        exam: examFixture(),
        state: stateFixture(),
        authorUserId: AUTHOR_ID,
        requestedModule: 'writing',
        now: NOW,
      }),
    ).rejects.toThrow(/writing/);
    expect(endCurrentSectionNowMock).not.toHaveBeenCalled();
  });

  it('converges on the newest live preview schedule instead of minting another one', async () => {
    const abandoned = scheduleFixture({
      id: 'sched-abandoned',
      module: 'reading',
      updatedAt: '2026-06-01T08:00:00.000Z',
    });
    const current = scheduleFixture({
      id: 'sched-current',
      module: 'reading',
      updatedAt: '2026-06-01T09:55:00.000Z',
    });
    getSchedulesByExamMock.mockResolvedValue([abandoned, current]);
    // The stale duplicate resolves its terminal state during quarantine and
    // the newest duplicate is live-positioned; no creation or mutation needed.
    deleteScheduleMock.mockResolvedValue(undefined as never);
    getRuntimeSnapshotMock.mockImplementation(async (scheduleId: string) =>
      scheduleId === 'sched-abandoned'
        ? runtimeFixture('sched-abandoned', 'completed', null, ['listening', 'reading'])
        : runtimeFixture('sched-current', 'live', 'reading', ['listening', 'reading']),
    );

    const resolved = await resolvePreviewRuntimeSession({
      exam: examFixture(),
      state: stateFixture(),
      authorUserId: AUTHOR_ID,
      requestedModule: 'reading',
      now: NOW,
    });

    expect(resolved.scheduleId).toBe('sched-current');
    expect(backendPostMock).not.toHaveBeenCalledWith('/v1/schedules', expect.anything());
    // The newest live runtime is already positioned: neither start nor
    // section transitions are needed. The abandoned terminal duplicate is
    // quarantined (best-effort delete) without minting a replacement.
    expect(startRuntimeMock).not.toHaveBeenCalled();
    expect(endCurrentSectionNowMock).not.toHaveBeenCalled();
    expect(deleteScheduleMock).toHaveBeenCalledWith('sched-abandoned');
  });

  it('coalesces concurrent identical resolves into a single backend workflow', async () => {
    getSchedulesByExamMock.mockResolvedValue([]);
    const created = scheduleFixture({ id: 'sched-coalesced', module: 'reading' });
    backendPostMock.mockImplementation(async (endpoint: string) => {
      if (endpoint === '/v1/schedules') {
        return created as never;
      }
      return {} as never;
    });
    getRuntimeSnapshotMock.mockResolvedValue(
      runtimeFixture('sched-coalesced', 'live', 'reading', ['listening', 'reading']),
    );

    const options = {
      exam: examFixture(),
      state: stateFixture(),
      authorUserId: AUTHOR_ID,
      requestedModule: 'reading' as ModuleType,
      now: NOW,
    };
    const [first, second] = await Promise.all([
      resolvePreviewRuntimeSession(options),
      resolvePreviewRuntimeSession(options),
    ]);

    expect(first.scheduleId).toBe('sched-coalesced');
    expect(second.scheduleId).toBe('sched-coalesced');
    expect(backendPostMock).toHaveBeenCalledTimes(2);
    const creations = backendPostMock.mock.calls.filter(([endpoint]) => endpoint === '/v1/schedules');
    expect(creations).toHaveLength(1);
    // Fresh schedule starts from not_started: exactly one start command.
    // (quarantine scan + pre-start snapshot both see null first.)
    getRuntimeSnapshotMock.mockReset();
    getRuntimeSnapshotMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(runtimeFixture('sched-coalesced', 'live', 'reading', ['listening', 'reading']));
    startRuntimeMock.mockClear();
    getSchedulesByExamMock.mockResolvedValue([created]);
    const third = await resolvePreviewRuntimeSession({
      exam: examFixture(),
      state: stateFixture(),
      authorUserId: AUTHOR_ID,
      requestedModule: 'reading',
      now: NOW,
    });
    expect(third.scheduleId).toBe('sched-coalesced');
    expect(startRuntimeMock).toHaveBeenCalledTimes(1);
    expect(startRuntimeMock).toHaveBeenCalledWith('sched-coalesced', expect.any(String));
  });
});

/**
 * The room clock's ingest path, driven end to end through the controller.
 *
 * `mergeProctorRuntime`'s unit tests prove the tie-break in isolation and the
 * route tests inject a literal clock; neither shows that the production feeds
 * that populate and re-anchor the accepted server instant agree. Those feeds are
 * `applyMonitoringState` (the 10s/15s polling refresh) and `handleRuntimeSnapshot`
 * (the staff websocket frame), so both are exercised here with the runtime DTOs
 * the backend actually serializes.
 *
 * Which assertions carry the pre-fix failure: the projection stamp and the
 * derived clock in the two "freshest read" tests. Before the fix
 * `mergeProctorRuntime` kept the existing projection whenever the revision did
 * not strictly increase, so `serverNow` (and with it the room's corrected clock)
 * froze at the first payload of a live section's revision, and the socket frame
 * was dropped by the same revision-only gate. The "late older read" guards also
 * pass on the pre-fix code — frozen is also "not moved backwards" — they pin the
 * direction the fix must not overshoot.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type RuntimeSnapshotPayload = { scheduleId?: string; runtime: unknown };

let runtimeSnapshotHandler: ((payload: RuntimeSnapshotPayload) => void) | null = null;

vi.mock('@shared/hooks/useLiveUpdates', () => ({
  useLiveUpdates: (options: {
    onEvent: () => void;
    onRuntimeSnapshot?: (payload: RuntimeSnapshotPayload) => void;
  }) => {
    runtimeSnapshotHandler = options.onRuntimeSnapshot ?? null;
  },
}));

vi.mock('@app/hooks/useAsyncPolling', () => ({
  useAsyncPolling: () => {},
}));

import {
  resolveAuthoritativeRemainingSeconds,
  resolveRoomClock,
  resolveServerClockOffsetMs,
} from '@shared/hooks/useAuthoritativeDeadlineClock';
import {
  useProctorRouteController,
  type ProctorRouteController,
} from '../useProctorRouteController';

const SCHEDULE_ID = 'sched-1';
const FIRST_READ_AT = '2026-01-01T09:20:00.000Z';
const SECOND_READ_AT = '2026-01-01T09:20:30.000Z';
const STALE_READ_AT = '2026-01-01T09:20:10.000Z';
const FRAME_READ_AT = '2026-01-01T09:21:00.000Z';
/** The section's planned window: every read publishes its end 30 minutes out. */
const SECTION_SECONDS = 1_800;
/**
 * The accepted instant must land on the server's own stamp. The mocked reads are
 * months away from this machine's clock, which is the point: a correction that
 * were anchored on render time rather than the payload's receipt would drift by
 * the gap between the two reads instead of pinning the room clock.
 */
const CLOCK_TOLERANCE_MS = 5_000;

function deadlineFor(serverNow: string, seconds = SECTION_SECONDS): string {
  return new Date(Date.parse(serverNow) + seconds * 1_000).toISOString();
}

function buildSchedule() {
  return {
    id: SCHEDULE_ID,
    examId: 'exam-1',
    examTitle: 'Mock Exam',
    publishedVersionId: 'ver-1',
    cohortName: 'Cohort A',
    institution: 'Center',
    startTime: '2026-01-01T09:00:00.000Z',
    endTime: '2026-01-01T12:00:00.000Z',
    plannedDurationMinutes: 180,
    deliveryMode: 'proctor_start',
    recurrenceType: 'none',
    recurrenceInterval: 1,
    autoStart: false,
    autoStop: false,
    status: 'live',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'admin-1',
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: 1,
  };
}

/**
 * One runtime DTO as the backend serializes it. `revision` and `updatedAt` stay
 * put across reads: a live section holds one revision for its whole duration, so
 * the read's own `serverNow` is the only thing that distinguishes two reads of
 * it. That is exactly the case the revision-only gate got wrong.
 */
function buildRuntimePayload(serverNow: string, revision = 1) {
  return {
    id: 'runtime-1',
    scheduleId: SCHEDULE_ID,
    examId: 'exam-1',
    providerKey: 'sat',
    status: 'live',
    planSnapshot: [],
    actualStartAt: '2026-01-01T09:00:00.000Z',
    actualEndAt: null,
    activeSectionKey: 'reading',
    currentSectionKey: 'reading',
    currentSectionRemainingSeconds: SECTION_SECONDS,
    currentSectionDeadlineAt: deadlineFor(serverNow),
    waitingForNextSection: false,
    isOverrun: false,
    totalPausedSeconds: 0,
    createdAt: '2026-01-01T09:00:00.000Z',
    updatedAt: FIRST_READ_AT,
    revision,
    serverNow,
    sections: [
      {
        sectionKey: 'reading',
        label: 'Reading',
        sectionOrder: 1,
        plannedDurationMinutes: 30,
        gapAfterMinutes: 0,
        status: 'live',
        availableAt: '2026-01-01T09:00:00.000Z',
        actualStartAt: '2026-01-01T09:00:00.000Z',
        actualEndAt: null,
        pausedAt: null,
        accumulatedPausedSeconds: 0,
        extensionMinutes: 0,
        completionReason: null,
        projectedStartAt: '2026-01-01T09:00:00.000Z',
        projectedEndAt: deadlineFor(serverNow),
      },
    ],
    examPlan: [],
  };
}

function buildSummaryPayload(serverNow: string) {
  return {
    success: true,
    data: [
      {
        schedule: buildSchedule(),
        runtime: buildRuntimePayload(serverNow),
        studentCount: 1,
        activeCount: 1,
        alertCount: 0,
        violationCount: 0,
        degradedLiveMode: false,
      },
    ],
  };
}

function buildDetailPayload(serverNow: string) {
  return {
    success: true,
    data: {
      schedule: buildSchedule(),
      runtime: buildRuntimePayload(serverNow),
      sessions: [
        {
          attemptId: 'attempt-1',
          studentId: 'alice',
          studentName: 'Alice Roe',
          studentEmail: 'alice@example.com',
          scheduleId: SCHEDULE_ID,
          status: 'active',
          currentSection: 'reading',
          timeRemaining: SECTION_SECONDS,
          runtimeStatus: 'live',
          runtimeCurrentSection: 'reading',
          runtimeTimeRemainingSeconds: SECTION_SECONDS,
          runtimeDeadlineAt: deadlineFor(serverNow),
          runtimeServerNow: serverNow,
          runtimeSectionStatus: 'live',
          runtimeWaiting: false,
          violations: [],
          warnings: 0,
          lastActivity: '2026-01-01T09:19:00.000Z',
          examId: 'exam-1',
          examName: 'Mock Exam',
        },
      ],
      alerts: [],
      auditLogs: [],
      notes: [],
      presence: [],
      violationRules: [],
      degradedLiveMode: false,
    },
  };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/** The reads the room makes, with the stamp each one is answered at. */
function installBackend() {
  const originalFetch = global.fetch;
  let readAt = FIRST_READ_AT;
  let detailReads = 0;

  global.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const isDetail = url.startsWith(`/api/v1/proctor/sessions/${SCHEDULE_ID}?`);
    if (isDetail) {
      detailReads += 1;
    }
    return new Response(JSON.stringify(isDetail ? buildDetailPayload(readAt) : buildSummaryPayload(readAt)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  return {
    /** The next poll answers at this stamp, as the server's clock has moved on. */
    answerAt(next: string) {
      readAt = next;
    },
    detailReads() {
      return detailReads;
    },
    restore() {
      global.fetch = originalFetch;
    },
  };
}

/**
 * The clocks the room derives from the accepted instant, read the way the route
 * reads them: the accepted snapshot wins, and a projection that arrived outside
 * the accepted path still contributes its own `serverNow`.
 */
function readRoomClocks(controller: ProctorRouteController) {
  const runtime = controller.runtimeSnapshots.find((entry) => entry.scheduleId === SCHEDULE_ID) ?? null;
  const clock = resolveRoomClock(controller.roomClock, runtime?.serverNow ?? null);
  const nowMs = Date.now();
  const clockOffsetMs = resolveServerClockOffsetMs(clock, nowMs);
  return {
    runtimeServerNow: runtime?.serverNow ?? null,
    correctedNowMs: nowMs + clockOffsetMs,
    remainingSeconds: resolveAuthoritativeRemainingSeconds({
      deadlineAt: runtime?.currentSectionDeadlineAt ?? null,
      clockOffsetMs,
      fallbackSeconds: 0,
      running: runtime?.status === 'live',
      nowMs,
    }),
  };
}

async function mountRoom(backend: ReturnType<typeof installBackend>) {
  const { result } = renderHook(() => useProctorRouteController(), {
    wrapper: createWrapper(),
  });

  await waitFor(() => {
    expect(result.current.isLoading).toBe(false);
  });

  await act(async () => {
    result.current.setSelectedScheduleId(SCHEDULE_ID);
  });

  await waitFor(() => {
    expect(backend.detailReads()).toBe(1);
  });
  await waitFor(() => {
    expect(result.current.roomClock.serverNow).toBe(FIRST_READ_AT);
  });
  await waitFor(() => {
    expect(runtimeSnapshotHandler).not.toBeNull();
  });

  return result;
}

async function refreshRoom(result: { current: ProctorRouteController }, backend: ReturnType<typeof installBackend>) {
  const readsBefore = backend.detailReads();
  await act(async () => {
    await result.current.reload();
  });
  await waitFor(() => {
    expect(backend.detailReads()).toBeGreaterThan(readsBefore);
  });
  // Let the effect that applies the refreshed reads land before reading clocks.
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useProctorRouteController room clock', () => {
  beforeEach(() => {
    runtimeSnapshotHandler = null;
    localStorage.clear();
    sessionStorage.clear();
  });

  it('tracks the freshest read of an unchanged revision on each polling refresh', async () => {
    const backend = installBackend();
    try {
      const result = await mountRoom(backend);

      const initial = readRoomClocks(result.current);
      expect(result.current.roomClock.serverNow).toBe(FIRST_READ_AT);
      expect(result.current.roomClock.receivedAt).toBeGreaterThan(0);
      expect(initial.runtimeServerNow).toBe(FIRST_READ_AT);
      expect(Math.abs(initial.correctedNowMs - Date.parse(FIRST_READ_AT))).toBeLessThan(
        CLOCK_TOLERANCE_MS,
      );
      expect(Math.abs(initial.remainingSeconds - SECTION_SECONDS)).toBeLessThanOrEqual(1);

      // Same revision, same updatedAt, one live section — only the stamp moves.
      backend.answerAt(SECOND_READ_AT);
      await refreshRoom(result, backend);

      const refreshed = readRoomClocks(result.current);
      expect(result.current.roomClock.serverNow).toBe(SECOND_READ_AT);
      expect(result.current.roomClock.receivedAt).toBeGreaterThan(0);
      // Pre-fix this stayed at FIRST_READ_AT: the equal revision kept the whole
      // existing projection, so the room's clock lagged its own roster rows.
      expect(refreshed.runtimeServerNow).toBe(SECOND_READ_AT);
      expect(Math.abs(refreshed.correctedNowMs - Date.parse(SECOND_READ_AT))).toBeLessThan(
        CLOCK_TOLERANCE_MS,
      );
      expect(Math.abs(refreshed.remainingSeconds - SECTION_SECONDS)).toBeLessThanOrEqual(1);
    } finally {
      backend.restore();
    }
  });

  it('cannot be moved backwards by a late older read of the same revision', async () => {
    const backend = installBackend();
    try {
      const result = await mountRoom(backend);

      backend.answerAt(SECOND_READ_AT);
      await refreshRoom(result, backend);
      expect(result.current.roomClock.serverNow).toBe(SECOND_READ_AT);

      // A slow proxy answers with an older read: its stamp and its deadline are
      // both behind the instant the room already holds.
      backend.answerAt(STALE_READ_AT);
      await refreshRoom(result, backend);

      const afterStale = readRoomClocks(result.current);
      expect(result.current.roomClock.serverNow).toBe(SECOND_READ_AT);
      expect(afterStale.runtimeServerNow).toBe(SECOND_READ_AT);
      expect(Math.abs(afterStale.correctedNowMs - Date.parse(SECOND_READ_AT))).toBeLessThan(
        CLOCK_TOLERANCE_MS,
      );
      expect(Math.abs(afterStale.remainingSeconds - SECTION_SECONDS)).toBeLessThanOrEqual(1);
    } finally {
      backend.restore();
    }
  });

  it('re-anchors on a websocket runtime_snapshot frame carrying a fresher stamp', async () => {
    const backend = installBackend();
    try {
      const result = await mountRoom(backend);
      expect(result.current.roomClock.serverNow).toBe(FIRST_READ_AT);

      await act(async () => {
        runtimeSnapshotHandler?.({ scheduleId: SCHEDULE_ID, runtime: buildRuntimePayload(FRAME_READ_AT) });
      });

      await waitFor(() => {
        expect(result.current.roomClock.serverNow).toBe(FRAME_READ_AT);
      });
      const afterFrame = readRoomClocks(result.current);
      // Pre-fix the frame was dropped by the revision-only gate, so the socket
      // could never carry a fresher clock for a live section.
      expect(afterFrame.runtimeServerNow).toBe(FRAME_READ_AT);
      expect(Math.abs(afterFrame.correctedNowMs - Date.parse(FRAME_READ_AT))).toBeLessThan(
        CLOCK_TOLERANCE_MS,
      );
      expect(Math.abs(afterFrame.remainingSeconds - SECTION_SECONDS)).toBeLessThanOrEqual(1);

      // A duplicated or replayed frame is a read like any other: older loses.
      await act(async () => {
        runtimeSnapshotHandler?.({ scheduleId: SCHEDULE_ID, runtime: buildRuntimePayload(STALE_READ_AT) });
      });

      const afterReplay = readRoomClocks(result.current);
      expect(result.current.roomClock.serverNow).toBe(FRAME_READ_AT);
      expect(afterReplay.runtimeServerNow).toBe(FRAME_READ_AT);
      expect(Math.abs(afterReplay.correctedNowMs - Date.parse(FRAME_READ_AT))).toBeLessThan(
        CLOCK_TOLERANCE_MS,
      );
    } finally {
      backend.restore();
    }
  });
});

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ExamSessionRuntime } from "../../../types/domain";
import { useStudentAutoSubmitBoundary } from "../useStudentAutoSubmitBoundary";

function createRuntimeSnapshot(partial: Partial<ExamSessionRuntime> = {}): ExamSessionRuntime {
  return {
    id: partial.id ?? "runtime-1",
    scheduleId: partial.scheduleId ?? "schedule-1",
    status: partial.status ?? "live",
    waitingForNextSection: partial.waitingForNextSection ?? false,
    currentSectionKey: partial.currentSectionKey ?? "reading",
    activeSectionKey: partial.activeSectionKey ?? "reading",
    currentSectionRemainingSeconds: partial.currentSectionRemainingSeconds ?? 10,
    extensionMinutes: partial.extensionMinutes ?? 0,
    actualStartAt: partial.actualStartAt ?? "2026-01-01T00:00:00.000Z",
    actualEndAt: partial.actualEndAt ?? null,
    sections: partial.sections ?? [
      {
        key: "reading",
        status: "live",
        orderIndex: 1,
        plannedDurationMinutes: 60,
        availableAt: "2026-01-01T00:00:00.000Z",
        actualStartAt: "2026-01-01T00:00:00.000Z",
        actualEndAt: null,
        completionReason: null,
        transitionPolicy: "manual",
        plannedStartOffsetSeconds: 0,
        plannedDurationSeconds: 3600,
        projectedStartAt: "2026-01-01T00:00:00.000Z",
        projectedEndAt: "2026-01-01T01:00:00.000Z",
      },
    ],
    createdAt: partial.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: partial.updatedAt ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("useStudentAutoSubmitBoundary", () => {
  it("auto-submits a self-timed ACT Science section once when the timer reaches zero", async () => {
    const flushAndSubmitCurrentModuleWithRetry = vi.fn().mockResolvedValue(undefined);
    const runtimeState = {
      blockingActive: false,
      displayTimeRemaining: 1,
      runtimeBacked: false,
      runtimeStatus: null,
      currentModule: "science" as const,
      runtimeSnapshot: null,
    };

    const { rerender } = renderHook(
      (props: typeof runtimeState) =>
        useStudentAutoSubmitBoundary({
          effectivePhase: "exam",
          autoSubmitEnabled: true,
          runtimeState: props,
          flushAndSubmitCurrentModuleWithRetry,
        }),
      { initialProps: runtimeState }
    );

    rerender({ ...runtimeState, displayTimeRemaining: 0 });

    await act(async () => {
      await Promise.resolve();
    });

    expect(flushAndSubmitCurrentModuleWithRetry).toHaveBeenCalledTimes(1);
    expect(flushAndSubmitCurrentModuleWithRetry).toHaveBeenCalledWith("self:science");

    rerender({ ...runtimeState, displayTimeRemaining: 0 });

    await act(async () => {
      await Promise.resolve();
    });

    expect(flushAndSubmitCurrentModuleWithRetry).toHaveBeenCalledTimes(1);
  });

  it("submits once when runtime confirms section boundary at zero remaining", async () => {
    const flushAndSubmitCurrentModuleWithRetry = vi.fn().mockResolvedValue(undefined);

    const runtimeState = {
      blockingActive: false,
      displayTimeRemaining: 1,
      runtimeBacked: true,
      runtimeStatus: "live" as const,
      currentModule: "reading" as const,
      runtimeSnapshot: createRuntimeSnapshot({
        currentSectionKey: "reading",
        currentSectionRemainingSeconds: 1,
      }),
    };

    const { rerender } = renderHook(
      (props: typeof runtimeState) =>
        useStudentAutoSubmitBoundary({
          effectivePhase: "exam",
          autoSubmitEnabled: true,
          runtimeState: props,
          flushAndSubmitCurrentModuleWithRetry,
        }),
      { initialProps: runtimeState }
    );

    rerender({
      ...runtimeState,
      displayTimeRemaining: 0,
      runtimeSnapshot: createRuntimeSnapshot({
        currentSectionKey: "listening",
        currentSectionRemainingSeconds: 0,
      }),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(flushAndSubmitCurrentModuleWithRetry).toHaveBeenCalledTimes(1);
    expect(flushAndSubmitCurrentModuleWithRetry).toHaveBeenCalledWith("runtime:reading");

    rerender({
      ...runtimeState,
      displayTimeRemaining: 0,
      runtimeSnapshot: createRuntimeSnapshot({
        currentSectionKey: "listening",
        currentSectionRemainingSeconds: 0,
      }),
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(flushAndSubmitCurrentModuleWithRetry).toHaveBeenCalledTimes(1);
  });

  it("does not submit in runtime mode when boundary is not confirmed by server", async () => {
    const flushAndSubmitCurrentModuleWithRetry = vi.fn().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({ displayTimeRemaining }: { displayTimeRemaining: number }) =>
        useStudentAutoSubmitBoundary({
          effectivePhase: "exam",
          autoSubmitEnabled: true,
          runtimeState: {
            blockingActive: false,
            displayTimeRemaining,
            runtimeBacked: true,
            runtimeStatus: "live",
            currentModule: "reading",
            runtimeSnapshot: createRuntimeSnapshot({
              currentSectionKey: "reading",
              currentSectionRemainingSeconds: 12,
            }),
          },
          flushAndSubmitCurrentModuleWithRetry,
        }),
      {
        initialProps: { displayTimeRemaining: 1 },
      }
    );

    rerender({ displayTimeRemaining: 0 });

    await act(async () => {
      await Promise.resolve();
    });

    expect(flushAndSubmitCurrentModuleWithRetry).not.toHaveBeenCalled();
  });
});

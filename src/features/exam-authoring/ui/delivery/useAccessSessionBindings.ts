import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { proctorKeys, useProctorSessionSummaries } from "../../../proctor/api/proctorQueries";
import {
  sessionPhaseFromRuntime,
  type AccessSessionBindings,
  type AccessSessionInfo,
} from "./sessionState";

const POLL_MS = 6_000;

interface Options {
  /** Only roles whose routes allow running sessions read session state at all. */
  canRun: boolean;
  onOpenRoom: (scheduleId: string) => void;
  onOpenResults: (scheduleId: string) => void;
}

/**
 * Session status and navigation for a test's Sessions tab, built from the same
 * session summaries the session room uses (no second source of truth). Runtime
 * commands live in the room only. A failed read is reported as stale instead of
 * being turned into a guess about whether a session is running.
 */
export function useAccessSessionBindings({ canRun, onOpenRoom, onOpenResults }: Options): AccessSessionBindings {
  const queryClient = useQueryClient();
  const summaries = useProctorSessionSummaries(POLL_MS, "sat", canRun);
  // A malformed payload is treated like a failed read (stale), never iterated: a bad
  // session endpoint must not take the whole Delivery page down.
  const data = Array.isArray(summaries.data) ? summaries.data : undefined;

  const infoByScheduleId = useMemo(() => {
    const map = new Map<string, AccessSessionInfo>();
    for (const summary of data ?? []) {
      const runtime = summary.runtime as { status?: string; timingModel?: string | null };
      map.set(summary.schedule.id, {
        phase: sessionPhaseFromRuntime(runtime.status, (summary.schedule as { status?: string }).status),
        timingModel: runtime.timingModel ?? null,
        joined: summary.joinTotalCount ?? null,
        ready: summary.joinReadyCount ?? null,
      });
    }
    return map;
  }, [data]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: proctorKeys.sessions("sat") });

  return {
    canRun,
    infoFor: (scheduleId) => infoByScheduleId.get(scheduleId) ?? null,
    stale: canRun && (summaries.isError || (summaries.isFetched && !data)),
    refreshing: summaries.isFetching,
    onRefresh: refresh,
    onOpenRoom,
    onOpenResults,
  };
}

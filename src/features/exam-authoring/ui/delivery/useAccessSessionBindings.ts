import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { proctorFacade } from "../../../proctor/api/proctorFacade";
import { fetchProctorSessionSummaries, proctorKeys, useProctorSessionSummaries } from "../../../proctor/api/proctorQueries";
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
  onOpenResponses: (scheduleId: string) => void;
}

/**
 * Session status and commands for the Delivery page, built from the same
 * session summaries and runtime commands the session room uses (no second
 * source of truth). A failed read is reported as stale instead of being turned
 * into a guess about whether a session is running.
 */
export function useAccessSessionBindings({ canRun, onOpenRoom, onOpenResponses }: Options): AccessSessionBindings {
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

  const command = async (scheduleId: string, expectedPhase: "ready" | "paused", run: () => Promise<{ success: boolean; error?: string }>, fallback: string) => {
    if (!canRun) throw new Error("You do not have permission to run this session.");
    // Read again at confirmation: cached list status cannot authorize a live command.
    const current = await queryClient.fetchQuery({
      queryKey: proctorKeys.sessions("sat"),
      queryFn: () => fetchProctorSessionSummaries("sat"),
      staleTime: 0,
    });
    const summary = current.find((item) => item.schedule.id === scheduleId);
    if (!summary || sessionPhaseFromRuntime(summary.runtime.status, summary.schedule.status) !== expectedPhase) {
      throw new Error("Session status changed. Review the refreshed status before continuing.");
    }
    const result = await run();
    if (!result.success) {
      await queryClient.invalidateQueries({ queryKey: proctorKeys.sessions("sat") });
      throw new Error(`${result.error ?? fallback} Refresh status to confirm the outcome before retrying.`);
    }
    await queryClient.invalidateQueries({ queryKey: proctorKeys.sessions("sat") });
  };

  return {
    canRun,
    infoFor: (scheduleId) => infoByScheduleId.get(scheduleId) ?? null,
    stale: canRun && (summaries.isError || (summaries.isFetched && !data)),
    refreshing: summaries.isFetching,
    onRefresh: refresh,
    onStart: (scheduleId) =>
      command(scheduleId, "ready", () => proctorFacade.delivery.startRuntime(scheduleId, "Staff"), "We could not confirm whether the session started."),
    onResume: (scheduleId) =>
      command(scheduleId, "paused", () => proctorFacade.delivery.resumeRuntime(scheduleId, "Staff"), "We could not confirm whether the session resumed."),
    onOpenRoom,
    onOpenResponses,
  };
}

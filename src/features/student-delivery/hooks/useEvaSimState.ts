import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { EvaAck, EvaState } from "@/src/features/assessment-forms/api/assessmentForms";
import { assessmentDeliveryApi } from "../api/assessmentDeliveryApi";

export const evaSimKey = (scheduleId: string, attemptId: string) => ["eva-sim", scheduleId, attemptId] as const;

/** 10–15 s with jitter so a whole room does not poll in lockstep. */
function pollIntervalMs(): number {
  return 10_000 + Math.floor(Math.random() * 5_000);
}

/**
 * Eva SIM state for a completed attempt, polled independently of the exam
 * state. React Query pauses the interval while the tab is hidden and
 * refetches on focus. Closure is monotonic on the client too: once a closed
 * state is observed, a later (stale) open response cannot reopen access.
 */
export function useEvaSimState(scheduleId: string, attemptId: string) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: evaSimKey(scheduleId, attemptId),
    queryFn: () => assessmentDeliveryApi.evaSim(scheduleId, attemptId),
    refetchInterval: (q) => (q.state.data?.eligibility === "not_applicable" ? false : pollIntervalMs()),
    refetchOnWindowFocus: true,
    retry: 1,
    staleTime: 0,
  });

  const [closedSeen, setClosedSeen] = useState(false);
  const data = query.data;
  if (!closedSeen && data?.eligibility === "eligible" && data.collection === "closed") setClosedSeen(true);

  let state: EvaState | undefined = data;
  if (closedSeen && data?.eligibility === "eligible" && data.collection === "open") {
    state =
      data.mode === "native"
        ? { ...data, collection: "closed", canSubmit: false, canReturnToComplete: true }
        : { ...data, collection: "closed", canOpen: false, embedUrl: null, externalOpenUrl: null };
  }

  /** Applies an acknowledged native write to the cached state. */
  const applyAck = useCallback(
    (ack: EvaAck) => {
      client.setQueryData<EvaState>(evaSimKey(scheduleId, attemptId), (prev) =>
        prev && prev.eligibility === "eligible" && prev.mode === "native"
          ? {
              ...prev,
              response: "submitted",
              answers: ack.answers,
              revision: ack.revision,
              firstSubmittedAt: ack.firstSubmittedAt,
              updatedAt: ack.updatedAt,
              canReturnToComplete: true,
            }
          : prev
      );
    },
    [attemptId, client, scheduleId]
  );

  return {
    state,
    isLoading: query.isPending,
    /** The latest read failed (initial load or a revalidation). */
    isError: query.isError,
    isFetching: query.isFetching,
    refetch: query.refetch,
    applyAck,
  };
}

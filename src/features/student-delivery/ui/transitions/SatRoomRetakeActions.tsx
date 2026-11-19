import { useId, useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  backendGet,
  backendPost,
  ensureClientSessionIdForStudentKey,
  satWriterStudentKey,
  storeAttemptCredential,
  type BackendAttemptCredential,
} from "../../infrastructure/assessmentDeliveryBackendGateway";

type LearningState = {
  canRetakeTest: boolean;
  lastOrdinal: number;
};

type Retake = BackendAttemptCredential & { attemptId: string };

export function SatRoomRetakeActions({ scheduleId, attemptId, candidateId }: {
  scheduleId: string;
  attemptId: string;
  candidateId: string;
}) {
  const path = `/v1/sat/practice/schedules/${encodeURIComponent(scheduleId)}`;
  const operation = useRef<{ ordinal: number; key: string } | null>(null);
  const learning = useQuery({
    queryKey: ["sat", "room-learning", scheduleId, attemptId],
    queryFn: () => backendGet<LearningState>(`${path}/learning-state`, { skipUnauthorizedHandler: true }),
    retry: false,
  });
  const retake = useMutation({
    mutationFn: async () => {
      const ordinal = learning.data?.lastOrdinal;
      if (!ordinal) throw new Error("Reload the exam to check which attempts are available.");
      if (operation.current?.ordinal !== ordinal) {
        operation.current = { ordinal, key: crypto.randomUUID() };
      }
      const result = await backendPost<Retake>(`${path}/attempts`, {
        mode: "test",
        intent: "retake",
        observedOrdinal: ordinal,
        clientSessionId: ensureClientSessionIdForStudentKey(scheduleId, satWriterStudentKey(scheduleId, candidateId)),
      }, { headers: { "Idempotency-Key": operation.current.key }, retries: 0, skipUnauthorizedHandler: true });
      storeAttemptCredential({ id: result.attemptId, scheduleId }, result);
    },
    onSuccess: () => window.location.reload(),
    onError: () => { void learning.refetch(); },
  });
  return (
    <SatRoomRetakeControls
      canRetakeTest={learning.data?.canRetakeTest ?? false}
      pending={retake.isPending}
      error={retake.error?.message}
      onStart={() => retake.mutate()}
    />
  );
}

export function SatRoomRetakeControls({ canRetakeTest, pending, error, onStart }: {
  canRetakeTest: boolean;
  pending?: boolean;
  error?: string | undefined;
  onStart: () => void;
}) {
  const descriptionId = useId();
  if (!canRetakeTest && !error) return null;
  return (
    <section aria-label="Take the exam again" className="w-full sm:w-44">
      {canRetakeTest ? (
        <>
          <button
            type="button"
            aria-describedby={descriptionId}
            disabled={pending}
            onClick={onStart}
            className="sat-touch-target sat-pressable inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[var(--sat-accent)] px-6 text-[14px] font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2 sm:w-auto"
          >
            {pending ? "Starting exam…" : "Start exam again"}
          </button>
          <p id={descriptionId} className="mt-2 text-[13px] leading-5 text-[var(--sat-text-secondary)]">
            Start from question 1 with a fresh timer. Your previous answers stay saved.
          </p>
        </>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-sm">{error}</p> : null}
    </section>
  );
}

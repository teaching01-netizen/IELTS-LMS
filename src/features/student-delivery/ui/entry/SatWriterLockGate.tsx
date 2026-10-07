import { useEffect, useState, type ReactNode } from "react";
import { acquireSatWriterLock } from "../../infrastructure/satWriterLock";
import { SAT_COPY } from "../../domain/satCopy";
import { SatErrorSurface, SatLoadingSurface } from "../feedback/SatStateSurfaces";

type LockState = "pending" | "acquired" | "held" | "unsupported";

/**
 * One writer tab per browser: only the tab holding the per-attempt Web Lock
 * mounts the exam (durability engine, credential refresh, shared local
 * outbox). Another tab of the same browser is told so and never mounts it;
 * it does not wait and silently start writing later.
 */
export function SatWriterLockGate({
  scheduleId,
  attemptId,
  children,
}: {
  scheduleId: string;
  attemptId: string;
  children: ReactNode;
}) {
  const [lockGeneration, setLockGeneration] = useState(0);
  const [lockState, setLockState] = useState<LockState>("pending");

  useEffect(() => {
    let active = true;
    let release: (() => void) | null = null;
    setLockState("pending");
    void acquireSatWriterLock(scheduleId, attemptId).then((result) => {
      if (!active) {
        if (result.status === "acquired") result.release();
        return;
      }
      if (result.status === "acquired") release = result.release;
      setLockState(result.status);
    });
    return () => {
      active = false;
      release?.();
    };
  }, [attemptId, lockGeneration, scheduleId]);

  if (lockState === "pending") return <SatLoadingSurface kind="initial" />;
  if (lockState === "held") {
    return (
      <SatErrorSurface
        title={SAT_COPY.deviceTransfer.duplicateTabTitle}
        description={SAT_COPY.deviceTransfer.duplicateTabBody}
        actionLabel={SAT_COPY.deviceTransfer.retry}
        onAction={() => setLockGeneration((generation) => generation + 1)}
      />
    );
  }
  if (lockState === "unsupported") {
    return (
      <SatErrorSurface
        title={SAT_COPY.deviceTransfer.unsupportedTitle}
        description={SAT_COPY.deviceTransfer.unsupportedBody}
      />
    );
  }
  return <>{children}</>;
}

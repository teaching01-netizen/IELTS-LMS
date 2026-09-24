import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useRoomClockMs } from '@shared/hooks/useAuthoritativeDeadlineClock';
import { deriveSatTemporalSnapshot, type SatTemporalModel } from './satTemporalModel';

const SatTemporalContext = createContext<SatTemporalModel | null>(null);

export type SatTemporalBoundary = 'expiry' | 'expiry-reset' | 'break-end';

export function SatTemporalRuntime({
  model,
  onBoundary,
  children,
}: {
  model: SatTemporalModel | null;
  onBoundary?: (boundary: SatTemporalBoundary, key: string) => void;
  children: ReactNode;
}) {
  const now = useRoomClockMs();
  const firedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!model) return;
    const snapshot = deriveSatTemporalSnapshot(model, now);
    const attempt = model.stateModuleAttempt;
    const attemptKey = attempt ? `${attempt.moduleId}:${attempt.id}` : null;
    if (attemptKey && !attempt?.pausedAt && snapshot.expirySeconds !== null) {
      const key = `expiry:${attemptKey}`;
      if (snapshot.expirySeconds <= 0) {
        if (!firedRef.current.has(key)) {
          firedRef.current.add(key);
          onBoundary?.('expiry', attemptKey);
        }
      } else if (firedRef.current.delete(key)) {
        onBoundary?.('expiry-reset', attemptKey);
      }
    }

    const data = model.data;
    const timing = model.effectiveTiming;
    const revision = timing?.runtimeRevision ?? data?.timing.runtimeRevision;
    if (
      data?.scheduleRuntimeStatus === 'live' &&
      timing?.waitingForNextSection &&
      snapshot.nextSectionStartSeconds <= 0
    ) {
      const key = `break-end:${data.attempt.id}:${revision ?? 'unknown'}`;
      if (!firedRef.current.has(key)) {
        firedRef.current.add(key);
        onBoundary?.('break-end', key);
      }
    }
    const personalBreak = data?.attempt.personalBreaks?.find((candidate) => candidate.state !== 'completed');
    if (
      data?.scheduleRuntimeStatus === 'live' &&
      personalBreak?.state === 'active' &&
      !personalBreak.pausedAt &&
      snapshot.pendingBreakSeconds <= 0
    ) {
      const key = `personal-break-end:${data.attempt.id}:${personalBreak.id}:${personalBreak.entryGeneration}`;
      if (!firedRef.current.has(key)) {
        firedRef.current.add(key);
        onBoundary?.('break-end', key);
      }
    }
  }, [model, now, onBoundary]);

  return <SatTemporalContext.Provider value={model}>{children}</SatTemporalContext.Provider>;
}

export function useSatTemporalSnapshot() {
  const model = useContext(SatTemporalContext);
  const now = useRoomClockMs();
  return model ? deriveSatTemporalSnapshot(model, now) : null;
}

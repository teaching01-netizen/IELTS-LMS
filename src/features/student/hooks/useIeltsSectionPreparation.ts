import { useEffect, useState } from 'react';
import { verifyAnswerStorage } from '../application/ieltsSectionPreparation';
import { emitStudentObservabilityMetric } from '../../../utils/studentObservability';

export type IeltsSectionPreparationStatus = 'idle' | 'pending' | 'ready' | 'failed';

/**
 * Local-only preparation of one successor section before the current one
 * expires. It checks already-delivered content and probes answer storage; it
 * never calls /ready, changes the module, renders inputs, plays audio, or
 * starts a clock. The result is ephemeral and keyed by `contextKey`
 * (attempt, version, successor, control/recovery context): any change resets it.
 */
export function useIeltsSectionPreparation(input: {
  enabled: boolean;
  contextKey: string | null;
  attemptId: string | null;
  contentAvailable: boolean;
}): IeltsSectionPreparationStatus {
  const { enabled, contextKey, attemptId, contentAvailable } = input;
  const [result, setResult] = useState<{ key: string; status: IeltsSectionPreparationStatus } | null>(
    null,
  );
  const active = enabled && Boolean(contextKey) && Boolean(attemptId);
  const settledForContext = result?.key === contextKey && result.status === 'ready';

  useEffect(() => {
    if (!active || !contextKey || !attemptId || settledForContext) return;
    if (!contentAvailable) {
      setResult({ key: contextKey, status: 'failed' });
      return;
    }
    let cancelled = false;
    setResult({ key: contextKey, status: 'pending' });
    const startedAt = performance.now();
    void verifyAnswerStorage(attemptId).then((ok) => {
      if (cancelled) return;
      setResult({ key: contextKey, status: ok ? 'ready' : 'failed' });
      emitStudentObservabilityMetric('ielts_section_preparation', {
        reason: ok ? 'ready' : 'storage_failed',
        latencyMs: Math.round(performance.now() - startedAt),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [active, attemptId, contentAvailable, contextKey, settledForContext]);

  if (!active || result?.key !== contextKey) return active ? 'pending' : 'idle';
  return result.status;
}

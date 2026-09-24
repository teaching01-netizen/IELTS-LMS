import { useEffect } from 'react';
import { SatStudentSessionRoute } from '../../student-delivery/routes/SatStudentSessionRoute';
import { clearSatResumeLocator, loadSatResumeLocator, saveSatResumeLocator } from '../../student-delivery/api/satResumeLocator';
import { getVerifiedTerminalState } from '../domain/exam-session/terminalState';
import type { StudentAttempt } from '../../../types/studentAttempt';
import type { ExamSessionRuntime } from '../../../types/domain';
import type { SatBootstrapSeed } from '../../student-delivery/api/satBootstrap';

interface SatStudentDeliveryBranchProps {
  scheduleId: string;
  attemptSnapshot: StudentAttempt;
  runtimeSnapshot: ExamSessionRuntime | null;
  liveSocketConnected: boolean;
  satAttemptUpdateToken: number;
  satBootstrapSeed: SatBootstrapSeed | null;
  onExit: () => void | Promise<void>;
}

export function SatStudentDeliveryBranch({
  scheduleId,
  attemptSnapshot,
  runtimeSnapshot,
  liveSocketConnected,
  satAttemptUpdateToken,
  satBootstrapSeed,
  onExit,
}: SatStudentDeliveryBranchProps) {
  useEffect(() => {
    if (!attemptSnapshot.id || !attemptSnapshot.candidateId) return;
    const terminal = getVerifiedTerminalState({ attempt: attemptSnapshot, runtime: runtimeSnapshot });
    if (terminal !== 'not_terminal') {
      clearSatResumeLocator();
      return;
    }
    const prior = loadSatResumeLocator();
    saveSatResumeLocator({
      scheduleId,
      candidateId: attemptSnapshot.candidateId,
      attemptId: attemptSnapshot.id,
      ...(prior?.scheduleId === scheduleId && prior.candidateId === attemptSnapshot.candidateId && prior.accessLinkId
        ? { accessLinkId: prior.accessLinkId }
        : {}),
    });
  }, [attemptSnapshot, runtimeSnapshot, scheduleId]);

  return (
    <SatStudentSessionRoute
      scheduleId={scheduleId}
      attemptId={attemptSnapshot.id}
      candidateId={attemptSnapshot.candidateId}
      attemptSnapshot={attemptSnapshot}
      runtimeSnapshot={runtimeSnapshot}
      liveSocketConnected={liveSocketConnected}
      attemptUpdateToken={satAttemptUpdateToken}
      leaseEpoch={attemptSnapshot.leaseEpoch}
      controlEpoch={attemptSnapshot.controlEpoch}
      bootstrapSeed={satBootstrapSeed}
      initialIsLoading={false}
      onExit={onExit}
    />
  );
}

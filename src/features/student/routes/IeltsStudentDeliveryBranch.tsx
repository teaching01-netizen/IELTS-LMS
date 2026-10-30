import { StudentAppWrapper } from '@components/student/StudentAppWrapper';
import type { ExamState } from '../../../types';
import type { ExamSessionRuntime } from '../../../types/domain';
import type { StudentAttempt } from '../../../types/studentAttempt';
import type { StudentAnswerInvariantRollout } from '../hooks/useStudentSessionRouteData';
import type { IeltsOfflinePackage } from '../infrastructure/ieltsOfflinePackageStore';
import { useIeltsOfflineContinuity } from '../hooks/useIeltsOfflineContinuity';
import { IeltsOfflineStatusNotice } from '../ui/IeltsOfflineStatusNotice';

interface IeltsStudentDeliveryBranchProps {
  state: ExamState;
  scheduleId: string | undefined;
  attemptSnapshot: StudentAttempt | null;
  runtimeSnapshot: ExamSessionRuntime | null;
  answerInvariantRollout: StudentAnswerInvariantRollout;
  refreshRuntime: () => Promise<void>;
  onExit: () => void | Promise<void>;
  staticPayload?: Record<string, unknown> | null;
  offlinePackage?: IeltsOfflinePackage | null;
  candidateId?: string | null;
  userId?: string | null;
}

export function IeltsStudentDeliveryBranch(props: IeltsStudentDeliveryBranchProps) {
  const continuity = useIeltsOfflineContinuity({
    runtimeSnapshot: props.runtimeSnapshot,
    attemptSnapshot: props.attemptSnapshot,
    staticPayload: props.staticPayload ?? null,
    offlinePackage: props.offlinePackage ?? null,
    userId: props.userId ?? null,
    candidateId: props.candidateId ?? null,
  });
  return (
    <>
      <IeltsOfflineStatusNotice continuity={continuity} attemptSnapshot={props.attemptSnapshot} />
      <StudentAppWrapper
        state={props.state}
        onExit={props.onExit}
        scheduleId={props.scheduleId}
        attemptSnapshot={props.attemptSnapshot}
        onRuntimeRefresh={props.refreshRuntime}
        runtimeSnapshot={continuity.runtimeSnapshot}
        answerInvariantRollout={props.answerInvariantRollout}
        showSubmitControls={false}
        allowExitDuringExam={false}
      />
    </>
  );
}

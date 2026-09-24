import { StudentAppWrapper } from '@components/student/StudentAppWrapper';
import type { ExamState } from '../../../types';
import type { ExamSessionRuntime } from '../../../types/domain';
import type { StudentAttempt } from '../../../types/studentAttempt';
import type { StudentAnswerInvariantRollout } from '../hooks/useStudentSessionRouteData';

interface IeltsStudentDeliveryBranchProps {
  state: ExamState;
  scheduleId: string | undefined;
  attemptSnapshot: StudentAttempt | null;
  runtimeSnapshot: ExamSessionRuntime | null;
  answerInvariantRollout: StudentAnswerInvariantRollout;
  refreshRuntime: () => Promise<void>;
  onExit: () => void | Promise<void>;
}

export function IeltsStudentDeliveryBranch(props: IeltsStudentDeliveryBranchProps) {
  return (
    <StudentAppWrapper
      state={props.state}
      onExit={props.onExit}
      scheduleId={props.scheduleId}
      attemptSnapshot={props.attemptSnapshot}
      onRuntimeRefresh={props.refreshRuntime}
      runtimeSnapshot={props.runtimeSnapshot}
      answerInvariantRollout={props.answerInvariantRollout}
      showSubmitControls={false}
      allowExitDuringExam={false}
    />
  );
}

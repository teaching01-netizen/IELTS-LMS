import type { DraftCommitPort } from '../../contracts/exam-session/DraftCommitPort';
import type { StudentExamStore } from './studentExamStoreFactory';
import {
  runStudentSubmissionCoordinator,
  runStudentSubmissionAfterBarrier,
  runStudentSubmissionBarrier,
  type StudentSubmissionCoordinatorResult,
  type StudentSubmissionBarrierResult,
  type StudentSubmissionTransport,
} from './studentSubmissionCoordinator';

export interface StudentSubmissionCommands {
  requestSubmit(): Promise<StudentSubmissionCoordinatorResult>;
  flushBarrier(): Promise<StudentSubmissionBarrierResult>;
  submitAfterBarrier(): Promise<StudentSubmissionCoordinatorResult>;
}

export interface StudentSubmissionCommandContext {
  readonly store: StudentExamStore;
  readonly drafts: DraftCommitPort;
  readonly transport: StudentSubmissionTransport;
}

export function createStudentSubmissionCommands(
  context: StudentSubmissionCommandContext,
): StudentSubmissionCommands {
  return {
    requestSubmit: () => runStudentSubmissionCoordinator(context),
    flushBarrier: () => runStudentSubmissionBarrier(context),
    submitAfterBarrier: () => runStudentSubmissionAfterBarrier(context),
  };
}

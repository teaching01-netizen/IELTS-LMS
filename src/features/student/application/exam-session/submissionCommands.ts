import type { DraftCommitPort } from '../../contracts/exam-session/DraftCommitPort';
import type { StudentExamStore } from './studentExamStoreFactory';
import {
  runStudentSubmissionCoordinator,
  runStudentSubmissionBarrier,
  type StudentSubmissionCoordinatorResult,
  type StudentSubmissionBarrierResult,
  type StudentSubmissionTransport,
} from './studentSubmissionCoordinator';

export interface StudentSubmissionCommands {
  requestSubmit(): Promise<StudentSubmissionCoordinatorResult>;
  flushBarrier(): Promise<StudentSubmissionBarrierResult>;
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
  };
}

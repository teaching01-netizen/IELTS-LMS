import type { DraftCommitPort } from '../../contracts/exam-session/DraftCommitPort';
import type { StudentExamStore } from './studentExamStoreFactory';

export interface StudentSubmissionTransport {
  flushPending(): Promise<boolean>;
  submit(): Promise<boolean>;
}

export interface StudentSubmissionCoordinatorDependencies {
  readonly store: StudentExamStore;
  readonly drafts: DraftCommitPort;
  readonly transport: StudentSubmissionTransport;
}

export type StudentSubmissionCoordinatorResult =
  | { readonly kind: 'submitted' }
  | { readonly kind: 'blocked'; readonly reason: 'draft_commit_failed' | 'durability_failed' }
  | { readonly kind: 'failed' };

export type StudentSubmissionBarrierResult =
  | { readonly kind: 'ready' }
  | { readonly kind: 'blocked'; readonly reason: 'draft_commit_failed' | 'durability_failed' };

export async function runStudentSubmissionBarrier(
  dependencies: StudentSubmissionCoordinatorDependencies,
): Promise<StudentSubmissionBarrierResult> {
  try {
    await dependencies.drafts.commitAll();
    await dependencies.drafts.flushDurability();
  } catch {
    return { kind: 'blocked', reason: 'draft_commit_failed' };
  }

  const flushed = await dependencies.transport.flushPending();
  if (!flushed) {
    dependencies.store.getState().actions.setPersistence({ syncState: 'error' });
    return { kind: 'blocked', reason: 'durability_failed' };
  }

  return { kind: 'ready' };
}

export async function runStudentSubmissionCoordinator(
  dependencies: StudentSubmissionCoordinatorDependencies,
): Promise<StudentSubmissionCoordinatorResult> {
  const barrier = await runStudentSubmissionBarrier(dependencies);
  if (barrier.kind === 'blocked') {
    return barrier;
  }

  const submitted = await dependencies.transport.submit();
  return submitted ? { kind: 'submitted' } : { kind: 'failed' };
}

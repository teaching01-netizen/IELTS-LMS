import { subscribeWithSelector } from 'zustand/middleware';
import { createStore as createVanillaStore, type StoreApi } from 'zustand/vanilla';
import type { ModuleType } from '../../../../types';
import type { ExamSessionRuntime } from '../../../../types/domain';
import type {
  AttemptSyncState,
  StudentAnswerMutationMeta,
  StudentAnswerValue,
} from '../../../../types/studentAttempt';
import { resolveObjectiveAnswerUpdate } from '../../domain/exam-session/answerPolicy';
import type { StudentBlockingReason } from '../../domain/exam-session/blockingPolicy';
import type { StudentExamPhase } from '../../domain/exam-session/studentExamPhase';

export interface StudentExamStoreSeed {
  readonly attemptId: string | null;
  readonly scheduleId: string;
  readonly candidateId: string | null;
  readonly phase: StudentExamPhase;
  readonly currentModule: ModuleType;
  readonly currentQuestionId: string | null;
  readonly answers: Readonly<Record<string, StudentAnswerValue>>;
  readonly writingAnswers: Readonly<Record<string, string>>;
  readonly flags: Readonly<Record<string, boolean>>;
  readonly runtimeSnapshot: ExamSessionRuntime | null;
  readonly displayTimeRemaining: number | null;
  readonly syncState: AttemptSyncState;
  readonly pendingMutationCount: number;
  readonly acceptedThroughSeq: number;
  readonly blocking?: {
    readonly active: boolean;
    readonly reason: StudentBlockingReason;
    readonly timeRemaining?: number;
  };
}

export interface StudentExamSessionActions {
  setObjectiveAnswer(
    questionId: string,
    value: StudentAnswerValue,
    meta?: StudentAnswerMutationMeta,
  ): void;
  setWritingAnswer(taskId: string, value: string): void;
  toggleFlag(questionId: string): void;
  setNavigation(module: ModuleType, questionId: string | null): void;
  setPhase(phase: StudentExamPhase): void;
  setRuntimeSnapshot(runtime: ExamSessionRuntime | null, displayTimeRemaining: number | null): void;
  setPersistence(update: {
    readonly syncState?: AttemptSyncState;
    readonly pendingMutationCount?: number;
    readonly acceptedThroughSeq?: number;
  }): void;
  setBlocking(blocking: {
    readonly active: boolean;
    readonly reason: StudentBlockingReason;
    readonly timeRemaining: number;
  }): void;
}

export interface StudentExamSessionState {
  readonly identity: {
    readonly attemptId: string | null;
    readonly scheduleId: string;
    readonly candidateId: string | null;
    readonly scopeKey: string;
  };
  readonly phase: StudentExamPhase;
  readonly navigation: {
    readonly currentModule: ModuleType;
    readonly currentQuestionId: string | null;
  };
  readonly attempt: {
    readonly answers: Readonly<Record<string, StudentAnswerValue>>;
    readonly writingAnswers: Readonly<Record<string, string>>;
    readonly flags: Readonly<Record<string, boolean>>;
  };
  readonly runtime: {
    readonly snapshot: ExamSessionRuntime | null;
    readonly displayTimeRemaining: number | null;
  };
  readonly persistence: {
    readonly syncState: AttemptSyncState;
    readonly pendingMutationCount: number;
    readonly acceptedThroughSeq: number;
  };
  readonly blocking: {
    readonly active: boolean;
    readonly reason: StudentBlockingReason;
    readonly timeRemaining: number;
  };
  readonly actions: StudentExamSessionActions;
}

export type StudentExamStore = StoreApi<StudentExamSessionState> & {
  subscribe<U>(
    selector: (state: StudentExamSessionState) => U,
    listener: (selected: U, previous: U) => void,
  ): () => void;
};

export function getStudentExamScopeKey(seed: StudentExamStoreSeed): string {
  return `${seed.scheduleId}:${seed.attemptId ?? 'preview'}:${seed.candidateId ?? 'anonymous'}`;
}

export function createStudentExamStore(seed: StudentExamStoreSeed): StudentExamStore {
  return createVanillaStore<StudentExamSessionState>()(
    subscribeWithSelector((set, get) => {
      const actions: StudentExamSessionActions = {
        setObjectiveAnswer(questionId, value, meta) {
          set((state) => ({
            attempt: {
              ...state.attempt,
              answers: {
                ...state.attempt.answers,
                [questionId]: resolveObjectiveAnswerUpdate(
                  state.attempt.answers[questionId],
                  value,
                  meta,
                ),
              },
            },
          }));
        },
        setWritingAnswer(taskId, value) {
          set((state) => ({
            attempt: {
              ...state.attempt,
              writingAnswers: {
                ...state.attempt.writingAnswers,
                [taskId]: value,
              },
            },
          }));
        },
        toggleFlag(questionId) {
          set((state) => ({
            attempt: {
              ...state.attempt,
              flags: {
                ...state.attempt.flags,
                [questionId]: !state.attempt.flags[questionId],
              },
            },
          }));
        },
        setNavigation(module, questionId) {
              set((state) => {
                if (
                  state.navigation.currentModule === module &&
                  state.navigation.currentQuestionId === questionId
                ) {
                  return state;
                }

                return { navigation: { currentModule: module, currentQuestionId: questionId } };
              });
            },
        setPhase(phase) {
              set((state) => (state.phase === phase ? state : { phase }));
            },
        setRuntimeSnapshot(runtime, displayTimeRemaining) {
              set((state) => {
                if (
                  state.runtime.snapshot === runtime &&
                  state.runtime.displayTimeRemaining === displayTimeRemaining
                ) {
                  return state;
                }

                return { runtime: { snapshot: runtime, displayTimeRemaining } };
              });
            },
        setPersistence(update) {
              set((state) => {
                const nextPersistence = {
                  syncState: update.syncState ?? state.persistence.syncState,
                  pendingMutationCount:
                    update.pendingMutationCount ?? state.persistence.pendingMutationCount,
                  acceptedThroughSeq:
                    update.acceptedThroughSeq ?? state.persistence.acceptedThroughSeq,
                };

                if (
                  state.persistence.syncState === nextPersistence.syncState &&
                  state.persistence.pendingMutationCount === nextPersistence.pendingMutationCount &&
                  state.persistence.acceptedThroughSeq === nextPersistence.acceptedThroughSeq
                ) {
                  return state;
                }

                return { persistence: nextPersistence };
              });
            },
        setBlocking(blocking) {
              set((state) => {
                if (
                  state.blocking.active === blocking.active &&
                  state.blocking.reason === blocking.reason &&
                  state.blocking.timeRemaining === blocking.timeRemaining
                ) {
                  return state;
                }

                return { blocking };
              });
            },
      };

      return {
        identity: {
          attemptId: seed.attemptId,
          scheduleId: seed.scheduleId,
          candidateId: seed.candidateId,
          scopeKey: getStudentExamScopeKey(seed),
        },
        phase: seed.phase,
        navigation: {
          currentModule: seed.currentModule,
          currentQuestionId: seed.currentQuestionId,
        },
        attempt: {
          answers: { ...seed.answers },
          writingAnswers: { ...seed.writingAnswers },
          flags: { ...seed.flags },
        },
        runtime: {
          snapshot: seed.runtimeSnapshot,
          displayTimeRemaining: seed.displayTimeRemaining,
        },
        persistence: {
          syncState: seed.syncState,
          pendingMutationCount: seed.pendingMutationCount,
          acceptedThroughSeq: seed.acceptedThroughSeq,
        },
        blocking: {
          active: seed.blocking?.active ?? false,
          reason: seed.blocking?.reason ?? null,
          timeRemaining: seed.blocking?.timeRemaining ?? 0,
        },
        actions,
      };
    }),
  );
}

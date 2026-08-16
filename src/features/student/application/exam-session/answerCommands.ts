import type { ModuleType } from '../../../../types';
import type {
  StudentAnswerMutationMeta,
  StudentAnswerValue,
  StudentAttemptMutation,
} from '../../../../types/studentAttempt';
import type { StudentMutationOutbox } from '../../contracts/exam-session/StudentMutationOutbox';
import type { StudentExamStore } from './studentExamStoreFactory';

export interface StudentAnswerCommandContext {
  readonly store: StudentExamStore;
  readonly outbox?: StudentMutationOutbox;
  readonly module: ModuleType;
  readonly now?: () => string;
  readonly createMutationId?: () => string;
}

export interface StudentAnswerCommands {
  setObjectiveAnswer(
    questionId: string,
    value: StudentAnswerValue,
    meta?: StudentAnswerMutationMeta,
  ): Promise<void>;
  setWritingAnswer(taskId: string, value: string): Promise<void>;
  toggleFlag(questionId: string): Promise<void>;
}

function createMutationId(context: StudentAnswerCommandContext): string {
  return context.createMutationId?.() ?? `mutation-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildMutationBase(context: StudentAnswerCommandContext): Pick<
  StudentAttemptMutation,
  'id' | 'attemptId' | 'scheduleId' | 'timestamp'
> | null {
  const attemptId = context.store.getState().identity.attemptId;
  if (!attemptId) {
    return null;
  }

  return {
    id: createMutationId(context),
    attemptId,
    scheduleId: context.store.getState().identity.scheduleId,
    timestamp: context.now?.() ?? new Date().toISOString(),
  };
}

async function enqueue(
  context: StudentAnswerCommandContext,
  mutation: StudentAttemptMutation | null,
): Promise<void> {
  if (!mutation || !context.outbox) {
    return;
  }
  await context.outbox.enqueue(mutation);
  context.store.getState().actions.setPersistence({
    pendingMutationCount: context.outbox.pendingCount(),
    syncState: 'saving',
  });
}

export function createStudentAnswerCommands(
  context: StudentAnswerCommandContext,
): StudentAnswerCommands {
  return {
    async setObjectiveAnswer(questionId, value, meta) {
      context.store.getState().actions.setObjectiveAnswer(questionId, value, meta);
      const resolvedValue = context.store.getState().attempt.answers[questionId] ?? null;
      const base = buildMutationBase(context);
      const mutation: StudentAttemptMutation | null = base
        ? {
            ...base,
            type: 'answer',
            payload: {
              questionId,
              value: resolvedValue,
              module: context.module,
            },
          }
        : null;
      if (mutation && meta?.interactionType) {
        mutation.payload.interactionType = meta.interactionType;
      }
      if (mutation && typeof meta?.slotIndex === 'number' && Number.isInteger(meta.slotIndex)) {
        mutation.payload.slotIndex = meta.slotIndex;
      }
      if (mutation && typeof meta?.slotId === 'string' && meta.slotId.trim()) {
        mutation.payload.slotId = meta.slotId;
      }
      if (mutation && typeof meta?.slotCount === 'number' && Number.isInteger(meta.slotCount)) {
        mutation.payload.slotCount = meta.slotCount;
      }
      if (mutation && typeof meta?.slotValue === 'string') {
        mutation.payload.slotValue = meta.slotValue;
      }
      await enqueue(context, mutation);
    },
    async setWritingAnswer(taskId, value) {
      context.store.getState().actions.setWritingAnswer(taskId, value);
      const base = buildMutationBase(context);
      await enqueue(
        context,
        base
          ? {
              ...base,
              type: 'writing_answer',
              payload: { taskId, value, module: context.module },
            }
          : null,
      );
    },
    async toggleFlag(questionId) {
      const current = context.store.getState().attempt.flags[questionId] ?? false;
      context.store.getState().actions.toggleFlag(questionId);
      const base = buildMutationBase(context);
      await enqueue(
        context,
        base
          ? {
              ...base,
              type: 'flag',
              payload: { questionId, value: !current, module: context.module },
            }
          : null,
      );
    },
  };
}

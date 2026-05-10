import type { QuestionAnswer } from '../../types';
import type { StudentAnswerMutationMeta } from '../../types/studentAttempt';

interface ResolveSharedStudentAnswerMetaArgs {
  value: QuestionAnswer;
  slotId: string | undefined;
  defaultEntryAnswerIndex: number | undefined;
  slotCount: number;
  incomingMeta?: StudentAnswerMutationMeta | undefined;
}

export function resolveSharedStudentAnswerMeta({
  value,
  slotId,
  defaultEntryAnswerIndex,
  slotCount,
  incomingMeta,
}: ResolveSharedStudentAnswerMetaArgs): StudentAnswerMutationMeta | undefined {
  if (incomingMeta?.slotIndex !== undefined || typeof defaultEntryAnswerIndex !== 'number') {
    return incomingMeta;
  }

  let slotValue = '';
  if (typeof value === 'string') {
    slotValue = value;
  } else if (Array.isArray(value)) {
    const candidate = value[defaultEntryAnswerIndex];
    slotValue = typeof candidate === 'string' ? candidate : '';
  } else if (value !== null && value !== undefined) {
    slotValue = String(value);
  }

  return {
    ...incomingMeta,
    slotIndex: defaultEntryAnswerIndex,
    slotId,
    slotCount,
    slotValue,
    interactionType: 'typing',
  };
}

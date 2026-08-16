import type { StudentAnswerMutationMeta, StudentAnswerValue } from '../../../../types/studentAttempt';

export function resolveObjectiveAnswerUpdate(
  currentValue: StudentAnswerValue | undefined,
  answer: StudentAnswerValue,
  meta?: StudentAnswerMutationMeta,
): StudentAnswerValue {
  if (meta?.arrayUpdateMode === 'replace' && Array.isArray(answer)) {
    return answer;
  }

  const slotIndex = meta?.slotIndex;
  const hasSlotIntent =
    typeof slotIndex === 'number' && Number.isInteger(slotIndex) && slotIndex >= 0;

  if (hasSlotIntent && typeof slotIndex === 'number') {
    const currentSlots = Array.isArray(currentValue) ? currentValue : [];
    const requestedSlotCount =
      typeof meta?.slotCount === 'number' && Number.isInteger(meta.slotCount) && meta.slotCount > 0
        ? meta.slotCount
        : currentSlots.length;
    const nextSlotCount = Math.max(requestedSlotCount, currentSlots.length, slotIndex + 1);
    const nextSlots = Array.from({ length: nextSlotCount }, (_, index) => currentSlots[index] ?? '');

    let nextSlotValue = typeof meta?.slotValue === 'string' ? meta.slotValue : '';
    if (nextSlotValue === '' && Array.isArray(answer)) {
      const candidate = answer[slotIndex];
      nextSlotValue = typeof candidate === 'string' ? candidate : '';
    } else if (nextSlotValue === '' && typeof answer === 'string') {
      nextSlotValue = answer;
    } else if (nextSlotValue === '' && (answer === null || answer === undefined)) {
      nextSlotValue = '';
    } else if (nextSlotValue === '') {
      nextSlotValue = String(answer);
    }

    nextSlots[slotIndex] = nextSlotValue;
    return nextSlots;
  }

  if (Array.isArray(answer) && Array.isArray(currentValue) && currentValue.length > answer.length) {
    return Array.from({ length: currentValue.length }, (_, index) =>
      index < answer.length ? answer[index] ?? '' : currentValue[index] ?? '',
    );
  }

  return answer;
}

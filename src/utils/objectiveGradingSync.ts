export const OBJECTIVE_GRADING_UPDATED_EVENT = 'objective-grading-updated';

const OBJECTIVE_GRADING_UPDATED_STORAGE_KEY = 'objective-grading-updated';

export interface ObjectiveGradingUpdatedEventDetail {
  examId: string;
  updatedAt: string;
}

function isObjectiveGradingUpdatedEventDetail(
  value: unknown,
): value is ObjectiveGradingUpdatedEventDetail {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ObjectiveGradingUpdatedEventDetail>;
  return typeof candidate.examId === 'string' && typeof candidate.updatedAt === 'string';
}

export function notifyObjectiveGradingUpdated(examId: string): void {
  if (typeof window === 'undefined' || !examId) {
    return;
  }

  const detail: ObjectiveGradingUpdatedEventDetail = {
    examId,
    updatedAt: new Date().toISOString(),
  };

  window.dispatchEvent(new CustomEvent<ObjectiveGradingUpdatedEventDetail>(
    OBJECTIVE_GRADING_UPDATED_EVENT,
    { detail },
  ));

  try {
    window.localStorage.setItem(OBJECTIVE_GRADING_UPDATED_STORAGE_KEY, JSON.stringify(detail));
  } catch {
    // Same-tab delivery already happened; storage is only the cross-tab fallback.
  }
}

export function subscribeObjectiveGradingUpdates(
  examId: string | undefined,
  onUpdate: () => void,
): () => void {
  if (typeof window === 'undefined' || !examId) {
    return () => undefined;
  }

  const handleCustomEvent = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail;
    if (isObjectiveGradingUpdatedEventDetail(detail) && detail.examId === examId) {
      onUpdate();
    }
  };

  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key !== OBJECTIVE_GRADING_UPDATED_STORAGE_KEY || !event.newValue) {
      return;
    }

    try {
      const detail: unknown = JSON.parse(event.newValue);
      if (isObjectiveGradingUpdatedEventDetail(detail) && detail.examId === examId) {
        onUpdate();
      }
    } catch {
      // Ignore unrelated or malformed cross-tab notifications.
    }
  };

  window.addEventListener(OBJECTIVE_GRADING_UPDATED_EVENT, handleCustomEvent);
  window.addEventListener('storage', handleStorageEvent);

  return () => {
    window.removeEventListener(OBJECTIVE_GRADING_UPDATED_EVENT, handleCustomEvent);
    window.removeEventListener('storage', handleStorageEvent);
  };
}

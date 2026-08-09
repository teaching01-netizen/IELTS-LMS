import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  OBJECTIVE_GRADING_UPDATED_EVENT,
  notifyObjectiveGradingUpdated,
  subscribeObjectiveGradingUpdates,
} from '../objectiveGradingSync';

afterEach(() => {
  window.localStorage.clear();
});

describe('objective grading update notifications', () => {
  test('notifies the current tab and persists a cross-tab notification', () => {
    const onUpdate = vi.fn();
    const unsubscribe = subscribeObjectiveGradingUpdates('exam-1', onUpdate);

    notifyObjectiveGradingUpdated('exam-1');

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem('objective-grading-updated')).toContain('exam-1');
    unsubscribe();
  });

  test('ignores other exams and malformed storage events', () => {
    const onUpdate = vi.fn();
    const unsubscribe = subscribeObjectiveGradingUpdates('exam-1', onUpdate);

    window.dispatchEvent(new CustomEvent(OBJECTIVE_GRADING_UPDATED_EVENT, {
      detail: { examId: 'exam-2', updatedAt: new Date().toISOString() },
    }));
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'objective-grading-updated',
      newValue: '{not-json',
    }));

    expect(onUpdate).not.toHaveBeenCalled();
    unsubscribe();
  });

  test('stops notifying after unsubscribe', () => {
    const onUpdate = vi.fn();
    const unsubscribe = subscribeObjectiveGradingUpdates('exam-1', onUpdate);

    unsubscribe();
    notifyObjectiveGradingUpdated('exam-1');

    expect(onUpdate).not.toHaveBeenCalled();
  });
});

import { describe, expect, it } from 'vitest';
import type { ReviewDraft } from '../../../../types/grading';
import {
  createReviewDraftState,
  isReviewDraftDirty,
  reviewDraftReducer,
  type ReviewDraftAction,
  type ReviewDraftState,
} from '../reviewDraftState';

function draft(overrides: Partial<ReviewDraft> = {}): ReviewDraft {
  return {
    id: 'draft-a',
    submissionId: 'sub-a',
    studentId: 'stu-a',
    teacherId: 't-1',
    releaseStatus: 'draft',
    sectionDrafts: {},
    annotations: [],
    drawings: [],
    checklist: {} as ReviewDraft['checklist'],
    hasUnsavedChanges: false,
    revision: 1,
    createdAt: '2026-10-11T00:00:00.000Z',
    updatedAt: '2026-10-11T00:00:00.000Z',
    ...overrides,
  };
}

function run(state: ReviewDraftState, ...actions: ReviewDraftAction[]) {
  return actions.reduce(reviewDraftReducer, state);
}

const feedback = (value: string): ReviewDraftAction => ({
  type: 'edited',
  submissionId: 'sub-a',
  update: (current) => ({ ...current, overallFeedback: value }),
});

describe('reviewDraftReducer', () => {
  it('adopts the first read and never lets a later read replace dirty work', () => {
    const state = run(
      createReviewDraftState('sub-a'),
      { type: 'loaded', submissionId: 'sub-a', draft: draft({ overallFeedback: 'server' }) },
      feedback('local'),
      { type: 'loaded', submissionId: 'sub-a', draft: draft({ overallFeedback: 'other grader', revision: 2 }) },
    );
    expect(state.local?.overallFeedback).toBe('local');
    // The base is not moved silently: the next save meets the conflict check.
    expect(state.local?.revision).toBe(1);
    expect(isReviewDraftDirty(state)).toBe(true);
  });

  it('acknowledging save N keeps edit N+1 dirty on the acknowledged revision', () => {
    const state = run(
      createReviewDraftState('sub-a'),
      { type: 'loaded', submissionId: 'sub-a', draft: draft() },
      feedback('four'),
      { type: 'saveStarted', submissionId: 'sub-a', operationId: 1 },
      feedback('five'),
      { type: 'saveAcknowledged', submissionId: 'sub-a', operationId: 1, draft: draft({ overallFeedback: 'four', revision: 2 }) },
    );
    expect(state.local).toMatchObject({ overallFeedback: 'five', revision: 2, hasUnsavedChanges: true });
    expect(state.acknowledged?.overallFeedback).toBe('four');
    expect(state.pendingSave).toBeNull();
    expect(isReviewDraftDirty(state)).toBe(true);
  });

  it('adopts server-normalized content when the save still represents the current edit', () => {
    const state = run(
      createReviewDraftState('sub-a'),
      { type: 'loaded', submissionId: 'sub-a', draft: draft() },
      feedback('  four  '),
      { type: 'saveStarted', submissionId: 'sub-a', operationId: 1 },
      { type: 'saveAcknowledged', submissionId: 'sub-a', operationId: 1, draft: draft({ overallFeedback: 'four', revision: 2 }) },
    );
    expect(state.local).toMatchObject({ overallFeedback: 'four', revision: 2, hasUnsavedChanges: false });
    expect(isReviewDraftDirty(state)).toBe(false);
  });

  it('keeps edits after a failed save', () => {
    const state = run(
      createReviewDraftState('sub-a'),
      { type: 'loaded', submissionId: 'sub-a', draft: draft() },
      feedback('keep'),
      { type: 'saveStarted', submissionId: 'sub-a', operationId: 1 },
      { type: 'saveFailed', submissionId: 'sub-a', operationId: 1 },
    );
    expect(state.local?.overallFeedback).toBe('keep');
    expect(state.pendingSave).toBeNull();
    expect(isReviewDraftDirty(state)).toBe(true);
  });

  it('ignores answers addressed to another submission', () => {
    const started = run(
      createReviewDraftState('sub-a'),
      { type: 'loaded', submissionId: 'sub-a', draft: draft() },
      feedback('for a'),
      { type: 'saveStarted', submissionId: 'sub-a', operationId: 1 },
    );
    const switched = run(
      started,
      { type: 'reset', submissionId: 'sub-b' },
      { type: 'loaded', submissionId: 'sub-b', draft: draft({ id: 'draft-b', submissionId: 'sub-b', overallFeedback: 'b' }) },
      { type: 'saveAcknowledged', submissionId: 'sub-a', operationId: 1, draft: draft({ overallFeedback: 'for a' }) },
      { type: 'transitioned', submissionId: 'sub-a', draft: draft({ releaseStatus: 'released' }) },
    );
    expect(switched.local).toMatchObject({ submissionId: 'sub-b', overallFeedback: 'b', releaseStatus: 'draft' });
    expect(switched.pendingSave).toBeNull();
  });

  it('applies a workflow transition without discarding dirty content', () => {
    const state = run(
      createReviewDraftState('sub-a'),
      { type: 'loaded', submissionId: 'sub-a', draft: draft() },
      feedback('unsaved'),
      { type: 'transitioned', submissionId: 'sub-a', draft: draft({ releaseStatus: 'grading_complete', revision: 3 }) },
    );
    expect(state.local).toMatchObject({ overallFeedback: 'unsaved', releaseStatus: 'grading_complete', revision: 3 });
    expect(isReviewDraftDirty(state)).toBe(true);
  });

  it('ignores a stale acknowledgement for an operation that is no longer pending', () => {
    const state = run(
      createReviewDraftState('sub-a'),
      { type: 'loaded', submissionId: 'sub-a', draft: draft() },
      feedback('x'),
      { type: 'saveAcknowledged', submissionId: 'sub-a', operationId: 7, draft: draft({ overallFeedback: 'stale' }) },
    );
    expect(state.local?.overallFeedback).toBe('x');
  });
});

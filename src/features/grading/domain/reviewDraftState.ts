import type { ReviewDraft } from '../../../types/grading';

/**
 * Entity-scoped review draft with acknowledgement tracking.
 *
 * `local` is what the grader sees and edits; `acknowledged` is the last draft
 * the server confirmed. Every local edit advances `editSequence`; a save
 * captures the sequence it carries, so its acknowledgement can tell whether
 * newer edits exist. Every action names its submission: anything addressed to
 * a submission other than the current one is ignored, so a late answer for A
 * can never populate B.
 */
export interface ReviewDraftState {
  submissionId: string;
  acknowledged: ReviewDraft | null;
  local: ReviewDraft | null;
  editSequence: number;
  /** Edit sequence that `acknowledged` represents. */
  acknowledgedSequence: number;
  pendingSave: { operationId: number; sequence: number } | null;
}

export type ReviewDraftAction =
  | { type: 'reset'; submissionId: string }
  /** A server read (initial load or refresh) that is not our own write. */
  | { type: 'loaded'; submissionId: string; draft: ReviewDraft }
  | { type: 'edited'; submissionId: string; update: (draft: ReviewDraft) => ReviewDraft }
  | { type: 'saveStarted'; submissionId: string; operationId: number }
  | { type: 'saveAcknowledged'; submissionId: string; operationId: number; draft: ReviewDraft }
  | { type: 'saveFailed'; submissionId: string; operationId: number }
  /** Result of our own workflow command (complete, ready, schedule, reopen). */
  | { type: 'transitioned'; submissionId: string; draft: ReviewDraft };

/** Fields the server owns: adopting them never discards a grader's content edit. */
const SERVER_OWNED_FIELDS = [
  'id',
  'revision',
  'releaseStatus',
  'createdAt',
  'updatedAt',
  'lastAutoSaveAt',
] as const satisfies ReadonlyArray<keyof ReviewDraft>;

export function createReviewDraftState(submissionId: string): ReviewDraftState {
  return {
    submissionId,
    acknowledged: null,
    local: null,
    editSequence: 0,
    acknowledgedSequence: 0,
    pendingSave: null,
  };
}

export function isReviewDraftDirty(state: ReviewDraftState): boolean {
  return state.local !== null && state.editSequence !== state.acknowledgedSequence;
}

function withDirtyFlag(draft: ReviewDraft, dirty: boolean): ReviewDraft {
  return draft.hasUnsavedChanges === dirty ? draft : { ...draft, hasUnsavedChanges: dirty };
}

function adoptServerOwnedFields(local: ReviewDraft, server: ReviewDraft): ReviewDraft {
  const next: ReviewDraft = { ...local };
  for (const field of SERVER_OWNED_FIELDS) {
    (next as unknown as Record<string, unknown>)[field] = server[field];
  }
  return next;
}

export function reviewDraftReducer(state: ReviewDraftState, action: ReviewDraftAction): ReviewDraftState {
  if (action.type === 'reset') {
    return action.submissionId === state.submissionId && state.local === null
      ? state
      : createReviewDraftState(action.submissionId);
  }
  if (action.submissionId !== state.submissionId) return state;

  switch (action.type) {
    case 'loaded': {
      // Dirty work is never replaced by a read, and its base revision is not
      // moved either: a save then meets the server's conflict check instead
      // of silently overwriting another grader.
      if (isReviewDraftDirty(state)) return { ...state, acknowledged: action.draft };
      return {
        ...state,
        acknowledged: action.draft,
        local: withDirtyFlag(action.draft, false),
        acknowledgedSequence: state.editSequence,
      };
    }
    case 'edited': {
      if (!state.local) return state;
      const editSequence = state.editSequence + 1;
      return { ...state, editSequence, local: withDirtyFlag(action.update(state.local), true) };
    }
    case 'saveStarted':
      return { ...state, pendingSave: { operationId: action.operationId, sequence: state.editSequence } };
    case 'saveAcknowledged': {
      if (state.pendingSave?.operationId !== action.operationId) return state;
      const savedSequence = state.pendingSave.sequence;
      const current = state.editSequence === savedSequence;
      const base = { ...state, pendingSave: null, acknowledged: action.draft, acknowledgedSequence: savedSequence };
      if (current || !state.local) return { ...base, local: withDirtyFlag(action.draft, false) };
      // Newer edits stay visible and dirty, now based on the acknowledged revision.
      return { ...base, local: withDirtyFlag(adoptServerOwnedFields(state.local, action.draft), true) };
    }
    case 'saveFailed':
      return state.pendingSave?.operationId === action.operationId ? { ...state, pendingSave: null } : state;
    case 'transitioned': {
      if (!isReviewDraftDirty(state) || !state.local) {
        return {
          ...state,
          acknowledged: action.draft,
          local: withDirtyFlag(action.draft, false),
          acknowledgedSequence: state.editSequence,
        };
      }
      return {
        ...state,
        acknowledged: action.draft,
        local: withDirtyFlag(adoptServerOwnedFields(state.local, action.draft), true),
      };
    }
  }
}

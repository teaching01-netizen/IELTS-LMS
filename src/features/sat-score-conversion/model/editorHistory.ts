import { sameDraft, type DraftContent } from "./draft";

/**
 * Local edit history: whole-document snapshots (two subjects of at most a few
 * hundred cells, so a snapshot is cheap and the logic cannot drift from the
 * model). `saved` is the last content the server confirmed for this draft;
 * `draft` is what is on screen.
 */
export const HISTORY_LIMIT = 100;

export interface EditorState {
  draft: DraftContent;
  saved: DraftContent;
  past: DraftContent[];
  future: DraftContent[];
}

export type EditorAction =
  | { type: "edit"; next: DraftContent }
  | { type: "undo" }
  | { type: "redo" }
  /** Replace everything (draft opened, reloaded, or changes discarded): history restarts. */
  | { type: "reset"; content: DraftContent }
  /** The server accepted `content`: it becomes the baseline; undo history is kept. */
  | { type: "saved"; content: DraftContent };

export function initialEditorState(content: DraftContent): EditorState {
  return { draft: content, saved: content, past: [], future: [] };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "edit":
      if (sameDraft(state.draft, action.next)) return state;
      return { ...state, draft: action.next, past: [...state.past, state.draft].slice(-HISTORY_LIMIT), future: [] };
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return { ...state, draft: previous, past: state.past.slice(0, -1), future: [state.draft, ...state.future] };
    }
    case "redo": {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { ...state, draft: next, past: [...state.past, state.draft].slice(-HISTORY_LIMIT), future: rest };
    }
    case "reset":
      return initialEditorState(action.content);
    case "saved":
      return { ...state, saved: action.content };
  }
}

export function isDirty(state: EditorState): boolean {
  return !sameDraft(state.draft, state.saved);
}

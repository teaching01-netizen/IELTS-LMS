import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { QuestionRevision } from "../contracts/assessment";
import { normalizeQuestionRevision } from "./authoringWorkspaceModel";

/**
 * The server's version of the open question, as the draft module understands it.
 *
 * One projection, read by BOTH rules below: the seed the editors and the
 * three-way compare are authored against, and the document a refetch may
 * install. They used to be two separate reads of the query (a memo in the
 * render body and a condition inside an effect), which is how the seed and the
 * adoption rule drifted apart in the first place.
 */
export interface AuthoringServerDocument {
  /** The server's revision, normalized, or null when the query has none yet. */
  revision: QuestionRevision | null;
  /** The question that revision belongs to. Never assumed from the selection. */
  examQuestionId: string | null;
}

export function serverQuestionDocument(
  data: { question?: QuestionRevision | null; examQuestionId?: string | null } | undefined
): AuthoringServerDocument {
  return {
    revision: data?.question ? normalizeQuestionRevision(data.question) : null,
    examQuestionId: data?.examQuestionId ?? null,
  };
}

/** What the adoption rule is asked about: the server document and its owner. */
export interface AuthoringServerAdoption {
  server: AuthoringServerDocument;
  /** The question the author is on. A revision for another one is never installed. */
  selectedExamQuestionId: string | null;
  /** The device-draft key of the open question. */
  draftKey: string | null;
}

/**
 * Why the adoption rule did or did not install the server document.
 *
 * WHY THIS EXISTS
 * ---------------
 * The rule used to answer with a bare boolean, so a `200` that was never
 * installed was indistinguishable from one the rule had not seen yet — and the
 * workspace fell through to the loading skeleton, which then meant two things:
 * "the question is on its way" and "the question arrived and was dropped". The
 * second state is not loading, and a caller can only refuse to render it as one
 * if the rule names WHY it did not install.
 */
export type ServerAdoptionState =
  | "adopted"
  /** The query has no revision yet (genuinely still loading, or empty). */
  | "no-document"
  /** The revision belongs to another question: stale data, never installed. */
  | "stale-selection"
  /** A recovered device draft the author has not answered for is being held. */
  | "recovered-local-copy"
  /** The open draft holds unsaved local work a refetch must not replace. */
  | "protected-local-copy";

/**
 * The open question's draft: the document every editor, validator, diff and
 * save path reads, plus the two rules that govern it.
 *
 * WHY THIS EXISTS
 * ---------------
 * The draft used to be a bare `useState` in the workspace with `setDraft`
 * passed to five different owners, so "what may change the document, and in
 * what shape?" was answerable only by reading every call site: some installed a
 * raw revision, one normalized first, one cleared it on a question move, and a
 * ref mirror carried the revision number for the conflict resolver to read
 * outside React.
 *
 * One owner now, with one mutation surface:
 *
 *   - `adoptServerDocument` is the only way an HTTP revision becomes the open
 *     draft, and it normalizes at the boundary, so a caller cannot install a
 *     revision in a shape the editors were not built for;
 *   - `clearDocument` is the only way the draft goes away;
 *   - `adoptServerDocumentIfPermitted` is the only answer to "may the server
 *     document replace the local work?", and it reads every condition that
 *     decides it here — the question the revision belongs to, a device draft
 *     the author has not resolved, and whether unsaved work is protected;
 *   - the refs those rules read (`draftProtectedRef`,
 *     `recoveredQuestionDraftKeyRef`) and the mirrors they keep
 *     (`draftRevisionRef`, `draftRef`) are created here, so no other owner has
 *     to know they exist to answer a question about the draft.
 *
 * WHO WRITES THE GUARD REFS
 * -------------------------
 * `draftProtectedRef` is written by the draft-lifecycle projection, because
 * "the local copy is protected" is derived from the save status — and the save
 * status belongs to the persistence owner, which is created after the draft
 * must exist. `recoveredQuestionDraftKeyRef` is written by the recovered-draft
 * path (persistence's `onRecover`, and the save router once the recovered
 * revision is acknowledged). Both are injected, so the refs have one declared
 * home and their writers name the draft fact they are setting.
 *
 * WHY THE ADOPTION TRIGGER STAYS AT THE COMPOSITION ROOT
 * ------------------------------------------------------
 * The RULE is here; the one call site is where the query result lands. Two
 * declaration-order facts force that, and both are load-bearing:
 *
 *   1. the trigger reads the question query, and the query is created after the
 *      selection hook — which needs `clearDocument` for its synchronous draft
 *      reset on a module move (an effect here would land that reset a render
 *      late, which is exactly what the reset exists to avoid);
 *   2. the trigger must run AFTER the effect that projects the draft lifecycle
 *      into `draftProtectedRef`, or a refetch landing in the same commit as the
 *      first keystroke would read the previous commit's "nothing protected" and
 *      discard the work it was supposed to keep.
 * So the draft document is created first, and one guarded call states the
 * trigger where both of those are true.
 */
export interface AuthoringDraft {
  /** The open question's draft, or null when no question is open. */
  draft: QuestionRevision | null;
  /** Install a draft the caller has already shaped (an author's edit). */
  setDraft: Dispatch<SetStateAction<QuestionRevision | null>>;
  /** Install an HTTP revision, normalized at this boundary. */
  adoptServerDocument: (revision: QuestionRevision) => void;
  /** Drop the open draft: a question move, or a wholesale replacement. */
  clearDocument: () => void;
  /**
   * Install the server document if, and only if, nothing forbids it: the
   * revision belongs to the question the author is on, it is not the recovered
   * device draft they were offered, and no unsaved local work is protected.
   * Returns WHICH outcome held, so a caller can distinguish "still loading"
   * from "a 200 that was dropped" and never render the latter as a skeleton.
   */
  adoptServerDocumentIfPermitted: (input: AuthoringServerAdoption) => ServerAdoptionState;
  /**
   * Record that the open question's recovered device draft has been resolved —
   * held for the author by the recovery owner — so the adoption rule stops
   * treating the server document as a threat to it. The held copy itself is
   * untouched: adopting the server revision as the editor's base document does
   * not destroy work a separate owner is presenting.
   */
  acknowledgeRecoveredDraftKey: (draftKey: string) => void;
  /**
   * The open draft's revision number, for reads that happen outside React (the
   * conflict resolver captures it when the sheet opens). Read at resolution
   * time, never as a dependency.
   */
  draftRevisionRef: MutableRefObject<number | null>;
  /** The open draft itself, for callers that must read it without re-subscribing. */
  draftRef: MutableRefObject<QuestionRevision | null>;
  /**
   * True while the open question holds unsaved local work, so a refetch may not
   * adopt the server document over it. Written by the draft-lifecycle
   * projection; read by the adoption rule above.
   */
  draftProtectedRef: MutableRefObject<boolean>;
  /**
   * The device-draft key the open question's unsaved work was recovered for, so
   * a recovered copy is never silently replaced by the server document.
   */
  recoveredQuestionDraftKeyRef: MutableRefObject<string | null>;
}

export function useAuthoringDraft(): AuthoringDraft {
  const [draft, setDraft] = useState<QuestionRevision | null>(null);
  const draftRevisionRef = useRef<number | null>(null);
  const draftRef = useRef<QuestionRevision | null>(null);
  const draftProtectedRef = useRef(false);
  const recoveredQuestionDraftKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // Both mirrors, one write per commit: the revision number (read outside
    // React at resolution time) and the document (read by the room projection).
    draftRevisionRef.current = draft?.revision ?? null;
    draftRef.current = draft;
  }, [draft]);

  const adoptServerDocument = useCallback((revision: QuestionRevision) => {
    setDraft(normalizeQuestionRevision(revision));
  }, []);

  const clearDocument = useCallback(() => {
    setDraft(null);
  }, []);

  const adoptServerDocumentIfPermitted = useCallback(
    ({ server, selectedExamQuestionId, draftKey }: AuthoringServerAdoption): ServerAdoptionState => {
      if (!server.revision) return "no-document";
      // Stale data: the query key is the selection, but the payload names its
      // own question, and that name is the authority.
      if (server.examQuestionId !== selectedExamQuestionId) return "stale-selection";
      // A recovered device draft is the local work the author was offered. The
      // server must not replace it before they answer.
      if (recoveredQuestionDraftKeyRef.current === draftKey) return "recovered-local-copy";
      // Unsaved local work is protected only while there IS a local document:
      // protection guards the workspace draft, so an empty document has nothing
      // for it to protect, and a guard that fires anyway would leave a 200 the
      // workspace can neither render nor explain.
      if (draftRef.current !== null && draftProtectedRef.current) return "protected-local-copy";
      adoptServerDocument(server.revision);
      return "adopted";
    },
    [adoptServerDocument, draftRef]
  );

  const acknowledgeRecoveredDraftKey = useCallback((draftKey: string) => {
    if (recoveredQuestionDraftKeyRef.current === draftKey) {
      recoveredQuestionDraftKeyRef.current = null;
    }
  }, []);

  return {
    draft,
    setDraft,
    adoptServerDocument,
    clearDocument,
    adoptServerDocumentIfPermitted,
    acknowledgeRecoveredDraftKey,
    draftRevisionRef,
    draftRef,
    draftProtectedRef,
    recoveredQuestionDraftKeyRef,
  };
}

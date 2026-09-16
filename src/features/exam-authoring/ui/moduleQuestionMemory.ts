import { useCallback, useEffect, useRef } from "react";
import type { AssessmentModuleShell } from "../contracts/assessment";

/**
 * Which question the author was last on, per module.
 *
 * This is navigation state, not view state: the module and the question are
 * chosen together, and the editor renders the open draft while taking its header
 * from the selected module. When those two drift apart the author sees one
 * module's header over another module's question — which is how the Math
 * question came to be open inside a Reading & Writing module.
 *
 * A memory of the last question per module is what makes "go back to where I
 * was" possible, and it is the value a module switch should land on instead of
 * whatever the previous module left selected.
 *
 * The OPEN draft drifting from the selected question is the other half of that
 * picture, and it is fixed where it was written: a save may only install its
 * revision while its own question is still open (see `useAuthoringSaveRouting`).
 * It is deliberately NOT corrected here by comparing identities: the shell row
 * and the open revision are two shapes of the same question that a component is
 * not entitled to assume agree, and a false positive would blank a draft the
 * author is working on.
 */
export type ModuleQuestionMemory = Map<string, string>;

/** The question to open when entering `module`, or null when it has none. */
export function resolveModuleEntry(
  memory: ModuleQuestionMemory,
  module: Pick<AssessmentModuleShell, "id" | "questions">,
): string | null {
  const remembered = memory.get(module.id);
  // A remembered question that is gone (deleted, moved to another module)
  // resolves to the module's first question rather than to nothing: the author
  // asked to open this module, and an empty editor is not an answer to that.
  if (remembered && module.questions.some((item) => item.examQuestionId === remembered)) {
    return remembered;
  }
  return module.questions[0]?.examQuestionId ?? null;
}

/** True when `examQuestionId` is one of the module's own questions. */
export function questionBelongsToModule(
  module: Pick<AssessmentModuleShell, "questions">,
  examQuestionId: string | null,
): boolean {
  return (
    examQuestionId !== null &&
    module.questions.some((item) => item.examQuestionId === examQuestionId)
  );
}

export interface ModuleQuestionSelectionInput {
  /** The module the author is in; null until the shell resolves. */
  module: AssessmentModuleShell | null;
  selectedExamQuestionId: string | null;
  /** Adopt a question of the selected module (and drop whatever was open). */
  onAdoptQuestion: (examQuestionId: string | null) => void;
}

export interface ModuleQuestionSelection {
  /** Where entering `module` should land: last question stayed on, else first. */
  entryQuestionFor: (module: Pick<AssessmentModuleShell, "id" | "questions"> | null) => string | null;
}

/**
 * Keeps the selected question inside the selected module.
 *
 * One rule the author can see: the question on screen belongs to the module in
 * the header. It does not invent a selection — a module switch still chooses
 * deliberately (through `entryQuestionFor`), and a deliberate null selection (a
 * module with no questions, a question just deleted) is left alone rather than
 * quietly replaced.
 */
export function useModuleQuestionSelection(
  input: ModuleQuestionSelectionInput,
): ModuleQuestionSelection {
  const memoryRef = useRef<ModuleQuestionMemory>(new Map());
  const { module, selectedExamQuestionId, onAdoptQuestion } = input;

  // Remember where the author is, per module: the question a module is left on
  // is the one it is returned to.
  useEffect(() => {
    if (!module || !selectedExamQuestionId) return;
    if (!questionBelongsToModule(module, selectedExamQuestionId)) return;
    memoryRef.current.set(module.id, selectedExamQuestionId);
  }, [module, selectedExamQuestionId]);

  useEffect(() => {
    if (!module || !selectedExamQuestionId) return;
    if (questionBelongsToModule(module, selectedExamQuestionId)) return;
    // Adopting clears the open draft too: that draft belongs to the question
    // being left behind.
    onAdoptQuestion(resolveModuleEntry(memoryRef.current, module));
  }, [module, onAdoptQuestion, selectedExamQuestionId]);

  const entryQuestionFor = useCallback(
    (target: Pick<AssessmentModuleShell, "id" | "questions"> | null): string | null =>
      target ? resolveModuleEntry(memoryRef.current, target) : null,
    [],
  );

  return { entryQuestionFor };
}

import { useEffect, type RefObject } from "react";
import type { AssessmentModuleShell, QuestionRevision } from "../contracts/assessment";

/**
 * The workspace's keyboard command surface.
 *
 * WHY THIS EXISTS
 * ---------------
 * These rules used to be a 90-line `useEffect` in the middle of the workspace
 * component, which made two things hard to see: which commands exist at all, and
 * which of them are gated on the author not already typing. Both are stated
 * here, once, as an ordered table of rules.
 *
 * The hook OWNS the rules and the guards; it owns no state and renders nothing.
 * Every command is a callback the workspace passes in, so the workspace stays
 * the composition owner and this module stays testable without a DOM tree.
 *
 * Guard vocabulary (in the order the rules apply):
 *   - `command`     — Cmd/Ctrl is held.
 *   - `editing`     — the event came from a field the author is typing in.
 *   - `interactive` — the event came from something clickable (a control).
 *   - `inOverlay`   — an overlay is open, or the event came from inside one.
 */
export type WorkspaceMode = "build" | "overview" | "issues";

export interface AuthoringKeyboardInput {
  /** The open question, when there is one. */
  draft: QuestionRevision | null;
  selectedExamQuestionId: string | null;
  selectedModule: AssessmentModuleShell | null;
  /** The selected question's position inside the module, or -1. */
  selectedModuleIndex: number;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onModeChange: (mode: WorkspaceMode) => void;
  onChange: (revision: QuestionRevision) => void;
  onSaveNow: () => void;
  onSaveAndNext: () => void;
  onDuplicate: () => void;
  onSelectQuestion: (examQuestionId: string) => void;
  onOpenInspector: () => void;
  onTogglePreview: () => void;
  onOpenJumpPalette: () => void;
  onOpenShortcutHelp: () => void;
}

/** The element the event came from, when it came from one. */
function targetElement(event: KeyboardEvent): Element | null {
  return event.target instanceof Element ? event.target : null;
}

/** True when the event originated in a field the author is typing into. */
function isEditingTarget(event: KeyboardEvent): boolean {
  return Boolean(
    targetElement(event)?.closest('input, textarea, select, [contenteditable="true"]')
  );
}

/** True when the event originated on something clickable. */
function isInteractiveTarget(event: KeyboardEvent): boolean {
  return Boolean(
    targetElement(event)?.closest(
      'button, a[href], summary, [role="button"], [role="menu"], [role^="menuitem"], [role="dialog"], [data-radix-popper-content-wrapper]'
    )
  );
}

/** True when an overlay is open or the event came from inside one. */
function isInsideOverlay(event: KeyboardEvent): boolean {
  return Boolean(
    targetElement(event)?.closest(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]'
    )
  );
}

export function useAuthoringKeyboard(input: AuthoringKeyboardInput): void {
  const {
    draft,
    selectedExamQuestionId,
    selectedModule,
    selectedModuleIndex,
    searchInputRef,
    onModeChange,
    onChange,
    onSaveNow,
    onSaveAndNext,
    onDuplicate,
    onSelectQuestion,
    onOpenInspector,
    onTogglePreview,
    onOpenJumpPalette,
    onOpenShortcutHelp,
  } = input;

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      const editing = isEditingTarget(event);
      const interactive = isInteractiveTarget(event);
      const inOverlay = isInsideOverlay(event);
      // An overlay owns its own keys, and a completed but unhandled event is
      // already someone else's.
      if (event.defaultPrevented || event.isComposing || inOverlay) return;

      if (command && event.key.toLowerCase() === "s") {
        // Shift+Save opens the inspector; plain Save saves. Both are claimed
        // only outside a field, because a field's own Cmd+S must not be stolen
        // by a workspace command.
        if (event.shiftKey) {
          if (!editing) {
            event.preventDefault();
            onOpenInspector();
          }
          return;
        }
        event.preventDefault();
        onSaveNow();
        return;
      }
      if (!editing && command && event.key === "/") {
        event.preventDefault();
        onOpenShortcutHelp();
        return;
      }
      if (interactive || editing) {
        // Escape out of a field lands the author back on their row in the
        // queue, which is where the next arrow-key move continues from.
        if (editing && event.key === "Escape") {
          (document.activeElement as HTMLElement | null)?.blur();
          document
            .querySelector<HTMLElement>(
              `[data-question-list-row="${selectedExamQuestionId}"] button`
            )
            ?.focus();
        }
        return;
      }
      if (command && event.key.toLowerCase() === "f") {
        event.preventDefault();
        onModeChange("build");
        window.requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      if (command && event.key.toLowerCase() === "k") {
        event.preventDefault();
        // Jump-to-question needs a module to jump inside; without one, the
        // search field is the only sensible destination.
        if (selectedModule) {
          onModeChange("build");
          onOpenJumpPalette();
          return;
        }
        onModeChange("build");
        window.requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }
      if (!command && event.key === "?") {
        event.preventDefault();
        onOpenShortcutHelp();
        return;
      }
      if (command && event.key === "Enter") {
        event.preventDefault();
        onSaveAndNext();
        return;
      }
      if (command && /^[1-4]$/.test(event.key) && draft?.answer.kind === "single_choice") {
        event.preventDefault();
        const optionId = draft.answer.options[Number(event.key) - 1]?.id;
        if (optionId) {
          onChange({ ...draft, answer: { ...draft.answer, correctOptionId: optionId } });
        }
        return;
      }
      if (command && event.key.toLowerCase() === "d" && !interactive && !editing) {
        event.preventDefault();
        onDuplicate();
        return;
      }
      if (
        !interactive &&
        !inOverlay &&
        !editing &&
        !command &&
        (event.key === "ArrowDown" || event.key === "ArrowUp") &&
        selectedModule
      ) {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const next = selectedModule.questions[selectedModuleIndex + direction];
        if (next) {
          event.preventDefault();
          onSelectQuestion(next.examQuestionId);
        }
        return;
      }
      if (
        !interactive &&
        !inOverlay &&
        !editing &&
        (event.key === "j" || event.key === "k") &&
        selectedModule
      ) {
        const direction = event.key === "j" ? 1 : -1;
        const next = selectedModule.questions[selectedModuleIndex + direction];
        if (next) {
          event.preventDefault();
          onSelectQuestion(next.examQuestionId);
        }
        return;
      }
      if (!interactive && !inOverlay && !editing && event.code === "Space" && draft) {
        event.preventDefault();
        onTogglePreview();
        return;
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [
    draft,
    onChange,
    onDuplicate,
    onModeChange,
    onOpenInspector,
    onOpenJumpPalette,
    onOpenShortcutHelp,
    onSaveAndNext,
    onSaveNow,
    onSelectQuestion,
    onTogglePreview,
    searchInputRef,
    selectedExamQuestionId,
    selectedModule,
    selectedModuleIndex,
  ]);
}

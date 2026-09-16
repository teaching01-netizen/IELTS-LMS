import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useSatMediaQuery } from "../useSatMediaQuery";
import type { SatReadingPreferences } from "../../domain/satReadingPreferences";
import { SAT_COPY } from "../../domain/satCopy";
import { satHighlightInk } from "../annotations/satAnnotationPalette";
import type { SatTextAnnotation } from "../../domain/satResponses";
import { satReadingStyle } from "../reading/satReadingStyle";
import { SatPopoverShell, SAT_COMPACT_POPOVER_QUERY } from "../primitives/SatPopoverShell";
import type { RefObject } from "react";

export interface SatNotesPanelProps {
  open: boolean;
  note: string;
  disabled: boolean;
  readingPreferences: SatReadingPreferences;
  returnFocusId: string;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  questionNumber?: number;
  /**
   * Notes attached to selected passage text, in the order they appear in the
   * passage. This panel is the student's answer to "what have I marked up?".
   */
  annotations?: readonly SatTextAnnotation[] | undefined;
  /** Open the note card for one anchored note (also emphasizes its source). */
  onOpenAnnotation?: ((annotationId: string) => void) | undefined;
  /** Empty-state content, supplied by the caller so this panel stays generic. */
  emptyState?: ReactNode | undefined;
  onSave: (note: string) => void;
  onClose: () => void;
}

/**
 * Notes home for the current question (Highlights & Notes).
 *
 * Two note concepts live here on purpose, because students experience them as
 * one thing called "my notes":
 * - notes anchored to selected passage text (listed first, each with the ink
 *   dot of the mark it hangs off and the quoted source), and
 * - the freeform QUESTION note, which has always persisted per question.
 *
 * Title and labels come from the copy table; the focus contract (focus-in on
 * every open, focus-back on every close) comes from SatPopoverShell. The
 * textarea keeps a single label source (wrapping label; no redundant
 * aria-label) with the character count exposed via describedby.
 */
export function SatNotesPanel(props: SatNotesPanelProps) {
  const [draft, setDraft] = useState(props.note);
  const compact = useSatMediaQuery(SAT_COMPACT_POPOVER_QUERY);
  const readingStyle = satReadingStyle(props.readingPreferences);
  const panelStyle: CSSProperties & {
    "--sat-reading-scale": string;
    "--sat-reading-line-height": string;
  } = {
    "--sat-reading-scale": readingStyle["--sat-reading-scale"],
    "--sat-reading-line-height": readingStyle["--sat-reading-line-height"],
  };
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  const noteRef = useRef(props.note);
  const disabledRef = useRef(props.disabled);
  const onSaveRef = useRef(props.onSave);
  const onCloseRef = useRef(props.onClose);
  const fallbackTriggerRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = props.triggerRef ?? fallbackTriggerRef;

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    noteRef.current = props.note;
    disabledRef.current = props.disabled;
    onSaveRef.current = props.onSave;
    onCloseRef.current = props.onClose;
    if (props.open) setDraft(props.note);
  }, [props.disabled, props.note, props.onClose, props.onSave, props.open]);

  const commitAndClose = useCallback(() => {
    const next = draftRef.current.trim();
    if (!disabledRef.current && next !== noteRef.current) onSaveRef.current(next);
    onCloseRef.current();
  }, []);

  // Legacy return-focus by id (shell passes returnFocusId for the pre-shell
  // path); the shell trigger ref is preferred when provided.
  const legacyReturnFocusId = props.returnFocusId;
  const handleClose = useCallback(() => {
    commitAndClose();
    if (triggerRef.current) {
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    } else {
      window.requestAnimationFrame(() => document.getElementById(legacyReturnFocusId)?.focus());
    }
  }, [commitAndClose, legacyReturnFocusId, triggerRef]);

  useEffect(() => {
    if (!props.open) return;
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [props.open]);

  const dialogName =
    props.questionNumber !== undefined ? SAT_COPY.questionNote.title + " \u2014 question " + props.questionNumber : SAT_COPY.questionNote.title;
  const annotations = props.annotations ?? [];
  const showsEmptyState = annotations.length === 0 && props.note.trim().length === 0;

  return (
    <SatPopoverShell
      open={props.open}
      title={SAT_COPY.questionNote.title}
      ariaLabel={dialogName}
      triggerRef={triggerRef}
      onClose={handleClose}
      closeLabel={SAT_COPY.questionNote.close}
      anchoredClassName="sat-ui sat-reading-surface sat-popover-anchored fixed right-[calc(1rem+var(--student-safe-right))] top-[calc(var(--student-safe-top)+98px)] z-[70] w-[min(380px,calc(100vw-32px))] overflow-hidden rounded-[8px] border border-[var(--sat-answer-border)] bg-[var(--sat-surface)] shadow-sm"
      compactClassName="sat-ui sat-reading-surface w-full max-w-[560px] overflow-hidden rounded-[10px] border border-[var(--sat-answer-border)] bg-[var(--sat-surface)] shadow-[var(--sat-shadow-floating)]"
      backdropClassName="sat-dialog-backdrop fixed inset-0 z-[78] grid place-items-center bg-black/20"
    >
      {/* Bluebook note card interior (Phase 7, Lane 3): pale-yellow 38px
          header band + 12px body padding; answer-grade border + small
          shadow live on the panel classes above (overlay contract owns
          geometry/backdrop — untouched). */}
      <div data-sat-note-header className="flex min-h-[38px] items-center bg-[var(--sat-note-header)] px-3">
        <span className="sat-type-control-secondary font-semibold text-[var(--sat-text)]">{SAT_COPY.questionNote.fieldLabel}</span>
      </div>
      <div className="p-3" style={panelStyle}>
        {annotations.length > 0 ? (
          <ul data-sat-notes-list="true" className="mb-3 flex flex-col gap-2">
            {annotations.map((annotation) => (
              <li key={annotation.id}>
                <button
                  type="button"
                  data-sat-note-row={annotation.id}
                  disabled={props.disabled || !props.onOpenAnnotation}
                  onClick={() => props.onOpenAnnotation?.(annotation.id)}
                  className="sat-touch-target sat-pressable flex w-full items-start gap-2 rounded-[6px] border border-[var(--sat-answer-border)] bg-[var(--sat-surface)] px-2 py-2 text-left hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:text-[var(--sat-disabled-text)]"
                >
                  {/* Same ink dot as the mark in the passage: the visual link
                      between a note and its source, without drawing a line. */}
                  <span
                    aria-hidden="true"
                    className="mt-1 h-[14px] w-[14px] shrink-0 rounded-full border border-[var(--sat-divider-strong)]"
                    style={{ backgroundColor: satHighlightInk(annotation.color).swatch }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate sat-type-metadata italic text-[var(--sat-text-secondary)]">
                      {annotation.anchor.exact}
                    </span>
                    <span className="mt-0.5 block line-clamp-2 sat-type-control-secondary text-[var(--sat-text)]">
                      {annotation.note}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {showsEmptyState && props.emptyState ? props.emptyState : null}
        <label htmlFor="sat-question-note" className="block sat-type-control-secondary font-normal text-[var(--sat-text-secondary)]">
          <span className="sr-only">{SAT_COPY.questionNote.fieldLabel}</span>
          {/* eslint-disable-next-line jsx-a11y/control-has-associated-label -- label text comes from the SAT_COPY table (non-literal); association is real via wrapping label + htmlFor. */}
          <textarea
            ref={textareaRef}
            id="sat-question-note"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 2_000))}
            disabled={props.disabled}
            rows={6}
            aria-describedby="sat-question-note-count sat-question-note-hint"
            className="sat-reading-copy w-full resize-y rounded-[6px] border border-[var(--sat-answer-border)] bg-[var(--sat-surface)] p-3 sat-type-control-primary font-normal leading-6 text-[var(--sat-text)] outline-none focus:border-[var(--sat-accent)] focus:ring-2 focus:ring-[var(--sat-focus)]/25 disabled:cursor-not-allowed disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)]"
            placeholder={SAT_COPY.questionNote.placeholder}
          />
        </label>
        <p id="sat-question-note-hint" className="mt-2 sat-type-metadata text-[var(--sat-text-secondary)]">
          {SAT_COPY.questionNote.autoSaveHint}
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span id="sat-question-note-count" className="sat-type-metadata text-[var(--sat-text-secondary)]" aria-live="polite">
            {draft.length}/2000
          </span>
          <button
            type="button"
            disabled={props.disabled}
            onClick={handleClose}
            className="sat-touch-target sat-pressable rounded-full bg-[var(--sat-accent)] px-5 sat-type-control-secondary font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] disabled:cursor-not-allowed disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2"
          >
            {SAT_COPY.questionNote.saveAndClose}
          </button>
        </div>
        <span className="hidden" data-sat-compact-flag={compact ? "true" : undefined} aria-hidden="true" />
      </div>
    </SatPopoverShell>
  );
}

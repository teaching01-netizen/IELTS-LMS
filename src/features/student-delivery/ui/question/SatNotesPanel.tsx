import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, type MotionStyle } from "motion/react";
import { useSatMediaQuery } from "../useSatMediaQuery";
import { X } from "lucide-react";
import type { SatReadingPreferences } from "../../domain/satReadingPreferences";
import { satReadingStyle } from "../reading/satReadingStyle";
import { SatPresenceSurface } from "../motion/SatPresenceSurface";

const COMPACT_NOTES_QUERY = "(max-width: 720px), (max-height: 560px)";

export interface SatNotesPanelProps {
  open: boolean;
  note: string;
  disabled: boolean;
  readingPreferences: SatReadingPreferences;
  returnFocusId: string;
  onSave: (note: string) => void;
  onClose: () => void;
}

export function SatNotesPanel(props: SatNotesPanelProps) {
  const [draft, setDraft] = useState(props.note);
  const compact = useSatMediaQuery(COMPACT_NOTES_QUERY);
  const readingStyle = satReadingStyle(props.readingPreferences);
  const panelStyle: MotionStyle & {
    "--sat-reading-scale": string;
    "--sat-reading-line-height": string;
  } = {
    "--sat-reading-scale": readingStyle["--sat-reading-scale"],
    "--sat-reading-line-height": readingStyle["--sat-reading-line-height"],
  };
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef(draft);
  const noteRef = useRef(props.note);
  const disabledRef = useRef(props.disabled);
  const onSaveRef = useRef(props.onSave);
  const returnFocusIdRef = useRef(props.returnFocusId);
  const onCloseRef = useRef(props.onClose);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    noteRef.current = props.note;
    disabledRef.current = props.disabled;
    onSaveRef.current = props.onSave;
    returnFocusIdRef.current = props.returnFocusId;
    onCloseRef.current = props.onClose;
    if (props.open) setDraft(props.note);
  }, [props.disabled, props.note, props.onClose, props.onSave, props.open, props.returnFocusId]);

  const commitAndClose = useCallback(() => {
    const next = draftRef.current.trim();
    if (!disabledRef.current && next !== noteRef.current) onSaveRef.current(next);
    onCloseRef.current();
    window.requestAnimationFrame(() => document.getElementById(returnFocusIdRef.current)?.focus());
  }, []);

  useEffect(() => {
    if (!props.open) return;
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        commitAndClose();
        return;
      }
      if (!compact || event.key !== "Tab" || !panelRef.current) return;
      const focusable = [
        ...panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ),
      ];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [commitAndClose, compact, props.open]);

  const panel = (
    <SatPresenceSurface
      offsetY={compact ? 5 : 3}
      ref={panelRef}
      role="dialog"
      aria-modal={compact ? true : undefined}
      aria-labelledby="sat-question-notes-title"
      style={panelStyle}
      className={
        compact
          ? "sat-ui sat-reading-surface w-full max-w-[560px] overflow-hidden rounded-[10px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] shadow-[0_24px_70px_rgba(0,0,0,0.24)]"
          : "sat-ui sat-reading-surface absolute right-[calc(1rem+var(--student-safe-right))] top-[102px] z-[70] w-[min(380px,calc(100vw-32px))] overflow-hidden rounded-[8px] border border-[var(--sat-divider-soft)] bg-[var(--sat-surface)] shadow-[0_18px_50px_rgba(0,0,0,0.18)]"
      }
    >
      <div className="flex min-h-11 items-center justify-between border-b border-[var(--sat-divider-soft)] px-4">
        <h2
          id="sat-question-notes-title"
          className="text-[15px] font-semibold text-[var(--sat-text)]"
        >
          Notes
        </h2>
        <button
          type="button"
          onClick={commitAndClose}
          className="sat-touch-target sat-pressable grid place-items-center rounded-[6px] text-[var(--sat-text)] hover:bg-[var(--sat-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]"
          aria-label="Close notes and save changes"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="p-4">
        <label
          htmlFor="sat-question-note"
          className="block text-[14px] font-semibold text-[var(--sat-text-secondary)]"
        >
          <span>Note for this question</span>
          <textarea
            ref={textareaRef}
            id="sat-question-note"
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, 2_000))}
            disabled={props.disabled}
            rows={6}
            aria-label="Note for this question"
            className="sat-reading-copy mt-2 w-full resize-y rounded-[6px] border border-[var(--sat-divider)] bg-[var(--sat-surface)] p-3 text-[15px] font-normal leading-6 text-[var(--sat-text)] outline-none focus:border-[var(--sat-accent)] focus:ring-2 focus:ring-[var(--sat-focus)]/25 disabled:cursor-not-allowed disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)]"
            placeholder="Add a note you can revisit in this module."
          />
        </label>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-[13px] text-[var(--sat-text-secondary)]">{draft.length}/2000</span>
          <button
            type="button"
            disabled={props.disabled}
            onClick={commitAndClose}
            className="sat-touch-target sat-pressable rounded-full bg-[var(--sat-accent)] px-5 text-[14px] font-semibold text-[var(--sat-accent-text)] hover:bg-[var(--sat-accent-strong)] disabled:cursor-not-allowed disabled:bg-[var(--sat-disabled-background)] disabled:text-[var(--sat-disabled-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] focus-visible:ring-offset-2"
          >
            Done
          </button>
        </div>
      </div>
    </SatPresenceSurface>
  );

  return (
    <AnimatePresence initial={false}>
      {props.open ? (
        compact ? (
          <SatPresenceSurface
            motionKind="backdrop"
            className="sat-dialog-backdrop fixed inset-0 z-[78] grid place-items-center bg-black/20"
          >
            {panel}
          </SatPresenceSurface>
        ) : (
          panel
        )
      ) : null}
    </AnimatePresence>
  );
}

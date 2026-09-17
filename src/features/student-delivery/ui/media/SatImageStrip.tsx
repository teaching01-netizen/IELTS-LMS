import type { KeyboardEvent as ReactKeyboardEvent, Ref } from "react";
import { Maximize2, Minimize2, Minus, Plus, RotateCcw } from "lucide-react";
import { SAT_COPY, satImageControlsLabel } from "../../domain/satCopy";
import { isSatShortcutEditableTarget } from "../../domain/satShortcuts";
import { satImagePercentLabel } from "../../domain/satImageZoom";

/**
 * The figure viewer's quiet utility strip.
 *
 * Bluebook's strip is deliberately unimpressive: small neutral controls, a
 * written percentage, and nothing that competes with the graph. It sits *above*
 * the content, in the same object it commands, so the magnifier can only mean
 * "this figure" — the border and the strip together teach that with no
 * instructional text.
 *
 * The layout says what the controls are:
 *
 *     −  +  125%  Reset   │   Full screen
 *     └── magnification ──┘   └─ presentation ─┘
 *
 * Everything left of the divider changes the graph *inside* the viewport;
 * everything right of it changes the viewport itself. That is the whole
 * architecture, taught without a word.
 *
 * Two rules hold the interaction steady:
 *
 *   - the order never changes and Reset is never removed, only dimmed, so the
 *     student's spatial memory of the strip survives at every magnification;
 *   - the percentage is both status and confirmation ("125%" answers *how far
 *     in am I* and *did that press land* at once), so repeated presses can never
 *     leave the student guessing. It is a status, never a button, and its
 *     tabular numerals mean the readout cannot reflow between 100% and 125%.
 */
export interface SatImageStripProps {
  /** The figure's name, so several strips on one question stay distinguishable. */
  label: string;
  /** Current magnification, as a ratio (1 = 100%). */
  zoom: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  /** True once anything is left to restore; drives Reset's enabled state. */
  dirty: boolean;
  fullScreen: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  onToggleFullScreen: () => void;
  /** Focus-return anchor: the control the viewer hands focus back to on exit. */
  fullScreenButtonId?: string | undefined;
  /** The full-screen layer focuses the strip itself when it opens. */
  toolbarRef?: Ref<HTMLDivElement> | undefined;
}

const PRESSED_AND_FOCUSED =
  "sat-pressable focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)]";

const CONTROL_CLASS =
  "sat-touch-target grid h-9 w-9 shrink-0 place-items-center rounded-[6px] text-[var(--sat-text-secondary,#475569)] transition-colors hover:bg-[var(--sat-surface-hover,#f1f5f9)] hover:text-[var(--sat-text,#0f172a)] disabled:cursor-not-allowed disabled:text-[var(--sat-disabled-text,#94a3b8)] disabled:opacity-35 disabled:hover:bg-transparent " +
  PRESSED_AND_FOCUSED;

const LABELLED_CONTROL_CLASS =
  "sat-touch-target inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] font-medium text-[var(--sat-text,#0f172a)] transition-colors hover:bg-[var(--sat-surface-hover,#f1f5f9)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-focus)] disabled:cursor-not-allowed disabled:text-[var(--sat-disabled-text,#94a3b8)] disabled:opacity-35 disabled:hover:bg-transparent " +
  PRESSED_AND_FOCUSED;

export function SatImageStrip(props: SatImageStripProps) {
  // Keyboard stays on this element, never on the document: once a strip is
  // mounted beside every figure, a global `-` or `0` listener would zoom a graph
  // while the student types a note or a student-produced answer.
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || isSatShortcutEditableTarget(event.target)) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      props.onZoomIn();
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      props.onZoomOut();
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      props.onReset();
    }
  };

  const fullScreenLabel = props.fullScreen
    ? SAT_COPY.imageViewer.exitFullScreen
    : SAT_COPY.imageViewer.enterFullScreen;

  return (
    <div
      ref={props.toolbarRef}
      role="toolbar"
      aria-label={satImageControlsLabel(props.label)}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      data-sat-image-strip=""
      className={
        "flex min-h-11 w-full items-center justify-between gap-1 focus-visible:outline-none " +
        (props.fullScreen
          ? "border-b border-[var(--sat-divider-soft,#e2e8f0)] bg-[var(--sat-surface,#ffffff)] px-3 py-1.5"
          : "rounded-lg border border-[var(--sat-divider,#e2e8f0)] bg-[var(--sat-surface,#f8fafc)] px-1.5 py-1 shadow-[0_1px_2px_rgba(0,0,0,0.04)]")
      }
    >
      <div className="flex items-center gap-0.5 sm:gap-1">
        <button
          type="button"
          onClick={props.onZoomOut}
          disabled={!props.canZoomOut}
          aria-label={SAT_COPY.imageViewer.zoomOut}
          title={SAT_COPY.imageViewer.zoomOut}
          data-sat-image-zoom-out=""
          className={CONTROL_CLASS + " w-9 sm:w-10"}
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={props.onZoomIn}
          disabled={!props.canZoomIn}
          aria-label={SAT_COPY.imageViewer.zoomIn}
          title={SAT_COPY.imageViewer.zoomIn}
          data-sat-image-zoom-in=""
          className={CONTROL_CLASS + " w-9 sm:w-10"}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
        <span
          role="status"
          aria-label={SAT_COPY.imageViewer.zoomLevel}
          aria-live="polite"
          data-sat-image-zoom-level=""
          className="sat-tabular min-w-[48px] shrink-0 select-none px-1 text-center text-[12px] font-medium text-[var(--sat-text-secondary,#475569)]"
        >
          {satImagePercentLabel(props.zoom)}
        </span>
        <button
          type="button"
          onClick={props.onReset}
          disabled={!props.dirty}
          aria-label={SAT_COPY.imageViewer.resetZoom}
          title={SAT_COPY.imageViewer.resetZoom}
          data-sat-image-reset=""
          className={LABELLED_CONTROL_CLASS}
        >
          <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            Reset<span className="hidden sm:inline"> zoom</span>
          </span>
        </button>
      </div>
      <div className="flex items-center gap-1">
        <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-[var(--sat-divider-soft,#e2e8f0)]" />
        <button
          type="button"
          id={props.fullScreenButtonId}
          onClick={props.onToggleFullScreen}
          aria-label={fullScreenLabel}
          title={fullScreenLabel}
          data-sat-image-full-screen=""
          className={LABELLED_CONTROL_CLASS}
        >
          {props.fullScreen ? (
            <Minimize2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>
            {props.fullScreen ? (
              <>
                Exit<span className="hidden sm:inline"> full screen</span>
              </>
            ) : (
              <>
                Full<span className="hidden sm:inline"> screen</span>
              </>
            )}
          </span>
        </button>
      </div>
    </div>
  );
}

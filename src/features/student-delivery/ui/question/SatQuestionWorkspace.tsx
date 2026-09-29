import { useCallback, useRef, type ReactNode } from "react";
import type { SatReadingPreferences } from "../../domain/satReadingPreferences";
import { SAT_NOTES_COLUMN_TRACK, SAT_NOTES_PAIR_TRACK, SAT_NOTES_RAIL_TRACK } from "../../domain/satNotesUi";
import {
  SAT_READING_NOTES_COLUMN_SEAT_TRACK,
  SAT_READING_NOTES_PAIR_SEAT_TRACK,
  type SatReadingPresentation,
} from "../../domain/satReadingLayout";
import { satReadingStyle } from "../reading/satReadingStyle";
import { useSatReadingLayout } from "../reading/SatReadingLayoutContext";
import { SatReadingSplitHandle } from "./SatReadingSplitHandle";
import { useSatNotesSurface } from '../annotations/SatNotesSurfaceContext';

export interface SatQuestionWorkspaceProps {
  split: boolean;
  stimulus?: ReactNode;
  stimulusLabel?: string;
  question: ReactNode;
  readingPreferences: SatReadingPreferences;
  onSplitRatioChange: (ratio: number) => void;
}

/**
 * The stacked rows' minimums, each capped by a share of the available height.
 *
 * A hard `min-height` would overflow a short screen; a bare `1fr` would let the
 * passage and the question meet in the middle of a phone with both panes
 * unreadable. `minmax(min(240px, 44%), 0.9fr)` says exactly what is meant: the
 * passage wants a quarter-screen of reading height, and gets it unless the
 * screen has less than that to give.
 */
const SAT_STACKED_QUESTION_ROWS =
  'minmax(min(240px, 44%), 0.9fr) minmax(min(260px, 48%), 1.1fr)';
/**
 * The same two rows for a question with no passage beside it: the one reading
 * pane, then the notes that belong to it.
 *
 * Spelled separately rather than reusing the template above, because the case is
 * different even where the numbers match: there is one reading pane here, and the
 * second row is a pane the student opened rather than a peer of the first. Naming
 * it keeps the shares honest if either case is ever calibrated on its own.
 */
const SAT_SINGLE_PANE_NOTES_ROWS = SAT_STACKED_QUESTION_ROWS;
const SAT_STACKED_QUESTION_ROWS_WITH_NOTES =
  'minmax(min(180px, 30%), 0.9fr) minmax(min(200px, 34%), 1.1fr) minmax(min(180px, 30%), 1fr)';

/**
 * Passage | Notes | Question — or, where that does not fit, a two-pane
 * `Passage | Notes` (the question returns the moment notes close) or notes
 * stacked beneath both panes.
 *
 * The Notes pane is a structural member of this grid, not a panel floating over
 * it, because the whole point of a note is its relationship to the text it is
 * about. Which of the three arrangements applies is decided once, by
 * `satNotesPlacement` in the surface host, and read here — this component never
 * re-derives it. The handle left behind when the pane is hidden keeps the same
 * seat, so hiding notes swaps the pane for its handle instead of reflowing the
 * exam around the gap.
 *
 * Passage-versus-question arrangement is likewise READ, never re-derived: the
 * workspace registers itself as the box the shared layout decision is measured
 * from and then renders what that decision says. Split and stacked are the same
 * DOM in the same order with different `grid-template-*` values, so nothing that
 * lives in these panes — an answer, a mark, a half-written note, a scroll
 * position — is remounted when the text size crosses the threshold.
 */
export function SatQuestionWorkspace({
  split,
  stimulus,
  stimulusLabel = "Passage",
  question,
  readingPreferences,
  onSplitRatioChange,
}: SatQuestionWorkspaceProps) {
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const readingLayout = useSatReadingLayout();
  const { registerWorkspace } = readingLayout;
  const readingStyle = satReadingStyle(readingPreferences);
  const notes = useSatNotesSurface();
  // A question with a stimulus is either split or stacked — `single` IS the
  // no-stimulus case, which the `split` prop already states. Before the first
  // measurement lands, the workspace keeps the classic two-pane arrangement
  // rather than guessing stacked from nothing.
  const presentation: SatReadingPresentation = !split
    ? "single"
    : readingLayout.decision.presentation === "stacked"
      ? "stacked"
      : "split";
  const stacked = presentation === "stacked";
  /**
   * Register the pane area the decision is measured from.
   *
   * Stable across renders (the provider's `registerWorkspace` is stable by
   * contract): a ref callback whose identity churned would tear the observer
   * down and rebuild it on every commit.
   */
  const workspaceRef = useCallback(
    (node: HTMLDivElement | null) => {
      splitContainerRef.current = node;
      registerWorkspace(node, split);
    },
    [registerWorkspace, split],
  );
  // The column is the single landmark (it names itself); the seat below only
  // places it, so the accessible tree never carries two "Notes" landmarks, and
  // the seat carries no role of its own. Which track it takes is implied by its
  // place in the template below, which is the single statement of the placement.
  // The seat, not the bare panel: where the split handle rides the divider beside
  // this pane, the track carries the handle's clearance as well as the panel —
  // the same gutter the pane applies in front of its own chrome, from the same
  // constant, so the two cannot describe different widths. With one pane there is
  // no divider to move, so the panel's own band is the whole claim.
  const columnTrack =
    presentation === 'split' ? SAT_READING_NOTES_COLUMN_SEAT_TRACK : SAT_NOTES_COLUMN_TRACK;
  const pairTrack =
    presentation === 'split' ? SAT_READING_NOTES_PAIR_SEAT_TRACK : SAT_NOTES_PAIR_TRACK;
  const paneTrack = notes.placement === 'column'
    ? columnTrack
    : notes.placement === 'pair'
      ? pairTrack
      : null;
  // The hidden pane's handle holds the column's track. Whether it exists at all
  // is the host's answer (`satNotesRailVisible`), so this only places what it
  // was handed — the same contract the column follows. Hiding notes therefore
  // swaps one member for another in the same seat rather than reflowing the exam.
  const railTrack = notes.rail ? SAT_NOTES_RAIL_TRACK : null;
  /**
   * The one grid member notes occupy, in every arrangement.
   *
   * Whether that member is the column or the handle a hidden column left behind
   * is the host's answer; this only places what it was handed. It is a WRAPPER
   * rather than the column itself, and it is the same wrapper at the same place
   * in the tree whatever the placement says, because a placement is a position in
   * the grid and positions move: the column is handed between the middle of the
   * row and the row beneath the panes, and a component that moved between two
   * different parents would be REBUILT rather than moved. The student types in
   * there — a rebuilt pane commits the draft through the unmount hand-off and
   * then hands them a fresh caret, and an open disclosure, a scroll position and
   * a selection all go with it. One element whose `grid-*` properties change
   * keeps the pane a moved pane.
   *
   * The row is the only arrangement that needs saying: `1 / -1` claims the full
   * width under the panes, and `order` is what puts it there rather than between
   * them — grid items are placed in order-modified document order, so the panes
   * take the first rows and the note row is placed last, which is also how it
   * reads. Everywhere else the track template places this member.
   */
  const notesMember = notes.placement === 'none' ? notes.rail : notes.column;
  const notesInRow = notes.placement === 'row';
  const notesSlot = notesMember ? (
    <section
      data-sat-notes-slot="true"
      {...(notesInRow ? { 'data-sat-notes-row': 'true' as const } : {})}
      className={
        notesInRow
          ? 'min-h-0 min-w-0 overflow-hidden border-t border-[var(--sat-divider)]'
          : 'min-h-0 min-w-0'
      }
      style={notesInRow ? { gridColumn: stacked ? undefined : '1 / -1', order: 3 } : undefined}
    >
      {notesMember}
    </section>
  ) : null;
  // One machine-readable answer for tests, support, and the e2e legs: which
  // arrangement is on screen, whether it came from a measurement, and why.
  const layoutAttributes = {
    'data-sat-reading-layout': presentation,
    'data-sat-reading-layout-measured': readingLayout.measured ? 'true' : 'false',
    'data-sat-reading-layout-reason': readingLayout.decision.reason,
    'data-sat-notes-placement': notes.placement,
  } as const;

  if (!split) {
    return (
      <div
        ref={workspaceRef}
        // The reading surface (and its scale token) belongs on the wrapper so
        // the notes pane beside the question scales with the same text size.
        // `overflow-hidden` is what keeps the workspace itself from ever
        // scrolling sideways: a pane whose content is genuinely two-dimensional
        // scrolls its own local surface, and the exam's frame never moves.
        className="sat-reading-surface grid h-full min-h-0 min-w-0 overflow-hidden"
        {...layoutAttributes}
        style={{
          ...readingStyle,
          gridTemplateColumns: paneTrack
            ? `minmax(0, 1fr) 2px ${paneTrack}`
            : railTrack
              ? `minmax(0, 1fr) 2px ${railTrack}`
              : undefined,
          gridTemplateRows: notesInRow ? SAT_SINGLE_PANE_NOTES_ROWS : undefined,
        }}
      >
        <div
          className="h-full min-h-0 min-w-0 overflow-y-auto bg-[var(--sat-background)]"
          data-sat-question-scroll
          data-student-exam-scroll-owner
        >
          <div className="mx-auto w-full max-w-[760px] px-5 py-6 sm:px-8 sm:py-8">{question}</div>
        </div>
        {paneTrack || railTrack ? <div aria-hidden="true" className="bg-[var(--sat-divider)]" /> : null}
        {notesSlot}
      </div>
    );
  }

  // `pair` replaces the question pane while notes are open: at these widths a
  // third column would squeeze both reading panes to slivers, so the note gets
  // the space and the question comes back the moment notes close.
  const showsQuestion = notes.placement !== 'pair';
  const questionRatio = 1 - readingPreferences.splitRatio;
  return (
    <div
      ref={workspaceRef}
      className="sat-reading-surface grid h-full min-h-0 min-w-0 overflow-hidden bg-[var(--sat-background)]"
      data-sat-reading-split
      {...layoutAttributes}
      style={{
        ...readingStyle,
        // Bluebook 2px hard divider between the panes — passage and question, or
        // passage and the note column that belongs to it.
        gridTemplateColumns: stacked
          ? 'minmax(0, 1fr)'
          : notes.placement === 'column'
            ? `minmax(0, ${readingPreferences.splitRatio}fr) 2px ${columnTrack} 2px minmax(0, ${questionRatio}fr)`
            : notes.placement === 'pair'
              ? `minmax(0, 1fr) 2px ${pairTrack}`
              : railTrack
                ? `minmax(0, ${readingPreferences.splitRatio}fr) 2px ${railTrack} 2px minmax(0, ${questionRatio}fr)`
                : `minmax(0, ${readingPreferences.splitRatio}fr) 2px minmax(0, ${questionRatio}fr)`,
        gridTemplateRows: stacked
          ? notesInRow
            ? SAT_STACKED_QUESTION_ROWS_WITH_NOTES
            : SAT_STACKED_QUESTION_ROWS
          : notesInRow
            ? 'minmax(0, 1fr) minmax(0, 1fr)'
            : undefined,
      }}
    >
      <section
        // Stacked panes are separated by an edge, not by a grid member: the
        // divider element only makes sense where there are two columns to hold
        // it apart, and a stray one here would claim a row of its own.
        className={
          "min-h-0 min-w-0 overflow-y-auto px-5 py-6 md:px-10 md:py-8" +
          (stacked && showsQuestion ? " border-b border-[var(--sat-divider)]" : "")
        }
        aria-label={stimulusLabel}
        data-sat-passage-scroll
        data-student-exam-scroll-owner
      >
        <div className="mx-auto max-w-[660px] sat-exam-prose sat-type-body text-[var(--sat-text)]">
          {/* Teaching lives in the passage it is about, not pinned to the tool
              that delivers it. */}
          {notes.passageHint}
          {stimulus}
        </div>
      </section>
      {/* The width control belongs to the passage/question pair; with the question
          replaced by notes there is nothing for it to balance. It also does not
          exist while the panes are stacked: an unusable slider has no business
          staying in the accessibility tree. */}
      {presentation === "split" && showsQuestion ? <SatReadingSplitHandle
        containerRef={splitContainerRef}
        ratio={readingPreferences.splitRatio}
        leftPaneLabel={stimulusLabel}
        onChange={onSplitRatioChange}
        onInteractionChange={readingLayout.setSplitInteractionActive}
      /> : null}
      {!stacked && !showsQuestion ? <div aria-hidden="true" className="bg-[var(--sat-divider)]" /> : null}
      {notesSlot}
      {(paneTrack || railTrack) && showsQuestion ? <div aria-hidden="true" className="bg-[var(--sat-divider)]" /> : null}
      {showsQuestion ? (
        <section
          className="min-h-0 min-w-0 overflow-y-auto px-5 py-5 md:px-10 md:py-8"
          aria-label="Question"
          data-sat-question-scroll
          data-student-exam-scroll-owner
        >
          <div className="mx-auto max-w-[650px]">{question}</div>
        </section>
      ) : null}
    </div>
  );
}

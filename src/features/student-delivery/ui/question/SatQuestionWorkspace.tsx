import { useRef, type ReactNode } from "react";
import type { SatReadingPreferences } from "../../domain/satReadingPreferences";
import { SAT_NOTES_COLUMN_TRACK, SAT_NOTES_PAIR_TRACK, SAT_NOTES_RAIL_TRACK } from "../../domain/satNotesUi";
import { satReadingStyle } from "../reading/satReadingStyle";
import { SatReadingSplitHandle } from "./SatReadingSplitHandle";
import { useSatMediaQuery } from '../useSatMediaQuery';
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
  const compact = useSatMediaQuery('(max-width: 767px)');
  const readingStyle = satReadingStyle(readingPreferences);
  const notes = useSatNotesSurface();
  // The column is the single landmark (it names itself); these wrappers only
  // place it, so the accessible tree never carries two "Notes" landmarks.
  // The column is a grid member outright — it already carries the flex/h-full
  // classes a track needs, so wrapping it would only add a level to the
  // accessibility tree. Which track it takes is implied by its place in the
  // template below, which is the single statement of the placement.
  const paneTrack = notes.placement === 'column'
    ? SAT_NOTES_COLUMN_TRACK
    : notes.placement === 'pair'
      ? SAT_NOTES_PAIR_TRACK
      : null;
  // The hidden pane's handle holds the column's track. Whether it exists at all
  // is the host's answer (`satNotesRailVisible`), so this only places what it
  // was handed — the same contract the column follows. Hiding notes therefore
  // swaps one member for another in the same seat rather than reflowing the exam.
  const railTrack = notes.rail ? SAT_NOTES_RAIL_TRACK : null;
  const notesSide = paneTrack ? notes.column : notes.rail;
  const notesRow = notes.placement === 'row' ? (
    <section
      className="min-h-0 min-w-0 overflow-hidden border-t border-[var(--sat-divider)]"
      data-sat-notes-row
      style={{ gridColumn: compact ? undefined : '1 / -1' }}
    >
      {notes.column}
    </section>
  ) : null;

  if (!split) {
    return (
      <div
        // The reading surface (and its scale token) belongs on the wrapper so
        // the notes pane beside the question scales with the same text size.
        className="sat-reading-surface grid h-full min-h-0 min-w-0"
        style={{
          ...readingStyle,
          gridTemplateColumns: paneTrack
            ? `minmax(0, 1fr) 2px ${paneTrack}`
            : railTrack
              ? `minmax(0, 1fr) 2px ${railTrack}`
              : undefined,
          gridTemplateRows: notesRow ? 'repeat(2, minmax(0, 1fr))' : undefined,
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
        {notesSide ?? notesRow}
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
      ref={splitContainerRef}
      className="sat-reading-surface grid h-full min-h-0 min-w-0 overflow-hidden bg-[var(--sat-background)]"
      data-sat-reading-split
      data-sat-notes-placement={notes.placement}
      style={{
        ...readingStyle,
        // Bluebook 2px hard divider between the panes — passage and question, or
        // passage and the note column that belongs to it.
        gridTemplateColumns: compact
          ? 'minmax(0, 1fr)'
          : notes.placement === 'column'
            ? `minmax(0, ${readingPreferences.splitRatio}fr) 2px ${SAT_NOTES_COLUMN_TRACK} 2px minmax(0, ${questionRatio}fr)`
            : notes.placement === 'pair'
              ? `minmax(0, 1fr) 2px ${SAT_NOTES_PAIR_TRACK}`
              : railTrack
                ? `minmax(0, ${readingPreferences.splitRatio}fr) 2px ${railTrack} 2px minmax(0, ${questionRatio}fr)`
                : `minmax(0, ${readingPreferences.splitRatio}fr) 2px minmax(0, ${questionRatio}fr)`,
        gridTemplateRows: compact
          ? `repeat(${notesRow ? 3 : 2}, minmax(0, 1fr))`
          : notesRow
            ? 'minmax(0, 1fr) minmax(0, 1fr)'
            : undefined,
      }}
    >
      <section
        className="min-h-0 min-w-0 overflow-y-auto px-5 py-6 md:px-10 md:py-8"
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
          replaced by notes there is nothing for it to balance. */}
      {!compact && showsQuestion ? <SatReadingSplitHandle
        containerRef={splitContainerRef}
        ratio={readingPreferences.splitRatio}
        leftPaneLabel={stimulusLabel}
        onChange={onSplitRatioChange}
      /> : null}
      {!compact && !showsQuestion ? <div aria-hidden="true" className="bg-[var(--sat-divider)]" /> : null}
      {notesSide}
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
      {notesRow}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/src/components/ui/sheet';
import { SatAttemptAnswersContent } from '../routes/SatAttemptAnswersRoute';
import { SatResultDetailContent } from '../routes/SatResultDetailRoute';

export interface InspectedAttempt {
  attemptId: string;
  /** Present when the attempt has a scored result with its own detail view. */
  resultId: string | null;
  /** From the list row, so the header names the student before details load. */
  studentName?: string | null;
}

const STEP_BUTTON = 'sat-btn sat-btn--quiet sat-btn--icon sat-press';

/**
 * Opens one student's response beside the attempts list instead of navigating
 * away: the list, its filters, its page and the scroll position all stay put,
 * and Escape / the close button returns to exactly where the reviewer was.
 * Previous / Next walk the filtered list so several students can be reviewed
 * in a row; "Open as page" remains for a deeper, linkable review.
 */
export function SatAttemptInspector({
  attempt,
  onClose,
  returnPath,
  position = null,
  onPrevious = null,
  onNext = null,
}: {
  attempt: InspectedAttempt | null;
  onClose: () => void;
  returnPath: string;
  /** Zero-based position of the open attempt in the filtered list on this page. */
  position?: { index: number; total: number } | null;
  onPrevious?: (() => void) | null;
  onNext?: (() => void) | null;
}) {
  const [view, setView] = useState<'result' | 'answers'>('result');
  const attemptId = attempt?.attemptId ?? null;
  const hasResult = Boolean(attempt?.resultId);

  // Closing returns focus to the row last inspected, not the row that opened the
  // sheet: Previous / Next move through other rows while the sheet stays mounted.
  const lastInspectedRef = useRef<string | null>(null);
  useEffect(() => {
    if (attemptId) lastInspectedRef.current = attemptId;
  }, [attemptId]);

  // Each student starts on their own summary, never on the previous student's tab.
  useEffect(() => {
    setView(hasResult ? 'result' : 'answers');
  }, [attemptId, hasResult]);

  const fullPage = attempt
    ? hasResult && view === 'result'
      ? `/sat/results/${encodeURIComponent(attempt.resultId!)}`
      : `/sat/results/attempts/${encodeURIComponent(attempt.attemptId)}`
    : null;
  const subtitle = [
    attempt?.studentName ?? null,
    position ? `Student ${position.index + 1} of ${position.total} on this page` : null,
  ].filter(Boolean).join(' · ');

  return (
    <Sheet open={attempt !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="sat-product sat-staff-root flex w-[min(96vw,820px)] max-w-[820px] flex-col gap-0 p-0 sm:max-w-[820px]"
        onCloseAutoFocus={(event) => {
          const id = lastInspectedRef.current;
          // The record is a table row; its focusable target is the review button inside it.
          const record = id ? document.querySelector<HTMLElement>(`[data-sat-row-id="${CSS.escape(id)}"]`) : null;
          const target = record?.matches('button') ? record : record?.querySelector<HTMLElement>('button') ?? null;
          if (!target) return;
          event.preventDefault();
          target.focus({ preventScroll: true });
        }}
        onKeyDown={(event) => {
          // Alt + ↑ / ↓ steps through students without leaving the sheet.
          if (!event.altKey) return;
          if (event.key === 'ArrowUp' && onPrevious) { event.preventDefault(); onPrevious(); }
          if (event.key === 'ArrowDown' && onNext) { event.preventDefault(); onNext(); }
        }}
      >
        <SheetHeader className="flex-row items-center justify-between gap-3 border-b border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] px-6 py-3 pr-14 text-left">
          <div className="min-w-0">
            <SheetTitle className="text-[16px] leading-6">Student response</SheetTitle>
            <SheetDescription className="truncate text-[14px] leading-5">{subtitle || 'Review without leaving the attempts list.'}</SheetDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {position ? (
              <>
                <button type="button" onClick={() => onPrevious?.()} disabled={!onPrevious} aria-label="Previous student" title="Previous student (Alt ↑)" className={STEP_BUTTON}>
                  <ChevronUp size={16} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => onNext?.()} disabled={!onNext} aria-label="Next student" title="Next student (Alt ↓)" className={STEP_BUTTON}>
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
              </>
            ) : null}
            {fullPage ? (
              <Link
                to={fullPage}
                state={{ from: returnPath }}
                className="sat-btn sat-btn--quiet sat-press px-3"
              >
                <ExternalLink size={14} aria-hidden="true" />
                Open as page
              </Link>
            ) : null}
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-5">
          {attempt && hasResult && view === 'result' ? (
            <SatResultDetailContent
              embedded
              resultId={attempt.resultId!}
              onBack={onClose}
              onOpenAnswers={() => setView('answers')}
            />
          ) : attempt ? (
            <SatAttemptAnswersContent
              embedded
              attemptId={attempt.attemptId}
              {...(hasResult ? { onBack: () => setView('result') } : {})}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

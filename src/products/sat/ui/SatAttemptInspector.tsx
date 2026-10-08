import { useEffect, useState } from 'react';
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

const STEP_BUTTON =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--sat-staff-radius-control,10px)] text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent,#0071e3)] disabled:cursor-not-allowed disabled:opacity-35';

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
        className="sat-product flex w-[min(96vw,780px)] max-w-[780px] flex-col gap-0 p-0 sm:max-w-[780px]"
        onKeyDown={(event) => {
          // Alt + ↑ / ↓ steps through students without leaving the sheet.
          if (!event.altKey) return;
          if (event.key === 'ArrowUp' && onPrevious) { event.preventDefault(); onPrevious(); }
          if (event.key === 'ArrowDown' && onNext) { event.preventDefault(); onNext(); }
        }}
      >
        <SheetHeader className="flex-row items-center justify-between gap-3 border-b border-border px-5 py-3 pr-14 text-left">
          <div className="min-w-0">
            <SheetTitle className="text-base">Student response</SheetTitle>
            <SheetDescription className="truncate text-xs">{subtitle || 'Review without leaving the attempts list.'}</SheetDescription>
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
                className="inline-flex min-h-11 items-center gap-1.5 rounded-[var(--sat-staff-radius-control,10px)] px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sat-staff-accent,#0071e3)]"
              >
                <ExternalLink size={14} aria-hidden="true" />
                Open as page
              </Link>
            ) : null}
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-5">
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

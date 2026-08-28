import { useState, type ReactNode } from 'react';
import {
  BookOpen,
  Calculator,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flag,
  Grid2X2,
  X,
} from 'lucide-react';

export interface SatExamShellProps {
  sectionLabel: string;
  moduleTitle: string;
  remainingLabel: string;
  saveStatus: 'saving' | 'saved';
  questionIndex: number;
  questionCount: number;
  answered: ReadonlySet<string>;
  questionIds: string[];
  reviewFlags: Record<string, boolean>;
  currentQuestionId: string;
  calculatorAvailable: boolean;
  calculatorOpen: boolean;
  referenceAvailable: boolean;
  referenceOpen: boolean;
  blocked: boolean;
  children: ReactNode;
  onSelectQuestion: (index: number) => void;
  onToggleReview: () => void;
  onToggleCalculator: () => void;
  onToggleReference: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onReviewModule: () => void;
}
export function SatExamShell(props: SatExamShellProps) {
  const isFirst = props.questionIndex === 0;
  const isLast = props.questionIndex === props.questionCount - 1;
  const flagged = props.reviewFlags[props.currentQuestionId] ?? false;
  const [mobileNavigatorOpen, setMobileNavigatorOpen] = useState(false);

  return (
    <div className="grid h-[100dvh] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-[#f5f5f7] text-slate-950">
      <header className="border-b border-black/10 bg-white/95 px-4 backdrop-blur-xl sm:px-6">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{props.sectionLabel}</p>
            <h1 className="truncate text-base font-semibold tracking-tight text-slate-950">{props.moduleTitle}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-slate-500 sm:hidden">Q {props.questionIndex + 1}/{props.questionCount}</span>
            <span className={`hidden items-center gap-1.5 text-xs font-medium sm:flex ${props.saveStatus === 'saving' ? 'text-slate-500' : 'text-emerald-700'}`}>
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              {props.saveStatus === 'saving' ? 'Saving…' : 'Saved'}
            </span>
            <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm font-semibold tabular-nums text-slate-900">
              {props.remainingLabel}
            </span>
          </div>
        </div>
      </header>
      <main className="min-h-0 overflow-hidden">
        <div className="mx-auto grid h-full min-h-0 max-w-[1500px] lg:grid-cols-[minmax(0,1fr)_280px]">
          <section className="min-h-0 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
            <div className="mx-auto max-w-4xl">{props.children}</div>
          </section>
          <aside className="hidden min-h-0 overflow-y-auto border-l border-black/10 bg-white/80 p-5 lg:block">
            <div className="space-y-5">
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold tracking-tight text-slate-950">Questions</p>
                  <span className="text-xs font-medium text-slate-500">{props.questionIndex + 1} of {props.questionCount}</span>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {props.questionIds.map((id, index) => {
                    const current = index === props.questionIndex;
                    const answered = props.answered.has(id);
                    const isFlagged = props.reviewFlags[id] ?? false;
                    return (
                      <button
                        type="button"
                        key={id}
                        onClick={() => props.onSelectQuestion(index)}
                        className={`relative grid h-10 place-items-center rounded-xl border text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${current ? 'border-slate-950 bg-slate-950 text-white' : answered ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                        aria-label={`Question ${index + 1}${answered ? ', answered' : ''}${isFlagged ? ', marked for review' : ''}`}
                      >
                        {index + 1}
                        {isFlagged ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={props.onToggleReview}
                  className={`flex h-11 w-full items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${flagged ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                >
                  <Flag className="h-4 w-4" aria-hidden="true" />
                  {flagged ? 'Marked for review' : 'Mark for review'}
                </button>
                {props.calculatorAvailable ? (
                  <button type="button" onClick={props.onToggleCalculator} className="flex h-11 w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                    <Calculator className="h-4 w-4" aria-hidden="true" />
                    {props.calculatorOpen ? 'Hide calculator' : 'Calculator'}
                  </button>
                ) : null}
                {props.referenceAvailable ? (
                  <button type="button" onClick={props.onToggleReference} className="flex h-11 w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                    <BookOpen className="h-4 w-4" aria-hidden="true" />
                    {props.referenceOpen ? 'Hide reference sheet' : 'Reference sheet'}
                  </button>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      </main>
      <footer className="border-t border-black/10 bg-white px-3 py-2.5 sm:px-6">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-3">
          <button
            type="button"
            onClick={props.onPrevious}
            disabled={isFirst || props.blocked}
            className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Previous</span>
          </button>
          <div className="flex min-w-0 items-center gap-1.5">
            <button type="button" onClick={props.onToggleReview} className={`lg:hidden grid h-11 w-11 place-items-center rounded-xl border ${flagged ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-slate-200 text-slate-700'}`} aria-label={flagged ? 'Remove review mark' : 'Mark for review'}>
              <Flag className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setMobileNavigatorOpen(true)} className="lg:hidden grid h-11 w-11 place-items-center rounded-xl border border-slate-200 text-slate-700" aria-label={`Open question navigator. Question ${props.questionIndex + 1} of ${props.questionCount}`}>
              <Grid2X2 className="h-4 w-4" aria-hidden="true" />
            </button>
            {props.calculatorAvailable ? (
              <button type="button" onClick={props.onToggleCalculator} className="lg:hidden grid h-11 w-11 place-items-center rounded-xl border border-slate-200 text-slate-700" aria-label={props.calculatorOpen ? 'Hide calculator' : 'Open calculator'}>
                <Calculator className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
            <span className="hidden text-xs font-semibold text-slate-500 lg:inline">Question {props.questionIndex + 1} of {props.questionCount}</span>
          </div>
          {isLast ? (
            <button type="button" onClick={props.onReviewModule} disabled={props.blocked} className="h-11 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
              Review module
            </button>
          ) : (
            <button type="button" onClick={props.onNext} disabled={props.blocked} className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </footer>
      {mobileNavigatorOpen ? (
        <div className="fixed inset-0 z-[65] bg-slate-950/25 backdrop-blur-[2px] lg:hidden" role="dialog" aria-modal="true" aria-label="Question navigator">
          <div className="absolute inset-x-0 bottom-0 max-h-[78dvh] overflow-y-auto rounded-t-[24px] bg-white p-5 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <div><p className="text-base font-semibold tracking-tight text-slate-950">Questions</p><p className="mt-0.5 text-xs text-slate-500">{props.answered.size} answered · {props.questionCount - props.answered.size} unanswered</p></div>
              <button type="button" onClick={() => setMobileNavigatorOpen(false)} className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-600" aria-label="Close question navigator"><X className="h-4 w-4" /></button>
            </div>
            <div className="grid grid-cols-5 gap-2 sm:grid-cols-8">
              {props.questionIds.map((id, index) => <button type="button" key={id} onClick={() => { props.onSelectQuestion(index); setMobileNavigatorOpen(false); }} className={`relative h-12 rounded-xl border text-sm font-semibold ${index === props.questionIndex ? 'border-slate-950 bg-slate-950 text-white' : props.answered.has(id) ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-700'}`}>{index + 1}{props.reviewFlags[id] ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" /> : null}</button>)}
            </div>
            {props.referenceAvailable ? <button type="button" onClick={() => { setMobileNavigatorOpen(false); props.onToggleReference(); }} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700"><BookOpen className="h-4 w-4" />Reference sheet</button> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

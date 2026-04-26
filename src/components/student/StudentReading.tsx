import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ExamState, QuestionAnswer } from '../../types';
import { QuestionRenderer } from './QuestionRenderer';
import { ArrowLeft, ArrowRight, ArrowLeftRight, Flag } from 'lucide-react';
import { getBlockQuestionCount } from '../../utils/examUtils';
import { getQuestionStartNumber, getStudentQuestionsForModule } from '../../services/examAdapterService';
import { prefersReducedMotion } from './prefersReducedMotion';
import { FormattedText } from './FormattedText';
import { RichTextHighlighter } from './RichTextHighlighter';
import type { StudentHighlightColor } from './highlightPalette';

interface StudentReadingProps {
  state: ExamState;
  answers: Record<string, QuestionAnswer>;
  onAnswerChange: (questionId: string, answer: QuestionAnswer) => void;
  currentQuestionId: string | null;
  onNavigate: (id: string) => void;
  flags?: Record<string, boolean>;
  onToggleFlag?: (id: string) => void;
  highlightEnabled?: boolean | undefined;
  highlightColor?: StudentHighlightColor | undefined;
  highlightClassName?: string | undefined;
}

export function StudentReading({
  state,
  answers,
  onAnswerChange,
  currentQuestionId,
  onNavigate,
  flags = {},
  onToggleFlag,
  highlightEnabled = false,
  highlightColor,
  highlightClassName,
}: StudentReadingProps) {
  const [leftWidth, setLeftWidth] = useState(50);
  const questionContainerRef = useRef<HTMLDivElement>(null);
  const allQuestions = useMemo(() => getStudentQuestionsForModule(state, 'reading'), [state]);
  const currentQ = allQuestions.find((question) => question.id === currentQuestionId) || allQuestions[0];
  const activePassageId = currentQ?.groupId || state.reading.passages[0]?.id;
  const activePassage =
    state.reading.passages.find((passage) => passage.id === activePassageId) || state.reading.passages[0];
  const passageHasHtml = useMemo(
    () => /<\/?[a-z][\s\S]*>/i.test(activePassage?.content ?? ''),
    [activePassage?.content],
  );
  const currentIndex = allQuestions.findIndex((question) => question.id === currentQuestionId);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < allQuestions.length - 1;
  const previousQuestion = hasPrev ? allQuestions[currentIndex - 1] : undefined;
  const nextQuestion = hasNext ? allQuestions[currentIndex + 1] : undefined;
  const splitPaneStyle = useMemo(
    () =>
      ({
        ['--reading-pane-width' as string]: `${leftWidth}%`,
        ['--question-pane-width' as string]: `calc(${100 - leftWidth}% - 16px)`,
      }) as React.CSSProperties,
    [leftWidth],
  );
  
  // Auto-scroll to current question when it changes
  useEffect(() => {
    if (currentQuestionId && questionContainerRef.current) {
      const element = document.getElementById(`question-${currentQuestionId}`);
      if (element) {
        element.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      }
    }
  }, [currentQuestionId]);
  
  const handleDrag = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      const firstTouch = 'touches' in e ? e.touches[0] : undefined;
      if ('touches' in e && !firstTouch) {
        return;
      }
      const clientX = firstTouch ? firstTouch.clientX : (e as MouseEvent).clientX;
      const newWidth = (clientX / window.innerWidth) * 100;
      if (newWidth > 30 && newWidth < 70) {
        setLeftWidth(newWidth);
      }
    };
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleMouseMove);
      document.removeEventListener('touchend', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('touchmove', handleMouseMove);
      document.addEventListener('touchend', handleMouseUp);
    };

  const setClampedLeftWidth = (nextWidth: number) => {
    setLeftWidth(Math.max(30, Math.min(70, nextWidth)));
  };

  const handleSeparatorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setClampedLeftWidth(leftWidth - 5);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setClampedLeftWidth(leftWidth + 5);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setClampedLeftWidth(30);
    } else if (event.key === 'End') {
      event.preventDefault();
      setClampedLeftWidth(70);
    }
  };

  if (!activePassage) {
    return null;
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-white">
      <div
        data-testid="reading-split-pane"
        className="student-adaptive-workspace relative flex flex-1 overflow-hidden border-t border-gray-300"
        style={splitPaneStyle}
      >
        <div
          data-testid="reading-passage-pane"
          className="student-reading-passage-pane min-h-0 min-w-0 w-full overflow-y-auto p-4 pr-4 font-sans text-sm leading-relaxed text-gray-900 md:p-6 md:pr-6 md:text-base lg:p-8 lg:pr-12"
          data-student-zoom-scroll
        >
          <h2 className="text-lg md:text-xl font-bold mb-4 md:mb-6">{activePassage.title}</h2>
          <div className="leading-relaxed text-gray-900 space-y-4 [&_h1]:text-2xl [&_h1]:font-black [&_h2]:text-xl [&_h2]:font-bold [&_h3]:text-lg [&_h3]:font-bold [&_img]:max-w-full [&_img]:rounded-2xl [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6">
            <RichTextHighlighter
              content={activePassage.content}
              contentType={passageHasHtml ? 'html' : 'text'}
              enabled={highlightEnabled}
              className="whitespace-pre-wrap"
              highlightColor={highlightColor}
              highlightClassName={highlightClassName}
            />
            {(activePassage.images ?? []).map((image) => (
              <div key={image.id} className="relative rounded-2xl overflow-hidden border border-gray-200 bg-gray-50">
                <img src={image.src} alt={image.alt} className="w-full object-contain" loading="lazy" />
                {image.annotations.map((annotation) => (
                  <span
                    key={annotation.id}
                    className="absolute"
                    style={{
                      left: `${annotation.x}%`,
                      top: `${annotation.y}%`,
                      width: annotation.width ? `${annotation.width}%` : undefined,
                      height: annotation.height ? `${annotation.height}%` : undefined,
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    {annotation.type === 'hotspot' && (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white">•</span>
                    )}
                    {annotation.type === 'text' && (
                      <span className="rounded-lg bg-white/90 px-2 py-1 text-[11px] font-semibold text-gray-800 border border-gray-200">
                        {annotation.text}
                      </span>
                    )}
                    {annotation.type === 'box' && (
                      <span className="block h-full w-full rounded-lg border-2 border-blue-600 bg-blue-100/10" />
                    )}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- ARIA separator pattern requires keyboard handlers. */}
        <div
          onMouseDown={handleDrag}
          onTouchStart={handleDrag}
          onKeyDown={handleSeparatorKeyDown}
          className="student-pane-separator w-4 bg-gray-400 relative items-center justify-center cursor-col-resize flex-shrink-0 hover:bg-gray-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          role="separator"
          aria-label="Resize reading and questions panes"
          aria-orientation="vertical"
          aria-valuemin={30}
          aria-valuemax={70}
          aria-valuenow={Math.round(leftWidth)}
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- ARIA separator pattern requires tab focus.
          tabIndex={0}
        >
          <div className="w-8 h-8 bg-white border border-gray-400 flex items-center justify-center absolute z-10 shadow-sm pointer-events-none">
            <ArrowLeftRight size={14} className="text-gray-600" />
          </div>
        </div>

        <div
          data-testid="reading-question-pane"
          className="student-reading-question-pane relative flex min-h-0 min-w-0 w-full flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 pb-20 md:pb-24 space-y-8 md:space-y-10" ref={questionContainerRef} data-student-zoom-scroll>
            {activePassage.blocks.map((block) => {
              const blockQuestions = allQuestions.filter((question) => question.blockId === block.id);
              const singleBlockQuestion = blockQuestions.length === 1 ? blockQuestions[0] : undefined;
              let blockStartQ = 1;
              for (const p of state.reading.passages) {
                for (const b of p.blocks) {
                  if (b.id === block.id) break;
                  blockStartQ += getBlockQuestionCount(b);
                }
                if (p.blocks.some(b => b.id === block.id)) break;
              }
              const blockEndQ = blockStartQ + getBlockQuestionCount(block) - 1;

              return (
                <div key={block.id} className="space-y-4 md:space-y-6 mb-4 md:mb-6">
                  <div className="mb-3 md:mb-4">
                    <h3 className="font-bold text-gray-900 mb-1 md:mb-2 text-base md:text-lg">
                      Questions {blockStartQ}–{blockEndQ}
                    </h3>
                    <FormattedText
                      as="p"
                      className="text-gray-900 text-sm md:text-base"
                      text={block.instruction}
                      highlightEnabled={highlightEnabled}
                    />
                  </div>
                  
                  <div className="space-y-8 md:space-y-10">
                    {('questions' in block) ? (
                      block.questions.map((q, qIdx) => {
                        const questionEntries = blockQuestions.filter((entry) => entry.question?.id === q.id);
                        const firstEntry = questionEntries[0];
                        const globalIdx =
                          (firstEntry ? getQuestionStartNumber(allQuestions, firstEntry.id) : null) ??
                          blockStartQ + qIdx;
                        const isActive = questionEntries.some((entry) => entry.id === currentQuestionId);
                        const inlineFlags = block.type === 'SENTENCE_COMPLETION' || block.type === 'NOTE_COMPLETION';
                        const flagId = firstEntry?.id;
                        const answerKey = firstEntry?.answerKey ?? q.id;

                        return (
                          <div
                            key={q.id}
                            id={!inlineFlags && flagId ? `question-${flagId}` : undefined}
                            className={
                              onToggleFlag && flagId && !inlineFlags
                                ? 'grid grid-cols-[minmax(0,1fr)_44px] items-start gap-3'
                                : 'relative'
                            }
                          >
                            <QuestionRenderer
                              question={q}
                              block={block}
                              number={globalIdx}
                              answer={answers[answerKey]}
                              onChange={(val) => onAnswerChange(answerKey, val)}
                              isFlagged={flagId ? Boolean(flags[flagId]) : false}
                              isActive={isActive}
                              slotIds={questionEntries.map((entry) => entry.id)}
                              currentQuestionId={currentQuestionId}
                              flags={flags}
                              onToggleFlag={onToggleFlag}
                              highlightEnabled={highlightEnabled}
                              highlightColor={highlightColor}
                            />
                            {onToggleFlag && flagId && !inlineFlags ? (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onToggleFlag(flagId); }}
                                className={`min-h-11 min-w-11 rounded-full flex items-center justify-center transition-all shadow-sm ${
                                  flags[flagId] ? 'bg-amber-700 text-white' : 'bg-white border border-gray-300 text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                                }`}
                                aria-label={flags[flagId] ? 'Unflag question' : 'Flag question'}
                                title={flags[flagId] ? 'Unflag question' : 'Flag question'}
                              >
                                <Flag size={14} className={flags[flagId] ? 'fill-current' : ''} />
                              </button>
                            ) : null}
                          </div>
                        );
                      })
                    ) : (
                      <div
                        key={block.id}
                        id={singleBlockQuestion ? `question-${singleBlockQuestion.id}` : undefined}
                        className={
                          onToggleFlag && singleBlockQuestion
                            ? 'grid grid-cols-[minmax(0,1fr)_44px] items-start gap-3'
                            : 'relative'
                        }
                      >
                        <QuestionRenderer
                          question={null}
                          block={block}
                          number={(singleBlockQuestion ? getQuestionStartNumber(allQuestions, singleBlockQuestion.id) : null) ?? blockStartQ}
                          answer={answers[singleBlockQuestion?.answerKey ?? block.id]}
                          onChange={(val) => onAnswerChange(singleBlockQuestion?.answerKey ?? block.id, val)}
                          isFlagged={singleBlockQuestion ? Boolean(flags[singleBlockQuestion.id]) : false}
                          isActive={blockQuestions.some((entry) => entry.id === currentQuestionId)}
                          slotIds={blockQuestions.map((entry) => entry.id)}
                          currentQuestionId={currentQuestionId}
                          flags={flags}
                          onToggleFlag={onToggleFlag}
                          highlightEnabled={highlightEnabled}
                          highlightColor={highlightColor}
                        />
                        {onToggleFlag && singleBlockQuestion ? (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onToggleFlag(singleBlockQuestion.id); }}
                            className={`min-h-11 min-w-11 rounded-full flex items-center justify-center transition-all shadow-sm ${
                              flags[singleBlockQuestion.id] ? 'bg-amber-700 text-white' : 'bg-white border border-gray-300 text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                            }`}
                            aria-label={flags[singleBlockQuestion.id] ? 'Unflag question' : 'Flag question'}
                            title={flags[singleBlockQuestion.id] ? 'Unflag question' : 'Flag question'}
                          >
                            <Flag size={14} className={flags[singleBlockQuestion.id] ? 'fill-current' : ''} />
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="student-question-stepper absolute right-4 md:right-6 flex shadow-md z-20">
            <button 
              onClick={() => previousQuestion && onNavigate(previousQuestion.id)}
              aria-label="Previous question"
              className={`min-h-11 min-w-11 lg:w-12 lg:h-12 flex items-center justify-center transition-colors ${hasPrev ? 'bg-gray-200 hover:bg-gray-300 text-white' : 'bg-gray-100 text-gray-300 cursor-not-allowed'}`}
            >
              <ArrowLeft size={16} strokeWidth={3} />
            </button>
            <button 
              onClick={() => nextQuestion && onNavigate(nextQuestion.id)}
              aria-label="Next question"
              className={`min-h-11 min-w-11 lg:w-12 lg:h-12 flex items-center justify-center transition-colors ${hasNext ? 'bg-black hover:bg-gray-800 text-white' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}
            >
              <ArrowRight size={16} strokeWidth={3} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

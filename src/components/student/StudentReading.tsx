import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ExamState, QuestionAnswer } from '../../types';
import { QuestionRenderer } from './QuestionRenderer';
import { ArrowLeft, ArrowRight, ArrowLeftRight, ChevronDown, ChevronUp, Flag } from 'lucide-react';
import { getBlockQuestionCount } from '../../utils/examUtils';
import { getQuestionStartNumber, getStudentQuestionsForModule } from '../../services/examAdapterService';
import { prefersReducedMotion } from './prefersReducedMotion';
import { FormattedText } from './FormattedText';
import { RichTextHighlighter } from './RichTextHighlighter';
import { StudentZoomableMedia } from './StudentZoomableMedia';
import type { StudentHighlightColor } from './highlightPalette';
import type { StimulusAnnotation } from '../../types';
import { formatQuestionRange } from './questionRangeLabel';
import { useSplitPaneResize } from './useSplitPaneResize';

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
  tabletMode?: boolean | undefined;
  contentZoom?: number | undefined;
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
  tabletMode = false,
  contentZoom = 1,
}: StudentReadingProps) {
  const isTabletMode = Boolean(tabletMode);
  const clampedContentZoom = Math.min(1.5, Math.max(0.85, contentZoom));
  const supportsCssZoom = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('zoom', '1.01');
  const tabletContentZoomStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!isTabletMode || clampedContentZoom === 1) {
      return undefined;
    }

    if (supportsCssZoom) {
      return { zoom: clampedContentZoom };
    }

    const inverseZoom = 1 / clampedContentZoom;
    return {
      transform: `scale(${clampedContentZoom})`,
      transformOrigin: 'top left',
      width: `${inverseZoom * 100}%`,
      minHeight: `${inverseZoom * 100}%`,
    };
  }, [clampedContentZoom, isTabletMode, supportsCssZoom]);
  const [collapsedInstructions, setCollapsedInstructions] = useState<Record<string, boolean>>({});
  const questionContainerRef = useRef<HTMLDivElement>(null);
  const { answerCompact, handleDrag, leftWidth, materialCompact, splitPaneStyle, workspaceRef } = useSplitPaneResize({
    isTabletMode,
    materialPaneWidthProperty: '--reading-pane-width',
    dividerMode: isTabletMode ? 'overlay' : 'consumes-space',
  });
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
  const renderBlockInstruction = (blockId: string, instruction: string) => {
    const isLong = instruction.trim().length > 140;
    const isCollapsed = isLong && collapsedInstructions[blockId] !== false;

    return (
      <div className={`rounded-lg border border-gray-200 bg-gray-50 ${answerCompact ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
        <div className="flex items-start justify-between gap-3">
          <FormattedText
            as="p"
            className={`${answerCompact ? 'text-xs md:text-sm' : 'text-sm md:text-base'} leading-relaxed text-gray-800 break-words [overflow-wrap:anywhere] ${isCollapsed ? 'line-clamp-2' : ''}`}
            text={instruction}
            highlightEnabled={highlightEnabled}
            highlightColor={highlightColor}
          />
          {isLong ? (
            <button
              type="button"
              onClick={() =>
                setCollapsedInstructions((prev) => ({
                  ...prev,
                  [blockId]: !isCollapsed,
                }))
              }
              className={`inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white ${answerCompact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs'} font-semibold text-gray-600 shadow-sm`}
              aria-expanded={!isCollapsed}
            >
              {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
              {isCollapsed ? 'Show' : 'Hide'}
            </button>
          ) : null}
        </div>
      </div>
    );
  };

  const renderPassageImageAnnotations = (annotations: StimulusAnnotation[], zoom = 1) => (
    <>
      {annotations.map((annotation) => {
        const positionStyle: React.CSSProperties = {
          left: `${annotation.x}%`,
          top: `${annotation.y}%`,
          transform: 'translate(-50%, -50%)',
        };

        if (annotation.width) {
          positionStyle.width = `${annotation.width}%`;
        }

        if (annotation.height) {
          positionStyle.height = `${annotation.height}%`;
        }

        if (annotation.type === 'hotspot') {
          return (
            <span
              key={annotation.id}
              className="absolute flex items-center justify-center rounded-full bg-red-600 text-white"
              style={{
                ...positionStyle,
                width: `${Math.max(16, 20 * zoom)}px`,
                height: `${Math.max(16, 20 * zoom)}px`,
                fontSize: `${Math.max(10, 12 * zoom)}px`,
              }}
            >
              •
            </span>
          );
        }

        if (annotation.type === 'text') {
          return (
            <span
              key={annotation.id}
              className="absolute rounded-lg bg-white/90 px-2 py-1 font-semibold text-gray-800 border border-gray-200 shadow-sm"
              style={{
                ...positionStyle,
                fontSize: `calc(var(--student-meta-font-size) * ${Math.max(1, zoom)})`,
              }}
            >
              {annotation.text}
            </span>
          );
        }

        if (annotation.type === 'box') {
          return (
            <span
              key={annotation.id}
              className="absolute block rounded-lg border-2 border-blue-600 bg-blue-100/10"
              style={{
                ...positionStyle,
                borderWidth: `${Math.max(2, 2 * zoom)}px`,
              }}
            />
          );
        }

        return null;
      })}
    </>
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
  
  if (!activePassage) {
    return null;
  }

  return (
    <div className="flex flex-col h-full w-full bg-white">
      <div
        className={`relative flex flex-1 overflow-hidden border-t border-gray-300 ${
          isTabletMode ? 'flex-row' : 'flex-col md:flex-row'
        }`}
        ref={workspaceRef}
        style={splitPaneStyle}
        data-testid="reading-split-workspace"
      >
        <div
          className={`h-full overflow-y-auto font-sans text-gray-900 ${
            materialCompact ? 'p-2 pr-2 md:p-3 md:pr-3' : 'p-4 pr-4 md:p-6 md:pr-6'
          } ${
            isTabletMode ? 'w-[var(--reading-pane-width)] min-w-[48px] border-r border-gray-200' : 'lg:w-[var(--reading-pane-width)] lg:min-w-[300px] lg:p-8 lg:pr-12'
          }`}
          style={{
            ...(tabletContentZoomStyle ?? {}),
            fontSize: 'var(--student-passage-font-size)',
            lineHeight: 'var(--student-passage-line-height)',
          }}
          data-student-zoom-scroll
        >
          <h2 className={`${materialCompact ? 'mb-2' : 'mb-4 md:mb-6'} font-bold leading-tight text-gray-950 break-words [overflow-wrap:anywhere]`} style={{ fontSize: 'var(--student-passage-title-font-size)' }}>
            {activePassage.title}
          </h2>
          <div className={`${materialCompact ? 'space-y-3' : 'space-y-5'} break-words [overflow-wrap:anywhere] text-gray-900 [&_h1]:font-black [&_h1]:leading-tight [&_h1]:[font-size:var(--student-passage-h1-font-size)] [&_h2]:font-bold [&_h2]:leading-tight [&_h2]:[font-size:var(--student-passage-h2-font-size)] [&_h3]:font-bold [&_h3]:leading-snug [&_h3]:[font-size:var(--student-passage-h3-font-size)] [&_img]:max-w-full [&_img]:rounded-2xl [&_li]:mb-2 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-7 [&_p]:my-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-7`}>
            <RichTextHighlighter
              content={activePassage.content}
              contentType={passageHasHtml ? 'html' : 'text'}
              enabled={highlightEnabled}
              className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
              highlightColor={highlightColor}
              highlightClassName={highlightClassName}
            />
            {(activePassage.images ?? []).map((image) => (
              <div key={image.id} className={isTabletMode ? '' : 'lg:sticky lg:top-0 lg:z-10 lg:bg-white lg:py-2'}>
                <StudentZoomableMedia
                  sources={[image.src]}
                  alt={image.alt}
                  label={image.alt || 'Passage image'}
                  hint="Tap to zoom the passage image"
                  className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50"
                  renderOverlay={(zoom) => renderPassageImageAnnotations(image.annotations, zoom)}
                />
              </div>
            ))}
          </div>
        </div>

        <div 
          onMouseDown={handleDrag}
          onTouchStart={handleDrag}
          className={`${isTabletMode ? 'absolute inset-y-0 z-20 flex w-11 items-center justify-center' : 'hidden w-4 lg:flex relative items-center justify-center flex-shrink-0'} bg-gray-400 cursor-col-resize touch-none hover:bg-gray-600 transition-colors`}
          style={isTabletMode ? { left: `calc(${leftWidth}% - 22px)` } : undefined}
          role="separator"
          aria-label="Resize reading passage and answer panels"
          aria-orientation="vertical"
          data-testid="reading-pane-resizer"
        >
          <div className={`${isTabletMode ? 'h-[5.5rem] w-14' : 'h-10 w-8'} bg-white border border-gray-400 flex items-center justify-center absolute z-10 shadow-sm pointer-events-none`}>
            <ArrowLeftRight size={isTabletMode ? 22 : 14} className="text-gray-600" />
          </div>
        </div>

        <div className={`relative flex h-full min-w-0 flex-col min-h-0 ${isTabletMode ? 'w-[var(--question-pane-width)] min-w-[48px]' : 'w-full md:min-w-[320px] lg:w-[var(--question-pane-width)]'}`}>
          <div
            className={`flex-1 overflow-y-auto break-words [overflow-wrap:anywhere] ${
              answerCompact ? 'p-2.5 md:p-3 space-y-4 md:space-y-5' : 'p-4 md:p-5 lg:p-8 space-y-6 md:space-y-8'
            } pb-20 md:pb-24 ${
              isTabletMode ? 'pb-28 md:pb-28' : ''
            }`}
            ref={questionContainerRef}
            data-student-zoom-scroll
            data-testid="reading-question-scroll"
            style={tabletContentZoomStyle}
          >
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
                <div key={block.id} className={`${answerCompact ? 'space-y-3 mb-3 md:mb-4' : 'space-y-4 md:space-y-6 mb-4 md:mb-6'}`}>
                  <div className={answerCompact ? 'mb-2' : 'mb-3 md:mb-4'}>
                    <h3 className={`font-bold text-gray-900 break-words [overflow-wrap:anywhere] ${answerCompact ? 'mb-1 text-sm md:text-base' : 'mb-1 md:mb-2 text-base md:text-lg'}`}>
                      Questions {formatQuestionRange(blockStartQ, blockEndQ)}
                    </h3>
                    {renderBlockInstruction(block.id, block.instruction)}
                  </div>
                  
                  <div className={answerCompact ? 'space-y-5' : 'space-y-8 md:space-y-10'}>
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
                            className={`relative ${isTabletMode ? 'space-y-2' : ''}`}
                          >
                            {isTabletMode && onToggleFlag && flagId && !inlineFlags ? (
                              <div className="flex justify-end">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onToggleFlag(flagId);
                                  }}
                                  className={`inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-sm transition-all ${
                                    flags[flagId]
                                      ? 'bg-amber-700 text-white border-amber-700'
                                      : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                                  }`}
                                  title={flags[flagId] ? 'Unflag question' : 'Flag question'}
                                >
                                  <Flag size={14} className={flags[flagId] ? 'fill-current' : ''} />
                                </button>
                              </div>
                            ) : null}
                            {!isTabletMode && onToggleFlag && flagId && !inlineFlags ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); onToggleFlag(flagId); }}
                                className={`absolute top-0 right-0 w-8 h-8 rounded-full flex items-center justify-center transition-all z-10 shadow-sm ${
                                  flags[flagId] ? 'bg-amber-700 text-white' : 'bg-white border border-gray-300 text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                                }`}
                                title={flags[flagId] ? 'Unflag question' : 'Flag question'}
                              >
                                <Flag size={14} className={flags[flagId] ? 'fill-current' : ''} />
                              </button>
                            ) : null}
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
                              tabletMode={isTabletMode}
                              compactPane={answerCompact}
                              highlightEnabled={highlightEnabled}
                              highlightColor={highlightColor}
                            />
                          </div>
                        );
                      })
                    ) : (
                      <div
                        key={block.id}
                        id={singleBlockQuestion ? `question-${singleBlockQuestion.id}` : undefined}
                        className="relative"
                      >
                        {isTabletMode && onToggleFlag && singleBlockQuestion ? (
                          <div className="mb-2 flex justify-end">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleFlag(singleBlockQuestion.id);
                              }}
                              className={`inline-flex h-8 w-8 items-center justify-center rounded-full border shadow-sm transition-all ${
                                flags[singleBlockQuestion.id]
                                  ? 'bg-amber-700 text-white border-amber-700'
                                  : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700'
                              }`}
                              title={flags[singleBlockQuestion.id] ? 'Unflag question' : 'Flag question'}
                            >
                              <Flag size={14} className={flags[singleBlockQuestion.id] ? 'fill-current' : ''} />
                            </button>
                          </div>
                        ) : null}
                        {!isTabletMode && onToggleFlag && singleBlockQuestion ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); onToggleFlag(singleBlockQuestion.id); }}
                            className={`absolute top-0 right-0 w-8 h-8 rounded-full flex items-center justify-center transition-all z-10 shadow-sm ${
                              flags[singleBlockQuestion.id] ? 'bg-amber-700 text-white' : 'bg-white border border-gray-300 text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                            }`}
                            title={flags[singleBlockQuestion.id] ? 'Unflag question' : 'Flag question'}
                          >
                            <Flag size={14} className={flags[singleBlockQuestion.id] ? 'fill-current' : ''} />
                          </button>
                        ) : null}
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
                          tabletMode={isTabletMode}
                          compactPane={answerCompact}
                          highlightEnabled={highlightEnabled}
                          highlightColor={highlightColor}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className={`absolute ${isTabletMode ? 'bottom-4 right-4' : 'bottom-16 md:bottom-20 right-4 md:right-6'} flex shadow-md z-20`}>
            <button 
              onClick={() => previousQuestion && onNavigate(previousQuestion.id)}
              className={`w-10 h-10 md:w-11 md:h-11 lg:w-12 lg:h-12 flex items-center justify-center transition-colors ${hasPrev ? 'bg-gray-200 hover:bg-gray-300 text-white' : 'bg-gray-100 text-gray-300 cursor-not-allowed'}`}
            >
              <ArrowLeft size={16} strokeWidth={3} />
            </button>
            <button 
              onClick={() => nextQuestion && onNavigate(nextQuestion.id)}
              className={`w-10 h-10 md:w-11 md:h-11 lg:w-12 lg:h-12 flex items-center justify-center transition-colors ${hasNext ? 'bg-black hover:bg-gray-800 text-white' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}
            >
              <ArrowRight size={16} strokeWidth={3} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

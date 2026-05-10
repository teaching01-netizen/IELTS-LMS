import React, { useEffect, useRef, useMemo } from 'react';
import { ExamState, QuestionAnswer } from '../../types';
import type { StudentAnswerMutationMeta } from '../../types/studentAttempt';
import { ArrowLeftRight } from 'lucide-react';
import { getBlockQuestionCount } from '../../utils/examUtils';
import { getStudentQuestionsForModule } from '../../services/examAdapterService';
import { prefersReducedMotion } from './prefersReducedMotion';
import { FormattedText } from './FormattedText';
import { RichTextHighlighter } from './RichTextHighlighter';
import { StudentZoomableMedia } from './StudentZoomableMedia';
import type { StudentHighlightColor } from './highlightPalette';
import type { StimulusAnnotation } from '../../types';
import { useSplitPaneResize } from './useSplitPaneResize';
import {
  hasHtmlMarkup,
  normalizeReadingContentForHighlightedFormattedText,
  normalizeReadingPlainTextForDisplay,
} from './normalizeReadingPassageText';
import { isInstructionReferencePlacement } from '../../utils/referenceImagePlacement';
import { StudentQuestionPanel } from './StudentQuestionPanel';

interface StudentReadingProps {
  state: ExamState;
  answers: Record<string, QuestionAnswer>;
  onAnswerChange: (
    questionId: string,
    answer: QuestionAnswer,
    meta?: StudentAnswerMutationMeta,
  ) => void;
  currentQuestionId: string | null;
  onNavigate: (id: string) => void;
  flags?: Record<string, boolean>;
  onToggleFlag?: (id: string) => void;
  highlightEnabled?: boolean | undefined;
  highlightColor?: StudentHighlightColor | undefined;
  highlightClassName?: string | undefined;
  tabletMode?: boolean | undefined;
  contentZoom?: number | undefined;
  onIncreasePassageReadability?: (() => void) | undefined;
  onDecreasePassageReadability?: (() => void) | undefined;
  onResetPassageReadability?: (() => void) | undefined;
  passageReadabilityLabel?: string | undefined;
  canIncreasePassageReadability?: boolean | undefined;
  canDecreasePassageReadability?: boolean | undefined;
  registerLiveAnswer?: ((answerKey: string, value: QuestionAnswer) => void) | undefined;
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
  onIncreasePassageReadability,
  onDecreasePassageReadability,
  onResetPassageReadability,
  passageReadabilityLabel,
  canIncreasePassageReadability,
  canDecreasePassageReadability,
  registerLiveAnswer,
}: StudentReadingProps) {
  void onIncreasePassageReadability;
  void onDecreasePassageReadability;
  void onResetPassageReadability;
  void passageReadabilityLabel;
  void canIncreasePassageReadability;
  void canDecreasePassageReadability;
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
    () => hasHtmlMarkup(activePassage?.content ?? ''),
    [activePassage?.content],
  );
  const renderedPassageContent = useMemo(() => {
    const content = activePassage?.content ?? '';
    return passageHasHtml ? content : normalizeReadingPlainTextForDisplay(content);
  }, [activePassage?.content, passageHasHtml]);
  const highlightPassageText = useMemo(
    () => normalizeReadingContentForHighlightedFormattedText(activePassage?.content ?? ''),
    [activePassage?.content],
  );
  const blockStartNumbers = useMemo(() => {
    const map = new Map<string, number>();
    let nextNumber = 1;

    for (const passage of state.reading.passages) {
      for (const block of passage.blocks) {
        map.set(block.id, nextNumber);
        nextNumber += getBlockQuestionCount(block);
      }
    }

    return map;
  }, [state.reading.passages]);
  const getBlockStartQuestionNumber = (blockId: string) => blockStartNumbers.get(blockId) ?? 1;
  const hideDiagramReferenceForBlock = (blockId: string) => {
    const block = activePassage?.blocks.find((entry) => entry.id === blockId);
    return block ? isInstructionReferencePlacement(block) : false;
  };
  const renderBlockInstruction = (instruction: string) => {
    return (
      <div className={`rounded-lg border border-gray-200 bg-gray-50 ${answerCompact ? 'px-2 py-1.5' : 'px-3 py-2'}`}>
        <FormattedText
          as="p"
          className={`${answerCompact ? 'text-xs md:text-sm' : 'text-sm md:text-base'} leading-relaxed text-gray-800 break-words [overflow-wrap:anywhere]`}
          text={instruction}
          highlightEnabled={highlightEnabled}
          highlightColor={highlightColor}
        />
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
          className={`student-reading-passage-pane h-full overflow-y-auto font-sans text-gray-900 ${
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
          <h2 className={`${materialCompact ? 'mb-2' : 'mb-4 md:mb-6'} font-bold leading-tight text-gray-950 break-words`} style={{ fontSize: 'var(--student-passage-title-font-size)' }}>
            {activePassage.title}
          </h2>
          <div className={`${materialCompact ? 'space-y-3' : 'space-y-5'} break-normal text-gray-900 [&_h1]:font-black [&_h1]:leading-tight [&_h1]:[font-size:var(--student-passage-h1-font-size)] [&_h2]:font-bold [&_h2]:leading-tight [&_h2]:[font-size:var(--student-passage-h2-font-size)] [&_h3]:font-bold [&_h3]:leading-snug [&_h3]:[font-size:var(--student-passage-h3-font-size)] [&_img]:max-w-full [&_img]:rounded-2xl [&_li]:mb-2 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-7 [&_p]:my-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-7`}>
            {highlightEnabled ? (
              <FormattedText
                as="div"
                text={highlightPassageText}
                className="whitespace-pre-wrap break-normal"
                highlightEnabled
                highlightColor={highlightColor}
                highlightClassName={highlightClassName}
                preserveInlineEmphasis
              />
            ) : (
              <RichTextHighlighter
                content={renderedPassageContent}
                contentType="html"
                enabled={false}
                className="whitespace-pre-wrap break-normal"
                highlightColor={highlightColor}
                highlightClassName={highlightClassName}
              />
            )}
            {(activePassage.images ?? []).map((image) => (
              <StudentZoomableMedia
                key={image.id}
                sources={[image.src]}
                alt={image.alt}
                label={image.alt || 'Passage image'}
                hint="Tap to zoom the passage image"
                className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50"
                renderOverlay={(zoom) => renderPassageImageAnnotations(image.annotations, zoom)}
              />
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

        <StudentQuestionPanel
          blocks={activePassage.blocks}
          allQuestions={allQuestions}
          answers={answers}
          onAnswerChange={onAnswerChange}
          currentQuestionId={currentQuestionId}
          onNavigate={onNavigate}
          flags={flags}
          onToggleFlag={onToggleFlag}
          tabletMode={isTabletMode}
          answerCompact={answerCompact}
          highlightEnabled={highlightEnabled}
          highlightColor={highlightColor}
          registerLiveAnswer={registerLiveAnswer}
          questionContainerRef={questionContainerRef}
          contentZoomStyle={tabletContentZoomStyle}
          panelTestId="reading-question-scroll"
          getBlockStartQuestionNumber={getBlockStartQuestionNumber}
          renderBlockInstruction={renderBlockInstruction}
          expandedQuestionGapClassName="space-y-8 md:space-y-10"
          hideDiagramReferenceForBlock={hideDiagramReferenceForBlock}
        />
      </div>
    </div>
  );
}

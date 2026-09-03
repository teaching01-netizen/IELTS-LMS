import React, { useCallback, useMemo, useRef } from 'react';
import type { ActScienceStimulus, ExamState, QuestionAnswer, StimulusAnnotation } from '../../types';
import { getBlockQuestionCount } from '../../utils/examUtils';
import {
  getStudentQuestionsForModule,
  type StudentQuestionDescriptor,
} from '@student/application/studentExamContentFacade';
import type { StudentAnswerMutationMeta } from '../../types/studentAttempt';
import type { StudentHighlightColor } from './highlightPalette';
import type { StudentLayoutMode } from './layout/studentLayoutMode';
import { RichTextHighlighter } from './RichTextHighlighter';
import { StudentQuestionText } from './StudentQuestionText';
import { StudentZoomableMedia } from './StudentZoomableMedia';
import { StudentMaterialWithQuestionPane } from './StudentMaterialWithQuestionPane';
import { StudentModuleEmptyState } from './StudentModuleEmptyState';
import { useSplitPaneResize } from './useSplitPaneResize';
import { hasHtmlMarkup, normalizeReadingPlainTextForDisplay } from './normalizeReadingPassageText';
import { sanitizeReadingPassageHtml } from './sanitizeReadingPassageHtml';

export interface StudentScienceProps {
  state: ExamState;
  answers: Record<string, QuestionAnswer>;
  onAnswerChange: (
    questionId: string,
    answer: QuestionAnswer,
    meta?: StudentAnswerMutationMeta,
  ) => void;
  currentQuestionId: string | null;
  onNavigate: (id: string) => void;
  flags?: Record<string, boolean> | undefined;
  onToggleFlag?: ((id: string) => void) | undefined;
  highlightEnabled?: boolean | undefined;
  highlightColor?: StudentHighlightColor | undefined;
  choiceEliminationEnabled?: boolean | undefined;
  highlightClassName?: string | undefined;
  tabletMode?: boolean | undefined;
  layoutMode?: StudentLayoutMode | undefined;
  contentZoom?: number | undefined;
  registerLiveAnswer?: ((answerKey: string, value: QuestionAnswer) => void) | undefined;
  allQuestions?: StudentQuestionDescriptor[] | undefined;
}

interface ScienceStimulusPaneProps {
  stimulus: ActScienceStimulus;
  materialCompact: boolean;
  isTabletMode: boolean;
  contentZoomStyle: React.CSSProperties | undefined;
  highlightEnabled: boolean;
  highlightColor: StudentHighlightColor | undefined;
  highlightClassName: string | undefined;
}

function renderScienceImageAnnotations(
  annotations: StimulusAnnotation[],
  zoom = 1,
): React.ReactNode {
  return annotations.map((annotation) => {
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
          className="absolute rounded-lg border border-gray-200 bg-white/90 px-2 py-1 font-semibold text-gray-800 shadow-sm"
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
  });
}

const ScienceStimulusPane = React.memo(function ScienceStimulusPane({
  stimulus,
  materialCompact,
  isTabletMode,
  contentZoomStyle,
  highlightEnabled,
  highlightColor,
  highlightClassName,
}: ScienceStimulusPaneProps) {
  const contentHasHtml = hasHtmlMarkup(stimulus.content);
  const renderedContent = contentHasHtml
    ? sanitizeReadingPassageHtml(stimulus.content)
    : normalizeReadingPlainTextForDisplay(stimulus.content);

  return (
    <div
      className={`student-science-stimulus-pane h-full overflow-y-auto font-sans text-gray-900 ${
        materialCompact ? 'p-2 md:p-3' : 'p-4 md:p-6 lg:p-8'
      } ${isTabletMode ? 'w-[var(--science-pane-width)] min-w-[48px] border-r border-gray-200' : 'lg:w-[var(--science-pane-width)] lg:min-w-[300px]'}`}
      data-student-highlightable="true"
      data-student-zoom-scroll
      style={{
        ...(contentZoomStyle ?? {}),
        fontSize: 'var(--student-passage-font-size)',
        lineHeight: 'var(--student-passage-line-height)',
        userSelect: 'text',
        WebkitUserSelect: 'text',
      }}
    >
      <h2
        className="student-passage-measure mb-4 font-bold leading-tight tracking-tight text-gray-900 break-words"
        style={{ fontSize: 'var(--student-passage-title-font-size)' }}
      >
        {stimulus.title}
      </h2>
      <div className="student-passage-measure break-normal text-gray-900 [&_h1]:font-black [&_h1]:leading-tight [&_h1]:[font-size:var(--student-passage-h1-font-size)] [&_h2]:font-bold [&_h2]:leading-tight [&_h2]:[font-size:var(--student-passage-h2-font-size)] [&_h3]:font-bold [&_h3]:leading-snug [&_h3]:[font-size:var(--student-passage-h3-font-size)] [&_img]:max-w-full [&_img]:rounded-2xl [&_li]:mb-2 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-7 [&_p]:my-[0.5em] [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-gray-300 [&_td]:p-2 [&_th]:border [&_th]:border-gray-300 [&_th]:bg-gray-50 [&_th]:p-2 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-7]">
        <RichTextHighlighter
          content={renderedContent}
          contentType="html"
          enabled={highlightEnabled}
          className="whitespace-pre-wrap break-normal"
          highlightColor={highlightColor}
          highlightClassName={highlightClassName}
          highlightSurfaceId={`science:stimulus:${stimulus.id}`}
        />
        {(stimulus.images ?? []).map((image) => (
          <StudentZoomableMedia
            key={image.id}
            sources={[image.src]}
            alt={image.alt}
            label={image.alt || 'Stimulus image'}
            hint="Tap to zoom the stimulus image"
            className="mt-4 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50"
            renderOverlay={(zoom) => renderScienceImageAnnotations(image.annotations, zoom)}
          />
        ))}
      </div>
    </div>
  );
});

export function StudentScience({
  state,
  answers,
  onAnswerChange,
  currentQuestionId,
  onNavigate,
  flags = {},
  onToggleFlag,
  highlightEnabled = false,
  highlightColor,
  choiceEliminationEnabled = false,
  highlightClassName,
  tabletMode = false,
  layoutMode = 'wide',
  contentZoom = 1,
  registerLiveAnswer,
}: StudentScienceProps) {
  const isTabletMode = Boolean(tabletMode);
  const clampedContentZoom = Math.min(1.5, Math.max(0.85, contentZoom));
  const supportsCssZoom =
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('zoom', '1.01');
  const contentZoomStyle = useMemo<React.CSSProperties | undefined>(() => {
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
  const [eliminatedOptionIdsByQuestion, setEliminatedOptionIdsByQuestion] = React.useState<
    Record<string, readonly string[]>
  >({});
  const toggleOptionElimination = useCallback((questionId: string, optionId: string) => {
    setEliminatedOptionIdsByQuestion((current) => {
      const currentOptionIds = current[questionId] ?? [];
      const nextOptionIds = currentOptionIds.includes(optionId)
        ? currentOptionIds.filter((candidate) => candidate !== optionId)
        : [...currentOptionIds, optionId];

      if (nextOptionIds.length === 0) {
        const next = { ...current };
        delete next[questionId];
        return next;
      }

      return { ...current, [questionId]: nextOptionIds };
    });
  }, []);
  const choiceEliminationAvailable = state.type === 'ACT' && choiceEliminationEnabled;
  const {
    answerCompact,
    handleDrag,
    handleKeyboardResize,
    leftWidth,
    materialCompact,
    splitPaneStyle,
    workspaceRef,
  } = useSplitPaneResize({
    isTabletMode,
    materialPaneWidthProperty: '--science-pane-width',
    dividerMode: isTabletMode ? 'overlay' : 'consumes-space',
  });
  const allQuestions = useMemo(
    () => getStudentQuestionsForModule(state, 'science'),
    [state],
  );
  const currentQuestion =
    allQuestions.find((question) => question.id === currentQuestionId) ?? allQuestions[0];
  const activeStimulusId = currentQuestion?.groupId ?? state.activeScienceStimulusId;
  const activeStimulus =
    state.science.stimuli.find((stimulus) => stimulus.id === activeStimulusId) ??
    state.science.stimuli[0];
  const blockStartNumbers = useMemo(() => {
    const map = new Map<string, number>();
    let nextNumber = 1;

    state.science.stimuli.forEach((stimulus) => {
      stimulus.blocks.forEach((block) => {
        map.set(block.id, nextNumber);
        nextNumber += getBlockQuestionCount(block);
      });
    });

    return map;
  }, [state.science.stimuli]);
  const getBlockStartQuestionNumber = useCallback(
    (blockId: string) => blockStartNumbers.get(blockId) ?? 1,
    [blockStartNumbers],
  );
  const renderBlockInstruction = useCallback(
    (instruction: string, blockId: string) => (
      <div className={`rounded-lg border border-gray-200 bg-gray-50 ${answerCompact ? 'px-3 py-2' : 'px-4 py-3'}`}>
        <StudentQuestionText
          as="p"
          className="text-gray-800 break-words [overflow-wrap:anywhere]"
          text={instruction}
          highlightEnabled={highlightEnabled}
          highlightColor={highlightColor}
          highlightSurfaceId={`question:science:${blockId}:instruction`}
        />
      </div>
    ),
    [answerCompact, highlightColor, highlightEnabled],
  );

  if (!activeStimulus) {
    return <StudentModuleEmptyState label="ACT Science" />;
  }

  return (
    <StudentMaterialWithQuestionPane
      isTabletMode={isTabletMode}
      layoutMode={layoutMode}
      workspaceRef={workspaceRef}
      splitPaneStyle={splitPaneStyle}
      leftWidth={leftWidth}
      onDividerPointerDown={handleDrag}
      onDividerKeyDown={handleKeyboardResize}
      workspaceTestId="science-split-workspace"
      dividerAriaLabel="Resize ACT Science stimulus and answer panels"
      dividerTestId="science-pane-resizer"
      materialPane={
        <ScienceStimulusPane
          key={activeStimulus.id}
          stimulus={activeStimulus}
          materialCompact={materialCompact}
          isTabletMode={isTabletMode}
          contentZoomStyle={contentZoomStyle}
          highlightEnabled={highlightEnabled}
          highlightColor={highlightColor}
          highlightClassName={highlightClassName}
        />
      }
      questionPanel={{
        blocks: activeStimulus.blocks,
        allQuestions,
        answers,
        onAnswerChange,
        currentQuestionId,
        onNavigate,
        flags,
        onToggleFlag,
        answerCompact,
        highlightEnabled,
        highlightColor,
        registerLiveAnswer,
        questionContainerRef,
        contentZoomStyle,
        panelTestId: 'science-question-scroll',
        getBlockStartQuestionNumber,
        renderBlockInstruction,
        expandedQuestionGapClassName: 'space-y-8 md:space-y-10',
        eliminatedOptionIdsByQuestion: choiceEliminationAvailable
          ? eliminatedOptionIdsByQuestion
          : undefined,
        onToggleOptionElimination: choiceEliminationAvailable
          ? toggleOptionElimination
          : undefined,
      }}
    />
  );
}

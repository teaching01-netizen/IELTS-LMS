import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { advanceImageSourceCandidate, getImageUrlCandidates } from '../../utils/imageUrl';
import { tryBuildAttemptAuthorizationHeader } from '@student/api/studentAttemptGateway';

export interface ActStudentMediaAuthorization {
  scheduleId: string;
  attemptId: string;
}

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
  /** S1-C3: sessionStorage base key (per exam). Module suffix is appended. */
  persistenceKeyBase?: string | undefined;
  actMediaAuthorization?: ActStudentMediaAuthorization | undefined;
}

interface ScienceStimulusPaneProps {
  stimulus: ActScienceStimulus;
  mediaAuthorization?: ActStudentMediaAuthorization | undefined;
  materialCompact: boolean;
  isTabletMode: boolean;
  contentZoomStyle: React.CSSProperties | undefined;
  highlightEnabled: boolean;
  highlightColor: StudentHighlightColor | undefined;
  highlightClassName: string | undefined;
}

function isManagedMediaContentUrl(source: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const url = new URL(source, window.location.href);
    return url.origin === window.location.origin && /^\/api\/v1\/media\/[^/]+\/content$/.test(url.pathname);
  } catch {
    return false;
  }
}

function useActAttemptMediaSources(
  stimulus: ActScienceStimulus,
  mediaAuthorization?: ActStudentMediaAuthorization,
): ReadonlyMap<string, string> {
  const scheduleId = mediaAuthorization?.scheduleId;
  const attemptId = mediaAuthorization?.attemptId;
  const managedSources = useMemo(() => {
    const sources = new Set<string>();
    if (typeof DOMParser !== 'undefined') {
      const document = new DOMParser().parseFromString(stimulus.content, 'text/html');
      document.querySelectorAll('img[src]').forEach((image) => {
        const source = image.getAttribute('src')?.trim();
        if (source && isManagedMediaContentUrl(source)) sources.add(source);
      });
    }
    (stimulus.images ?? []).forEach((image) => {
      if (isManagedMediaContentUrl(image.src)) sources.add(image.src);
    });
    return [...sources];
  }, [stimulus.content, stimulus.images]);
  const managedSourcesKey = managedSources.join('\u0000');
  const requestKey = `${scheduleId ?? ''}\u0000${attemptId ?? ''}\u0000${managedSourcesKey}`;
  const emptySourceMap = useMemo(() => new Map<string, string>(), []);
  const [resolvedSources, setResolvedSources] = useState<{
    key: string;
    sources: ReadonlyMap<string, string>;
  } | null>(null);
  const visibleSources = resolvedSources?.key === requestKey ? resolvedSources.sources : emptySourceMap;

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];
    const authorization = scheduleId && attemptId
      ? tryBuildAttemptAuthorizationHeader(scheduleId, attemptId)
      : null;

    setResolvedSources({ key: requestKey, sources: emptySourceMap });
    if (!authorization || managedSources.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    const loadSource = async (source: string): Promise<[string, string] | null> => {
      try {
        const response = await fetch(source, {
          credentials: 'same-origin',
          headers: authorization,
          cache: 'no-store',
        });
        if (!response.ok || cancelled) return null;
        const imageBlob = await response.blob();
        if (cancelled || !imageBlob.type.toLowerCase().startsWith('image/')) return null;
        const objectUrl = URL.createObjectURL(imageBlob);
        objectUrls.push(objectUrl);
        return [source, objectUrl];
      } catch {
        return null;
      }
    };

    void Promise.all(managedSources.map(loadSource)).then((loaded) => {
      if (cancelled) return;
      setResolvedSources({
        key: requestKey,
        sources: new Map(loaded.filter((entry): entry is [string, string] => entry !== null)),
      });
    });

    return () => {
      cancelled = true;
      objectUrls.forEach((objectUrl) => URL.revokeObjectURL(objectUrl));
    };
  }, [attemptId, emptySourceMap, managedSources, requestKey, scheduleId]);

  return visibleSources;
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
  mediaAuthorization,
  materialCompact,
  isTabletMode,
  contentZoomStyle,
  highlightEnabled,
  highlightColor,
  highlightClassName,
}: ScienceStimulusPaneProps) {
  const [inlineImageToZoom, setInlineImageToZoom] = useState<{ src: string; alt: string } | null>(null);
  const contentHasHtml = hasHtmlMarkup(stimulus.content);
  const sanitizedContent = contentHasHtml
    ? sanitizeReadingPassageHtml(stimulus.content, {
        normalizeJustifiedText: true,
        normalizeLineWrapping: true,
      })
    : normalizeReadingPlainTextForDisplay(stimulus.content);
  const authenticatedImageSources = useActAttemptMediaSources(stimulus, mediaAuthorization);
  const handleInlineImageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const image = target.closest('img');
    const src = image?.getAttribute('src')?.trim();
    if (!src || !image || !event.currentTarget.contains(image)) return;
    setInlineImageToZoom({ src, alt: image.getAttribute('alt')?.trim() || 'Passage image' });
  };

  return (
    <div
      className={`student-science-stimulus-pane student-scroll-breathe h-full overflow-y-auto font-sans text-gray-900 ${
        materialCompact ? 'p-2 md:p-3' : 'p-4 md:p-6 lg:p-8'
      } ${isTabletMode ? 'w-[var(--science-pane-width)] min-w-[48px] border-r border-gray-200' : 'lg:w-[var(--science-pane-width)] lg:min-w-[300px]'}`}
      data-student-highlightable="true"
      data-student-zoom-scroll
      // `user-select` is deliberately absent: the stylesheet owns it, so the
      // exam's coarse-pointer rule can remove the platform's own selection here
      // without an inline declaration outranking it (index.css).
      style={{
        ...(contentZoomStyle ?? {}),
        fontSize: 'var(--student-passage-font-size)',
        lineHeight: 'var(--student-passage-line-height)',
      }}
    >
      <h2
        className="student-passage-measure mb-4 font-bold leading-tight tracking-tight text-gray-900 break-words"
        style={{ fontSize: 'var(--student-passage-title-font-size)' }}
      >
        {stimulus.title}
      </h2>
      <div className="student-act-passage-content student-passage-measure break-normal text-left text-gray-900 [&_h1]:font-black [&_h1]:leading-tight [&_h1]:[font-size:var(--student-passage-h1-font-size)] [&_h2]:font-bold [&_h2]:leading-tight [&_h2]:[font-size:var(--student-passage-h2-font-size)] [&_h3]:font-bold [&_h3]:leading-snug [&_h3]:[font-size:var(--student-passage-h3-font-size)] [&_img]:max-w-full [&_img]:rounded-2xl [&_li]:mb-2 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-7 [&_p]:my-[0.5em] [&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-gray-300 [&_td]:p-2 [&_th]:border [&_th]:border-gray-300 [&_th]:bg-gray-50 [&_th]:p-2 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-7]">
        <div
          onClick={handleInlineImageClick}
          onErrorCapture={(event) => {
            if (event.target instanceof HTMLImageElement) {
              advanceImageSourceCandidate(event.target);
            }
          }}
        >
          <RichTextHighlighter
            content={sanitizedContent}
            contentType="html"
            enabled={highlightEnabled}
            className="whitespace-normal break-normal [&_img]:cursor-zoom-in"
            highlightColor={highlightColor}
            highlightClassName={highlightClassName}
            highlightSurfaceId={`science:stimulus:${stimulus.id}`}
            imageSourceOverrides={authenticatedImageSources}
          />
        </div>
        {inlineImageToZoom ? (
          <StudentZoomableMedia
            key={`${inlineImageToZoom.src}:${inlineImageToZoom.alt}`}
            sources={getImageUrlCandidates(inlineImageToZoom.src)}
            alt={inlineImageToZoom.alt}
            label={inlineImageToZoom.alt}
            hint="Tap to zoom the passage image"
            openOnMount
            renderTrigger={false}
            onDismiss={() => setInlineImageToZoom(null)}
          />
        ) : null}
        {(stimulus.images ?? []).map((image) => (
          <div
            key={image.id}
            className="mt-4 max-w-full"
            style={{ width: `${image.displayWidthPercent ?? 100}%` }}
          >
            <StudentZoomableMedia
              sources={getImageUrlCandidates(authenticatedImageSources.get(image.src) ?? image.src ?? '')}
              alt={image.alt}
              label={image.alt || 'Stimulus image'}
              hint="Tap to zoom the stimulus image"
              className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50"
              renderOverlay={(zoom) => renderScienceImageAnnotations(image.annotations, zoom)}
            />
          </div>
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
  persistenceKeyBase,
  actMediaAuthorization,
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
    handlePointerMove,
    handlePointerEnd,
    handleKeyboardResize,
    resizeCommands,
    leftWidth,
    materialCompact,
    splitBounds,
    splittable,
    splitPaneStyle,
    workspaceRef,
  } = useSplitPaneResize({
    isTabletMode,
    materialPaneWidthProperty: '--science-pane-width',
    dividerMode: isTabletMode ? 'overlay' : 'consumes-space',
    // Keep ACT Science's passage and question panes close to the balanced
    // two-column layout in ACT test booklets, even if an old saved split was
    // dragged to the widest setting. IELTS keeps its existing resize range.
    maxMaterialRatio: isTabletMode ? undefined : 0.58,
    persistenceKey: persistenceKeyBase ? `${persistenceKeyBase}:science:split` : undefined,
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
      splitMinWidth={splitBounds.min}
      splitMaxWidth={splitBounds.max}
      splitSplittable={splittable}
      onDividerPointerDown={handleDrag}
      onDividerPointerMove={handlePointerMove}
      onDividerPointerEnd={handlePointerEnd}
      onDividerKeyDown={handleKeyboardResize}
      resizeCommands={resizeCommands}
      workspaceTestId="science-split-workspace"
      dividerAriaLabel="Resize ACT Science stimulus and answer panels"
      dividerTestId="science-pane-resizer"
      persistenceKey={persistenceKeyBase ? `${persistenceKeyBase}:science:tab` : undefined}
      materialPane={
        <ScienceStimulusPane
          key={activeStimulus.id}
          stimulus={activeStimulus}
          mediaAuthorization={actMediaAuthorization}
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
        showOnlyCurrentQuestion: true,
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

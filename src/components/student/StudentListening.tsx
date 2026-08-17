import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { DiagramLabelingBlock, ExamState, QuestionAnswer } from "../../types";
import { Play, Pause, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { getBlockQuestionCount } from "../../utils/examUtils";
import { getStudentQuestionsForModule } from "@student/application/studentExamContentFacade";
import { RichTextHighlighter } from "./RichTextHighlighter";
import { StudentQuestionText } from "./StudentQuestionText";
import { StudentZoomableMedia } from "./StudentZoomableMedia";
import type { StudentHighlightColor } from "./highlightPalette";
import { getImageUrlCandidates } from "../../utils/imageUrl";
import { useSplitPaneResize } from "./useSplitPaneResize";
import { isInstructionReferencePlacement } from "../../utils/referenceImagePlacement";
import type { StudentAnswerMutationMeta } from "../../types/studentAttempt";
import { hasHtmlMarkup } from "./normalizeReadingPassageText";
import { StudentMaterialWithQuestionPane } from "./StudentMaterialWithQuestionPane";
import type { StudentLayoutMode } from "./layout/studentLayoutMode";

const emptyCaptionTrackUrl = "data:text/vtt;charset=utf-8,WEBVTT%0A%0A";

interface StudentListeningProps {
  state: ExamState;
  answers: Record<string, QuestionAnswer>;
  onAnswerChange: (
    questionId: string,
    answer: QuestionAnswer,
    meta?: StudentAnswerMutationMeta
  ) => void;
  currentQuestionId: string | null;
  onNavigate: (id: string) => void;
  flags?: Record<string, boolean>;
  onToggleFlag?: (id: string) => void;
  highlightEnabled?: boolean | undefined;
  highlightColor?: StudentHighlightColor | undefined;
  highlightClassName?: string | undefined;
  tabletMode?: boolean | undefined;
  layoutMode?: StudentLayoutMode | undefined;
  contentZoom?: number | undefined;
  onIncreasePassageReadability?: (() => void) | undefined;
  onDecreasePassageReadability?: (() => void) | undefined;
  onResetPassageReadability?: (() => void) | undefined;
  passageReadabilityLabel?: string | undefined;
  canIncreasePassageReadability?: boolean | undefined;
  canDecreasePassageReadability?: boolean | undefined;
  registerLiveAnswer?: ((answerKey: string, value: QuestionAnswer) => void) | undefined;
}

function getDiagramSlotIds(block: DiagramLabelingBlock): string[] {
  return block.labels.map((label) => `${block.id}:${label.id}`);
}

function isCurrentDiagramBlock(
  block: DiagramLabelingBlock,
  currentQuestionId: string | null,
  currentBlockId?: string
): boolean {
  if (currentBlockId === block.id || currentQuestionId === block.id) {
    return true;
  }

  return Boolean(currentQuestionId && getDiagramSlotIds(block).includes(currentQuestionId));
}
export function StudentListening({
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
  layoutMode = "wide",
  contentZoom = 1,
  onIncreasePassageReadability,
  onDecreasePassageReadability,
  onResetPassageReadability,
  passageReadabilityLabel,
  canIncreasePassageReadability,
  canDecreasePassageReadability,
  registerLiveAnswer,
}: StudentListeningProps) {
  void onIncreasePassageReadability;
  void onDecreasePassageReadability;
  void onResetPassageReadability;
  void passageReadabilityLabel;
  void canIncreasePassageReadability;
  void canDecreasePassageReadability;
  const isTabletMode = Boolean(tabletMode);
  const clampedContentZoom = Math.min(1.5, Math.max(0.85, contentZoom));
  const supportsCssZoom =
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("zoom", "1.01");
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
      transformOrigin: "top left",
      width: `${inverseZoom * 100}%`,
      minHeight: `${inverseZoom * 100}%`,
    };
  }, [clampedContentZoom, isTabletMode, supportsCssZoom]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(70);
  const questionContainerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
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
    materialPaneWidthProperty: "--listening-pane-width",
    dividerMode: isTabletMode ? "overlay" : "consumes-space",
  });
  const allQuestions = useMemo(() => getStudentQuestionsForModule(state, "listening"), [state]);
  const currentQ =
    allQuestions.find((question) => question.id === currentQuestionId) || allQuestions[0];
  const activePart = useMemo(() => {
    const partByQuestionGroup = currentQ
      ? state.listening.parts.find((part) => part.id === currentQ.groupId)
      : undefined;

    if (partByQuestionGroup) {
      return partByQuestionGroup;
    }

    const partByCurrentQuestion = state.listening.parts.find((part) =>
      part.blocks.some((block) => {
        if (block.id === currentQuestionId || block.id === currentQ?.blockId) {
          return true;
        }

        return (
          block.type === "DIAGRAM_LABELING" &&
          isCurrentDiagramBlock(block, currentQuestionId, currentQ?.blockId)
        );
      })
    );

    return (
      partByCurrentQuestion ||
      state.listening.parts.find((part) => part.id === state.activeListeningPartId) ||
      state.listening.parts[0]
    );
  }, [currentQ, currentQuestionId, state.activeListeningPartId, state.listening.parts]);
  const audioPlaybackEnabled = state.config.sections.listening.audioPlaybackEnabled ?? true;
  const activeTranscript = (activePart?.transcript ?? "").trim();
  const activeTranscriptUrl = activePart?.transcriptUrl?.trim() || undefined;
  const activeTranscriptHasHtml = useMemo(
    () => hasHtmlMarkup(activeTranscript),
    [activeTranscript]
  );
  const hasAudioSource = Boolean(activePart?.audioUrl);
  const canPlayAudio = audioPlaybackEnabled && hasAudioSource;
  const shouldShowAudioPanel = audioPlaybackEnabled;
  const activeDiagramBlocks = useMemo(() => {
    const diagramBlocks = (activePart?.blocks ?? []).filter(
      (block): block is DiagramLabelingBlock => block.type === "DIAGRAM_LABELING"
    );
    const currentDiagramBlocks = diagramBlocks.filter((block) =>
      isCurrentDiagramBlock(block, currentQuestionId, currentQ?.blockId)
    );

    return currentDiagramBlocks.length > 0 ? currentDiagramBlocks : diagramBlocks;
  }, [activePart?.blocks, currentQ?.blockId, currentQuestionId]);
  const diagramBlocksInMaterialPane = useMemo(
    () =>
      activeDiagramBlocks.filter(
        (block): block is DiagramLabelingBlock => !isInstructionReferencePlacement(block)
      ),
    [activeDiagramBlocks]
  );
  const hiddenDiagramReferenceBlockIds = useMemo(
    () => new Set(diagramBlocksInMaterialPane.map((block) => block.id)),
    [diagramBlocksInMaterialPane]
  );
  const blockStartNumbers = useMemo(() => {
    const map = new Map<string, number>();
    let nextNumber = 1;

    for (const part of state.listening.parts) {
      for (const block of part.blocks) {
        map.set(block.id, nextNumber);
        nextNumber += getBlockQuestionCount(block);
      }
    }

    return map;
  }, [state.listening.parts]);
  const getBlockStartQuestionNumber = useCallback(
    (blockId: string) => blockStartNumbers.get(blockId) ?? 1,
    [blockStartNumbers]
  );
  const hideDiagramReferenceForBlock = useCallback(
    (blockId: string) => hiddenDiagramReferenceBlockIds.has(blockId),
    [hiddenDiagramReferenceBlockIds]
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    audio.volume = volume / 100;
  }, [volume]);

  useEffect(() => {
    setIsPlaying(false);
    setProgress(0);
  }, [activePart?.audioUrl, audioPlaybackEnabled]);

  const syncProgressFromAudio = () => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
      setProgress(0);
      return;
    }

    setProgress((audio.currentTime / audio.duration) * 100);
  };

  const seekToPercent = (percent: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
      return;
    }

    const bounded = Math.min(100, Math.max(0, percent));
    audio.currentTime = (bounded / 100) * audio.duration;
    setProgress(bounded);
  };

  const adjustCurrentTime = (deltaSeconds: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
      return;
    }

    audio.currentTime = Math.min(audio.duration, Math.max(0, audio.currentTime + deltaSeconds));
    syncProgressFromAudio();
  };

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio || !canPlayAudio) {
      return;
    }

    if (!isPlaying) {
      await audio.play();
      setIsPlaying(true);
      return;
    }

    audio.pause();
    setIsPlaying(false);
  };

  const formatTime = (seconds: number) => {
    const bounded = Math.max(0, Math.floor(seconds));
    const m = Math.floor(bounded / 60);
    const s = bounded % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };
  const totalSeconds =
    audioRef.current && Number.isFinite(audioRef.current.duration) && audioRef.current.duration > 0
      ? audioRef.current.duration
      : 0;
  const currentSeconds = totalSeconds > 0 ? (progress / 100) * totalSeconds : 0;
  const renderBlockInstruction = useCallback(
    (instruction: string, blockId: string) => {
      if (!instruction.trim()) {
        return null;
      }

      return (
        <div
          className={`rounded-lg border border-gray-200 bg-gray-50 ${answerCompact ? "px-2 py-1.5" : "px-3 py-2"}`}
        >
          <StudentQuestionText
            as="p"
            className={`${answerCompact ? "text-xs md:text-sm" : "text-sm md:text-base"} leading-relaxed text-gray-800 break-words [overflow-wrap:anywhere]`}
            text={instruction}
            highlightEnabled={highlightEnabled}
            highlightColor={highlightColor}
            highlightSurfaceId={`question:listening:${blockId}:instruction`}
          />
        </div>
      );
    },
    [answerCompact, highlightColor, highlightEnabled]
  );

  if (!activePart) {
    return null;
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
      workspaceTestId="listening-split-workspace"
      dividerAriaLabel="Resize listening material and answer panels"
      dividerTestId="listening-pane-resizer"
      materialPane={
        <div
          className={`h-full overflow-y-auto font-sans leading-relaxed text-gray-900 ${
            materialCompact
              ? "p-2 pr-2 text-xs md:p-3 md:pr-3 md:text-sm"
              : "p-4 pr-4 text-sm md:p-6 md:pr-6 md:text-base"
          } ${
            isTabletMode
              ? "w-[var(--listening-pane-width)] min-w-[48px] border-r border-gray-200"
              : "lg:w-[var(--listening-pane-width)] lg:min-w-[300px] lg:p-8 lg:pr-12"
          }`}
          data-student-zoom-scroll
          style={{
            ...(tabletContentZoomStyle ?? {}),
          }}
        >
          <h2
            className={`${materialCompact ? "mb-2 text-base md:text-lg" : "mb-4 text-lg md:mb-6 md:text-xl"} font-bold break-words [overflow-wrap:anywhere]`}
          >
            {activePart.title}
          </h2>

          {canPlayAudio ? (
            <audio
              ref={audioRef}
              src={activePart.audioUrl}
              aria-label="Listening audio"
              aria-describedby={
                activeTranscript ? `listening-transcript-${activePart.id}` : undefined
              }
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
              onTimeUpdate={syncProgressFromAudio}
              onLoadedMetadata={syncProgressFromAudio}
            >
              <track
                kind="captions"
                src={activeTranscriptUrl ?? emptyCaptionTrackUrl}
                srcLang="en"
                label="Transcript"
              />
            </audio>
          ) : null}

          {shouldShowAudioPanel ? (
            <div className="w-full bg-gray-50 rounded-xl p-4 md:p-6 border border-gray-200">
              <h2 className="font-semibold text-gray-800 mb-3 md:mb-4 text-base md:text-lg">
                Listening Audio Track
              </h2>

              <div className="flex items-center gap-3 md:gap-4 mb-3 md:mb-4">
                <button
                  type="button"
                  onClick={() => void togglePlayback()}
                  disabled={!canPlayAudio}
                  className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 shadow-md flex-shrink-0"
                  aria-label={isPlaying ? "Pause audio" : "Play audio"}
                >
                  {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-1" />}
                </button>

                <div className="flex-1">
                  <div className="relative h-2" data-testid="listening-progress-track">
                    <div
                      aria-hidden="true"
                      className="h-2 overflow-hidden rounded-full bg-gray-200"
                    >
                      <div className="h-full bg-blue-500" style={{ width: `${progress}%` }}></div>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="0.1"
                      value={progress}
                      onChange={(event) => seekToPercent(Number.parseFloat(event.target.value))}
                      className="absolute inset-0 h-2 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                      aria-label="Audio progress"
                      disabled={!canPlayAudio}
                    />
                  </div>
                  <div className="flex justify-between mt-2 text-[length:var(--student-meta-font-size)] font-medium text-gray-500 font-mono">
                    <span>{formatTime(currentSeconds)}</span>
                    <span>{formatTime(totalSeconds)}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 md:gap-4 lg:gap-6 text-gray-600 flex-wrap">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => adjustCurrentTime(-10)}
                    className="p-2 md:p-2.5 hover:bg-gray-200 rounded-full"
                    title="Rewind 10s"
                    disabled={!canPlayAudio}
                    aria-label="Rewind 10 seconds"
                  >
                    <SkipBack size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustCurrentTime(10)}
                    className="p-2 md:p-2.5 hover:bg-gray-200 rounded-full"
                    title="Forward 10s"
                    disabled={!canPlayAudio}
                    aria-label="Forward 10 seconds"
                  >
                    <SkipForward size={14} />
                  </button>
                </div>
                <div className="h-3 md:h-4 w-px bg-gray-300 hidden sm:block"></div>
                <div className="flex items-center gap-2 flex-1 max-w-[200px] md:max-w-xs">
                  <Volume2 size={14} />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={volume}
                    onChange={(event) => setVolume(Number.parseInt(event.target.value, 10))}
                    className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    aria-label="Audio volume"
                    disabled={!canPlayAudio}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {activePart.pins.length > 0 && (
            <div className="mt-4 md:mt-6">
              <h3 className="font-semibold text-gray-700 mb-2 md:mb-3 text-sm md:text-base">
                Timestamp Pins
              </h3>
              <div className="space-y-1.5 md:space-y-2">
                {activePart.pins.map((pin) => (
                  <div
                    key={pin.id}
                    className="flex items-center gap-2 md:gap-3 p-2 bg-gray-50 border border-gray-200 rounded-lg"
                  >
                    <span className="font-mono text-[length:var(--student-meta-font-size)] text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                      {pin.time}
                    </span>
                    <span className="text-[length:var(--student-control-font-size)] text-gray-700">
                      {pin.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {diagramBlocksInMaterialPane.length > 0 ? (
            <div
              className={`${materialCompact ? "mt-3 space-y-3" : "mt-4 space-y-4"} break-words [overflow-wrap:anywhere]`}
              data-testid="listening-material-pane"
            >
              {diagramBlocksInMaterialPane.map((diagramBlock) => {
                const sources = getImageUrlCandidates(diagramBlock.imageUrl ?? "");
                const hasImage = Boolean(sources[0]);

                return (
                  <div
                    key={diagramBlock.id}
                    className="rounded-xl border border-gray-200 bg-white p-3"
                  >
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-gray-700">Diagram reference</h3>
                    </div>
                    {hasImage ? (
                      <StudentZoomableMedia
                        sources={sources}
                        alt="Diagram reference"
                        label="Diagram reference"
                        hint="Tap to zoom the diagram"
                        className="overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
                        imageClassName="max-h-[72dvh]"
                      />
                    ) : (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-500">
                        Diagram image URL is missing or inaccessible.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
          {activeTranscript ? (
            <div
              id={`listening-transcript-${activePart.id}`}
              className={`${materialCompact ? "mt-3 p-2" : "mt-4 p-3"} rounded-xl border border-gray-200 bg-white break-words [overflow-wrap:anywhere]`}
            >
              <h3
                className={`${materialCompact ? "mb-1 text-xs" : "mb-2 text-sm"} font-semibold text-gray-700`}
              >
                Transcript / Reference
              </h3>
              <RichTextHighlighter
                content={activeTranscript}
                contentType={activeTranscriptHasHtml ? "html" : "text"}
                enabled={highlightEnabled}
                className={`student-accessible-table-typography ${materialCompact ? "text-xs md:text-sm" : "text-sm md:text-base"} whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-relaxed text-gray-800`}
                highlightColor={highlightColor}
                highlightClassName={highlightClassName}
                highlightSurfaceId={`listening:transcript:${activePart.id}`}
              />
            </div>
          ) : null}
        </div>
      }
      questionPanel={{
        blocks: activePart.blocks,
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
        contentZoomStyle: tabletContentZoomStyle,
        panelTestId: "listening-question-scroll",
        getBlockStartQuestionNumber,
        renderBlockInstruction,
        hideDiagramReferenceForBlock,
        shouldFocusQuestion: () => true,
      }}
    />
  );
}

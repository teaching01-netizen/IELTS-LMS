import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ExamState, QuestionAnswer } from '../../types';
import { QuestionRenderer } from './QuestionRenderer';
import { Play, Pause, SkipBack, SkipForward, Volume2, ArrowLeftRight, ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Flag } from 'lucide-react';
import { getBlockQuestionCount } from '../../utils/examUtils';
import { getQuestionStartNumber, getStudentQuestionsForModule } from '../../services/examAdapterService';
import { prefersReducedMotion } from './prefersReducedMotion';
import { FormattedText } from './FormattedText';
import { RichTextHighlighter } from './RichTextHighlighter';
import type { StudentHighlightColor } from './highlightPalette';
import { formatQuestionRange } from './questionRangeLabel';

interface StudentListeningProps {
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
}: StudentListeningProps) {
  const isTabletMode = Boolean(tabletMode);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(70);
  const [leftWidth, setLeftWidth] = useState(50);
  const [showStaffInstructions, setShowStaffInstructions] = useState(false);
  const [collapsedInstructions, setCollapsedInstructions] = useState<Record<string, boolean>>({});
  const questionContainerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const allQuestions = useMemo(() => getStudentQuestionsForModule(state, 'listening'), [state]);
  const currentQ = allQuestions.find((question) => question.id === currentQuestionId) || allQuestions[0];
  const activePartId = currentQ?.groupId || state.listening.parts[0]?.id;
  const activePart = state.listening.parts.find((part) => part.id === activePartId) || state.listening.parts[0];
  const currentIndex = allQuestions.findIndex((question) => question.id === currentQuestionId);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < allQuestions.length - 1;
  const previousQuestion = hasPrev ? allQuestions[currentIndex - 1] : undefined;
  const nextQuestion = hasNext ? allQuestions[currentIndex + 1] : undefined;
  const splitPaneStyle = useMemo(
    () =>
      ({
        ['--listening-pane-width' as string]: isTabletMode ? '48%' : `${leftWidth}%`,
        ['--question-pane-width' as string]: isTabletMode ? '52%' : `calc(${100 - leftWidth}% - 16px)`,
      }) as React.CSSProperties,
    [isTabletMode, leftWidth],
  );
  const audioPlaybackEnabled = state.config.sections.listening.audioPlaybackEnabled ?? true;
  const staffInstructions = (state.config.sections.listening.staffInstructions ?? '').trim();
  const activeTranscript = ((activePart as { transcript?: string | undefined }).transcript ?? '').trim();
  const hasAudioSource = Boolean(activePart?.audioUrl);
  const canPlayAudio = audioPlaybackEnabled && hasAudioSource;
  const shouldShowAudioPanel = audioPlaybackEnabled;

  const renderBlockInstruction = (blockId: string, instruction: string) => {
    const isLong = instruction.trim().length > 140;
    const isCollapsed = isLong && collapsedInstructions[blockId] !== false;

    return (
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <FormattedText
            as="p"
            className={`text-sm leading-relaxed text-gray-800 md:text-base ${isCollapsed ? 'line-clamp-2' : ''}`}
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
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-600 shadow-sm"
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

  useEffect(() => {
    if (currentQuestionId && questionContainerRef.current) {
      const element = document.getElementById(`question-${currentQuestionId}`);
      if (element) {
        element.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
      }
    }
  }, [currentQuestionId]);

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

  const formatTime = (seconds: number) => {
    const bounded = Math.max(0, Math.floor(seconds));
    const m = Math.floor(bounded / 60);
    const s = bounded % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };
  const totalSeconds =
    audioRef.current && Number.isFinite(audioRef.current.duration) && audioRef.current.duration > 0
      ? audioRef.current.duration
      : 0;
  const currentSeconds = totalSeconds > 0 ? (progress / 100) * totalSeconds : 0;

  if (!activePart) {
    return null;
  }

  return (
    <div className="flex flex-col h-full w-full bg-white">
      <div
        className={`relative flex flex-1 overflow-hidden border-t border-gray-300 ${
          isTabletMode ? 'flex-row' : 'flex-col md:flex-row'
        }`}
        style={splitPaneStyle}
        data-testid="listening-split-workspace"
      >
        <div
          className={`h-full w-full overflow-y-auto p-4 pr-4 font-sans text-sm leading-relaxed text-gray-900 md:p-6 md:pr-6 md:text-base ${
            isTabletMode ? 'w-[var(--listening-pane-width)] min-w-[260px] border-r border-gray-200' : 'lg:w-[var(--listening-pane-width)] lg:min-w-[300px] lg:p-8 lg:pr-12'
          }`}
          data-student-zoom-scroll
        >
          <h2 className="text-lg md:text-xl font-bold mb-4 md:mb-6">{activePart.title}</h2>

          {staffInstructions ? (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-800">Staff Instructions</p>
                <button
                  type="button"
                  onClick={() => setShowStaffInstructions((open) => !open)}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-white px-2 py-1 text-xs font-semibold text-amber-800 shadow-sm"
                  aria-expanded={showStaffInstructions}
                >
                  {showStaffInstructions ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {showStaffInstructions ? 'Hide' : 'Show'}
                </button>
              </div>
              {showStaffInstructions ? (
                <RichTextHighlighter
                  content={staffInstructions}
                  contentType="text"
                  enabled={highlightEnabled}
                  className="mt-2 whitespace-pre-wrap text-sm text-amber-900 md:text-base"
                  highlightColor={highlightColor}
                  highlightClassName={highlightClassName}
                />
              ) : null}
            </div>
          ) : null}

          {canPlayAudio ? (
            <audio
              ref={audioRef}
              src={activePart.audioUrl}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => setIsPlaying(false)}
              onTimeUpdate={syncProgressFromAudio}
              onLoadedMetadata={syncProgressFromAudio}
            />
          ) : null}
          
          {shouldShowAudioPanel ? (
            <div className="w-full bg-gray-50 rounded-xl p-4 md:p-6 border border-gray-200">
              <h2 className="font-semibold text-gray-800 mb-3 md:mb-4 text-base md:text-lg">Listening Audio Track</h2>

              <div className="flex items-center gap-3 md:gap-4 mb-3 md:mb-4">
                <button
                  type="button"
                  onClick={() => void togglePlayback()}
                  disabled={!canPlayAudio}
                  className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 shadow-md flex-shrink-0"
                  aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
                >
                  {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-1" />}
                </button>

                <div className="flex-1">
                  <div
                    className="h-2 bg-gray-200 rounded-full overflow-hidden relative cursor-pointer"
                    data-testid="listening-progress-track"
                    onClick={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = e.clientX - rect.left;
                      seekToPercent((x / rect.width) * 100);
                    }}
                  >
                    <div className="h-full bg-blue-500" style={{ width: `${progress}%` }}></div>
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
                    onChange={(e) => setVolume(Number.parseInt(e.target.value, 10))}
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
              <h3 className="font-semibold text-gray-700 mb-2 md:mb-3 text-sm md:text-base">Timestamp Pins</h3>
              <div className="space-y-1.5 md:space-y-2">
                {activePart.pins.map((pin) => (
                  <div key={pin.id} className="flex items-center gap-2 md:gap-3 p-2 bg-gray-50 border border-gray-200 rounded-lg">
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
          {activeTranscript ? (
            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-3">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">Transcript / Reference</h3>
              <RichTextHighlighter
                content={activeTranscript}
                contentType="text"
                enabled={highlightEnabled}
                className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800 md:text-base"
                highlightColor={highlightColor}
                highlightClassName={highlightClassName}
              />
              {highlightEnabled && isTabletMode ? (
                <p className="mt-2 rounded-md bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
                  Select reference text to highlight it.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div 
          onMouseDown={handleDrag}
          onTouchStart={handleDrag}
          className={`${isTabletMode ? 'hidden' : 'hidden lg:flex'} w-4 bg-gray-400 relative flex items-center justify-center cursor-col-resize flex-shrink-0 hover:bg-gray-600 transition-colors`}
        >
          <div className="w-8 h-8 bg-white border border-gray-400 flex items-center justify-center absolute z-10 shadow-sm pointer-events-none">
            <ArrowLeftRight size={14} className="text-gray-600" />
          </div>
        </div>

        <div className={`relative flex h-full min-w-0 flex-col md:min-w-[320px] min-h-0 ${isTabletMode ? 'w-[var(--question-pane-width)]' : 'w-full lg:w-[var(--question-pane-width)]'}`}>
          <div
            className={`flex-1 overflow-y-auto p-4 md:p-5 lg:p-8 pb-20 md:pb-24 space-y-6 md:space-y-8 ${
              isTabletMode ? 'pb-28 md:pb-28' : ''
            }`}
            ref={questionContainerRef}
            data-student-zoom-scroll
          >
            {activePart.blocks.map((block) => {
              const blockQuestions = allQuestions.filter((question) => question.blockId === block.id);
              const singleBlockQuestion = blockQuestions.length === 1 ? blockQuestions[0] : undefined;
              let blockStartQ = 1;
              for (const p of state.listening.parts) {
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
                      Questions {formatQuestionRange(blockStartQ, blockEndQ)}
                    </h3>
                    {renderBlockInstruction(block.id, block.instruction)}
                  </div>
                  
                  <div className="space-y-8">
                    {('questions' in block) ? (
                      block.questions.map((q, qIdx) => {
                        const questionEntries = blockQuestions.filter((entry) => entry.question?.id === q.id);
                        const firstEntry = questionEntries[0];
                        const globalIdx =
                          (firstEntry ? getQuestionStartNumber(allQuestions, firstEntry.id) : null) ??
                          blockStartQ + qIdx;
                        const inlineFlags = block.type === 'SENTENCE_COMPLETION' || block.type === 'NOTE_COMPLETION';
                        const flagId = firstEntry?.id;

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
                              answer={answers[firstEntry?.answerKey ?? q.id]}
                              onChange={(val) => onAnswerChange(firstEntry?.answerKey ?? q.id, val)}
                              isFlagged={flagId ? Boolean(flags[flagId]) : false}
                              isActive={questionEntries.some((entry) => entry.id === currentQuestionId)}
                              slotIds={questionEntries.map((entry) => entry.id)}
                              currentQuestionId={currentQuestionId}
                              flags={flags}
                              onToggleFlag={onToggleFlag}
                              tabletMode={isTabletMode}
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

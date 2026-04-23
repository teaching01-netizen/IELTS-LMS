import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ExamState, QuestionAnswer } from '../../types';
import { QuestionRenderer } from './QuestionRenderer';
import { Play, Pause, SkipBack, SkipForward, Volume2, ArrowLeftRight, ArrowLeft, ArrowRight, Flag } from 'lucide-react';
import { getBlockQuestionCount } from '../../utils/examUtils';
import { getQuestionStartNumber, getStudentQuestionsForModule } from '../../services/examAdapterService';
import { prefersReducedMotion } from './prefersReducedMotion';
import { FormattedText } from './FormattedText';

interface StudentListeningProps {
  state: ExamState;
  answers: Record<string, QuestionAnswer>;
  onAnswerChange: (questionId: string, answer: QuestionAnswer) => void;
  currentQuestionId: string | null;
  onNavigate: (id: string) => void;
  flags?: Record<string, boolean>;
  onToggleFlag?: (id: string) => void;
}

export function StudentListening({ state, answers, onAnswerChange, currentQuestionId, onNavigate, flags = {}, onToggleFlag }: StudentListeningProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(70);
  const [leftWidth, setLeftWidth] = useState(50);
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
        ['--listening-pane-width' as string]: `${leftWidth}%`,
        ['--question-pane-width' as string]: `calc(${100 - leftWidth}% - 16px)`,
      }) as React.CSSProperties,
    [leftWidth],
  );
  const audioPlaybackEnabled = state.config.sections.listening.audioPlaybackEnabled ?? true;
  const staffInstructions = (state.config.sections.listening.staffInstructions ?? '').trim();
  const hasAudioSource = Boolean(activePart?.audioUrl);
  const canPlayAudio = audioPlaybackEnabled && hasAudioSource;

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
      <div className="relative flex flex-1 flex-col overflow-hidden border-t border-gray-300 md:flex-row" style={splitPaneStyle}>
        <div className="h-full w-full overflow-y-auto p-4 pr-4 font-sans text-sm leading-relaxed text-gray-900 md:p-6 md:pr-6 md:text-base lg:w-[var(--listening-pane-width)] lg:min-w-[300px] lg:p-8 lg:pr-12">
          <h2 className="text-lg md:text-xl font-bold mb-4 md:mb-6">{activePart.title}</h2>

          {staffInstructions ? (
            <div className="mb-4 md:mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-amber-800 mb-2">Staff Instructions</p>
              <FormattedText as="div" className="text-sm md:text-base text-amber-900" text={staffInstructions} />
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
          
          <div className="w-full bg-gray-50 rounded-xl p-4 md:p-6 border border-gray-200">
            <h2 className="font-semibold text-gray-800 mb-3 md:mb-4 text-base md:text-lg">Listening Audio Track</h2>

            {!audioPlaybackEnabled ? (
              <p className="mb-3 md:mb-4 text-xs md:text-sm text-gray-600">
                Audio playback has been turned off by staff for this exam.
              </p>
            ) : null}
            
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
                <div className="flex justify-between mt-2 text-[10px] md:text-xs font-medium text-gray-500 font-mono">
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
                  className="p-1.5 md:p-2 hover:bg-gray-200 rounded-full"
                  title="Rewind 10s"
                  disabled={!canPlayAudio}
                  aria-label="Rewind 10 seconds"
                >
                  <SkipBack size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => adjustCurrentTime(10)}
                  className="p-1.5 md:p-2 hover:bg-gray-200 rounded-full"
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

          {activePart.pins.length > 0 && (
            <div className="mt-4 md:mt-6">
              <h3 className="font-semibold text-gray-700 mb-2 md:mb-3 text-sm md:text-base">Timestamp Pins</h3>
              <div className="space-y-1.5 md:space-y-2">
                {activePart.pins.map((pin) => (
                  <div key={pin.id} className="flex items-center gap-2 md:gap-3 p-2 bg-gray-50 border border-gray-200 rounded-lg">
                    <span className="font-mono text-xs md:text-sm text-blue-600 bg-blue-100 px-2 py-0.5 rounded">{pin.time}</span>
                    <span className="text-xs md:text-sm text-gray-700">{pin.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div 
          onMouseDown={handleDrag}
          onTouchStart={handleDrag}
          className="hidden lg:flex w-4 bg-gray-400 relative flex items-center justify-center cursor-col-resize flex-shrink-0 hover:bg-gray-600 transition-colors"
        >
          <div className="w-8 h-8 bg-white border border-gray-400 flex items-center justify-center absolute z-10 shadow-sm pointer-events-none">
            <ArrowLeftRight size={14} className="text-gray-600" />
          </div>
        </div>

        <div className="relative flex h-full w-full min-w-0 flex-col md:min-w-[320px] lg:w-[var(--question-pane-width)]">
          <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 pb-20 md:pb-24 space-y-8 md:space-y-10" ref={questionContainerRef}>
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
                      Questions {blockStartQ}–{blockEndQ}
                    </h3>
                    <FormattedText as="p" className="text-gray-900 text-sm md:text-base" text={block.instruction} />
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
                            className="relative"
                          >
                            {onToggleFlag && flagId && !inlineFlags ? (
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
                        {onToggleFlag && singleBlockQuestion ? (
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
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="absolute bottom-16 md:bottom-20 right-4 md:right-6 flex shadow-md z-20">
            <button 
              onClick={() => previousQuestion && onNavigate(previousQuestion.id)}
              className={`w-9 h-9 md:w-10 md:h-10 lg:w-12 lg:h-12 flex items-center justify-center transition-colors ${hasPrev ? 'bg-gray-200 hover:bg-gray-300 text-white' : 'bg-gray-100 text-gray-300 cursor-not-allowed'}`}
            >
              <ArrowLeft size={16} strokeWidth={3} />
            </button>
            <button 
              onClick={() => nextQuestion && onNavigate(nextQuestion.id)}
              className={`w-9 h-9 md:w-10 md:h-10 lg:w-12 lg:h-12 flex items-center justify-center transition-colors ${hasNext ? 'bg-black hover:bg-gray-800 text-white' : 'bg-gray-800 text-gray-500 cursor-not-allowed'}`}
            >
              <ArrowRight size={16} strokeWidth={3} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

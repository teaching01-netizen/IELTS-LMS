import React, { useState, useRef, useEffect } from 'react';
import { ExamState, QuestionAnswer } from '../../types';
import { QuestionRenderer } from './QuestionRenderer';
import { Play, Pause, SkipBack, SkipForward, Volume2, ArrowLeftRight, ArrowLeft, ArrowRight, Flag } from 'lucide-react';
import { flattenListeningQuestions, getBlockQuestionCount } from '../../utils/examUtils';

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
  const audioRef = useRef<HTMLAudioElement>(null);
  
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

  const allQuestions = flattenListeningQuestions(state.listening.parts);
  const currentQ = allQuestions.find(q => 
    q.block.type === 'MULTI_MCQ' ? q.block.id === currentQuestionId : q.question?.id === currentQuestionId
  ) || allQuestions[0];
  const activePartId = currentQ?.partId || state.listening.parts[0]?.id;
  
  const activePart = state.listening.parts.find(p => p.id === activePartId) || state.listening.parts[0];

  const currentIndex = allQuestions.findIndex(q => 
    q.block.type === 'MULTI_MCQ' ? q.block.id === currentQuestionId : q.question?.id === currentQuestionId
  );
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < allQuestions.length - 1;
  const previousQuestion = hasPrev ? allQuestions[currentIndex - 1] : undefined;
  const nextQuestion = hasNext ? allQuestions[currentIndex + 1] : undefined;

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isPlaying) {
      interval = setInterval(() => {
        setProgress(p => {
          if (p >= 100) {
            setIsPlaying(false);
            return 100;
          }
          return p + 0.1;
        });
      }, 100);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPlaying]);

  const formatTime = (percent: number) => {
    const totalSeconds = 5 * 60 + 43;
    const currentSeconds = Math.floor((percent / 100) * totalSeconds);
    const m = Math.floor(currentSeconds / 60);
    const s = currentSeconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getQuestionId = (item: (typeof allQuestions)[number] | undefined): string => {
    if (!item) {
      return '';
    }
    return item.block.type === 'MULTI_MCQ' ? item.block.id : (item.question?.id || '');
  };

  if (!activePart) {
    return null;
  }

  return (
    <div className="flex flex-col h-full w-full bg-white">
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden relative border-t border-gray-300">
        <div style={{ width: `${leftWidth}%` }} className="h-full overflow-y-auto p-4 md:p-6 lg:p-8 pr-4 md:pr-6 lg:pr-12 font-sans text-sm md:text-base leading-relaxed text-gray-900 min-w-[260px] md:min-w-[280px] lg:min-w-[300px]">
          <h2 className="text-lg md:text-xl font-bold mb-4 md:mb-6">{activePart.title}</h2>
          
          {activePart.audioUrl && (
            <audio ref={audioRef} src={activePart.audioUrl} />
          )}
          
          <div className="w-full bg-gray-50 rounded-xl p-4 md:p-6 border border-gray-200">
            <h2 className="font-semibold text-gray-800 mb-3 md:mb-4 text-base md:text-lg">Listening Audio Track</h2>
            
            <div className="flex items-center gap-3 md:gap-4 mb-3 md:mb-4">
              <button 
                onClick={() => setIsPlaying(!isPlaying)}
                className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700 shadow-md flex-shrink-0"
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-1" />}
              </button>
              
              <div className="flex-1">
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden relative cursor-pointer" onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  setProgress((x / rect.width) * 100);
                }}>
                  <div className="h-full bg-blue-500" style={{ width: `${progress}%` }}></div>
                </div>
                <div className="flex justify-between mt-2 text-[10px] md:text-xs font-medium text-gray-500 font-mono">
                  <span>{formatTime(progress)}</span>
                  <span>05:43</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-3 md:gap-4 lg:gap-6 text-gray-600 flex-wrap">
              <div className="flex items-center gap-2">
                <button onClick={() => setProgress(Math.max(0, progress - 5))} className="p-1.5 md:p-2 hover:bg-gray-200 rounded-full" title="Rewind 10s"><SkipBack size={14} /></button>
                <button onClick={() => setProgress(Math.min(100, progress + 5))} className="p-1.5 md:p-2 hover:bg-gray-200 rounded-full" title="Forward 10s"><SkipForward size={14} /></button>
              </div>
              <div className="h-3 md:h-4 w-px bg-gray-300 hidden sm:block"></div>
              <div className="flex items-center gap-2 flex-1 max-w-[200px] md:max-w-xs">
                <Volume2 size={14} />
                <input type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(parseInt(e.target.value))} className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600" />
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

        <div style={{ width: `calc(${100 - leftWidth}% - 16px)` }} className="h-full flex flex-col relative min-w-[280px] md:min-w-[320px]">
          <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 pb-20 md:pb-24 space-y-8 md:space-y-10">
            {activePart.blocks.map((block) => {
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
                    <p className="text-gray-900 text-sm md:text-base">{block.instruction}</p>
                  </div>
                  
                  <div className="space-y-8">
                    {('questions' in block) ? (
                      block.questions.map((q, qIdx) => {
                        const flattened = allQuestions.find(item =>
                          item.block.id === block.id && item.question?.id === q.id
                        );
                        const globalIdx = flattened ? flattened.index + 1 : blockStartQ + qIdx;

                        return (
                          <div key={q.id} id={`question-${q.id}`} className="relative">
                            {onToggleFlag && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onToggleFlag(q.id); }}
                                className={`absolute top-0 right-0 w-8 h-8 rounded-full flex items-center justify-center transition-all z-10 shadow-sm ${
                                  flags[q.id] ? 'bg-amber-700 text-white' : 'bg-white border border-gray-300 text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                                }`}
                                title={flags[q.id] ? 'Unflag question' : 'Flag question'}
                              >
                                <Flag size={14} className={flags[q.id] ? 'fill-current' : ''} />
                              </button>
                            )}
                            <QuestionRenderer
                              question={q}
                              block={block}
                              number={globalIdx}
                              answer={answers[q.id]}
                              onChange={(val) => onAnswerChange(q.id, val)}
                            />
                          </div>
                        );
                      })
                    ) : (
                      <div key={block.id} id={`question-${block.id}`} className="relative">
                        {onToggleFlag && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onToggleFlag(block.id); }}
                            className={`absolute top-0 right-0 w-8 h-8 rounded-full flex items-center justify-center transition-all z-10 shadow-sm ${
                              flags[block.id] ? 'bg-amber-700 text-white' : 'bg-white border border-gray-300 text-gray-400 hover:bg-gray-50 hover:text-gray-600'
                            }`}
                            title={flags[block.id] ? 'Unflag question' : 'Flag question'}
                          >
                            <Flag size={14} className={flags[block.id] ? 'fill-current' : ''} />
                          </button>
                        )}
                        <QuestionRenderer
                          question={null}
                          block={block}
                          number={blockStartQ}
                          answer={answers[block.id]}
                          onChange={(val) => onAnswerChange(block.id, val)}
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
              onClick={() => previousQuestion && onNavigate(getQuestionId(previousQuestion))}
              className={`w-9 h-9 md:w-10 md:h-10 lg:w-12 lg:h-12 flex items-center justify-center transition-colors ${hasPrev ? 'bg-gray-200 hover:bg-gray-300 text-white' : 'bg-gray-100 text-gray-300 cursor-not-allowed'}`}
            >
              <ArrowLeft size={16} strokeWidth={3} />
            </button>
            <button 
              onClick={() => nextQuestion && onNavigate(getQuestionId(nextQuestion))}
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

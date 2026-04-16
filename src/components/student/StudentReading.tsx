import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ExamState, QuestionAnswer } from '../../types';
import { QuestionRenderer } from './QuestionRenderer';
import { ArrowLeft, ArrowRight, ArrowLeftRight, Flag } from 'lucide-react';
import { flattenReadingQuestions, getBlockQuestionCount } from '../../utils/examUtils';

interface StudentReadingProps {
  state: ExamState;
  answers: Record<string, QuestionAnswer>;
  onAnswerChange: (questionId: string, answer: QuestionAnswer) => void;
  currentQuestionId: string | null;
  onNavigate: (id: string) => void;
  flags?: Record<string, boolean>;
  onToggleFlag?: (id: string) => void;
}

export function StudentReading({ state, answers, onAnswerChange, currentQuestionId, onNavigate, flags = {}, onToggleFlag }: StudentReadingProps) {
  const [leftWidth, setLeftWidth] = useState(50);
  const questionContainerRef = useRef<HTMLDivElement>(null);
  
  // Auto-scroll to current question when it changes
  useEffect(() => {
    if (currentQuestionId && questionContainerRef.current) {
      const element = document.getElementById(`question-${currentQuestionId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  const allQuestions = flattenReadingQuestions(state.reading.passages);
  const currentQ = allQuestions.find(q => 
    q.block.type === 'MULTI_MCQ' ? q.block.id === currentQuestionId : q.question?.id === currentQuestionId
  ) || allQuestions[0];
  const activePassageId = currentQ?.passageId || state.reading.passages[0]?.id;
  
  const activePassage = state.reading.passages.find(p => p.id === activePassageId) || state.reading.passages[0];
  const passageHasHtml = useMemo(() => /<\/?[a-z][\s\S]*>/i.test(activePassage?.content ?? ''), [activePassage?.content]);

  const currentIndex = allQuestions.findIndex(q => 
    q.block.type === 'MULTI_MCQ' ? q.block.id === currentQuestionId : q.question?.id === currentQuestionId
  );
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < allQuestions.length - 1;
  const previousQuestion = hasPrev ? allQuestions[currentIndex - 1] : undefined;
  const nextQuestion = hasNext ? allQuestions[currentIndex + 1] : undefined;

  const getQuestionId = (item: (typeof allQuestions)[number] | undefined): string => {
    if (!item) {
      return '';
    }
    return item.block.type === 'MULTI_MCQ' ? item.block.id : (item.question?.id || '');
  };

  if (!activePassage) {
    return null;
  }

  return (
    <div className="flex flex-col h-full w-full bg-white">
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden relative border-t border-gray-300">
        <div style={{ width: `${leftWidth}%` }} className="h-full overflow-y-auto p-4 md:p-6 lg:p-8 pr-4 md:pr-6 lg:pr-12 font-sans text-sm md:text-base leading-relaxed text-gray-900 min-w-[260px] md:min-w-[280px] lg:min-w-[300px]">
          <h2 className="text-lg md:text-xl font-bold mb-4 md:mb-6">{activePassage.title}</h2>
          <div className="leading-relaxed text-gray-900 space-y-4 [&_h1]:text-2xl [&_h1]:font-black [&_h2]:text-xl [&_h2]:font-bold [&_h3]:text-lg [&_h3]:font-bold [&_img]:max-w-full [&_img]:rounded-2xl [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6">
            {passageHasHtml ? (
              <div dangerouslySetInnerHTML={{ __html: activePassage.content }} />
            ) : (
              <div className="whitespace-pre-wrap">{activePassage.content}</div>
            )}
            {(activePassage.images ?? []).map((image) => (
              <div key={image.id} className="relative rounded-2xl overflow-hidden border border-gray-200 bg-gray-50">
                <img src={image.src} alt={image.alt} className="w-full object-contain" />
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
            {/* Line highlighting placeholder - would need metadata mapping questions to passage lines */}
            {currentQuestionId && (
              <div className="mt-4 p-2 bg-blue-50 rounded text-xs text-blue-600">
                Line highlighting for question {currentQuestionId} - requires question-to-line metadata
              </div>
            )}
          </div>
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
          <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 pb-20 md:pb-24 space-y-8 md:space-y-10" ref={questionContainerRef}>
            {activePassage.blocks.map((block) => {
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
                    <p className="text-gray-900 text-sm md:text-base">{block.instruction}</p>
                  </div>
                  
                  <div className="space-y-8 md:space-y-10">
                    {('questions' in block) ? (
                      block.questions.map((q, qIdx) => {
                        const flattened = allQuestions.find(item =>
                          item.block.id === block.id && item.question?.id === q.id
                        );
                        const globalIdx = flattened ? flattened.index + 1 : blockStartQ + qIdx;
                        const isActive = q.id === currentQuestionId;

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
                              isActive={isActive}
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

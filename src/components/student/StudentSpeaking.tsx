import React, { useState, useEffect } from 'react';
import { ExamState } from '../../types';
import { Mic, Video, PhoneOff, ArrowLeft, ArrowRight } from 'lucide-react';
import { StudentModuleEmptyState } from './StudentModuleEmptyState';
import { useSplitPaneResize } from './useSplitPaneResize';
import { StudentSplitPaneResizer } from './StudentSplitPaneResizer';

interface StudentSpeakingProps {
  state: ExamState;
  onSubmit: () => void;
  currentQuestionId: string | null;
  onNavigate: (id: string) => void;
}

export function StudentSpeaking({ state, onSubmit, currentQuestionId, onNavigate }: StudentSpeakingProps) {
  void currentQuestionId;

  const speakingConfig = state.config.sections.speaking;
  const [activePartIndex, setActivePartIndex] = useState(0);
  
  const parts = speakingConfig.parts;
  const currentIndex = activePartIndex;
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < parts.length - 1;
  const initialPart = parts[0];
  const [prepTime, setPrepTime] = useState(initialPart?.prepTime ?? 0);
  const [isPrep, setIsPrep] = useState((initialPart?.prepTime ?? 0) > 0);
  const [speakTime, setSpeakTime] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState((initialPart?.prepTime ?? 0) <= 0);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const {
    handleDrag,
    handleKeyboardResize,
    leftWidth,
    workspaceRef,
  } = useSplitPaneResize({
    isTabletMode: false,
    materialPaneWidthProperty: '--reading-pane-width',
    defaultLeftWidth: 50,
  });

  const currentPart = speakingConfig.parts[activePartIndex];
  const cueCardDetails = state.speaking.cueCardDetails;

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isPrep && prepTime > 0) {
      interval = setInterval(() => setPrepTime(p => p - 1), 1000);
    } else if (isPrep && prepTime === 0) {
      setIsPrep(false);
      setIsSpeaking(true);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isPrep, prepTime]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isSpeaking) {
      const limit = currentPart?.speakingTime ?? 0;
      interval = setInterval(() => {
        setSpeakTime(s => (limit > 0 && s >= limit ? s : s + 1));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isSpeaking, currentPart?.speakingTime]);

  const goToPart = (nextIndex: number) => {
    const nextPart = speakingConfig.parts[nextIndex];
    if (!nextPart) {
      return;
    }
    setConfirmComplete(false);
    setActivePartIndex(nextIndex);
    setPrepTime(nextPart.prepTime);
    setIsPrep(nextPart.prepTime > 0);
    setSpeakTime(0);
    setIsSpeaking(nextPart.prepTime <= 0);
    onNavigate(nextPart.id);
  };

  const goToNextPart = () => {
    const nextIndex = activePartIndex + 1;
    if (nextIndex < speakingConfig.parts.length) {
      goToPart(nextIndex);
    } else {
      onSubmit();
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!currentPart) {
    return <StudentModuleEmptyState label="Speaking" />;
  }

  const timeUp = currentPart.speakingTime > 0 && speakTime >= currentPart.speakingTime;

  return (
    <div className="flex flex-col h-full w-full bg-white">
      <div ref={workspaceRef} className="flex flex-col md:flex-row flex-1 overflow-hidden relative border-t border-gray-300">
        <div style={{ width: `${leftWidth}%` }} className="h-full overflow-hidden p-4 md:p-6 lg:p-8 font-sans bg-black text-white flex flex-col gap-4 md:gap-6 min-w-[260px] md:min-w-[280px] lg:min-w-[300px]">
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <h3 className="font-black text-lg md:text-xl mb-0.5 tracking-tight">{currentPart?.label}</h3>
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">Live IELTS Interview</p>
            </div>
            <div className="flex items-center gap-2 md:gap-3">
              <div className="relative flex items-center justify-center">
                <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-red-500 animate-ping absolute"></div>
                <div className="w-2.5 h-2.5 md:w-3 md:h-3 rounded-full bg-red-600 relative"></div>
              </div>
              <span className="text-[10px] md:text-xs font-semibold uppercase tracking-wide text-red-500 hidden sm:inline">Live Recording</span>
            </div>
          </div>
          <div className="flex-[2] bg-gray-900 rounded-3xl border border-white/5 relative overflow-hidden flex items-center justify-center shadow-inner group min-h-[200px] md:min-h-0">
            <div className="text-center transition-transform group-hover:scale-110 duration-500">
              <div className="w-24 h-24 md:w-32 md:h-32 bg-gray-800 rounded-full mx-auto mb-4 md:mb-6 flex items-center justify-center shadow-2xl border-2 border-white/10">
                <span className="text-4xl md:text-5xl">👵</span>
              </div>
              <p className="font-black text-lg md:text-xl text-white tracking-tight">Examiner: Mrs. Thompson</p>
              <p className="text-[10px] md:text-xs font-semibold text-green-500 uppercase tracking-wide mt-2 bg-green-500/10 px-3 py-1 rounded-full">Connected</p>
            </div>
            <div className="absolute bottom-4 md:bottom-6 left-4 md:left-6 flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 md:px-4 py-1.5 md:py-2 rounded-xl text-[10px] md:text-xs font-semibold border border-white/10 uppercase tracking-wide">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              Remote Feed
            </div>
          </div>
          
          <div className="flex-1 flex gap-4 md:gap-6">
            <div className="flex-1 bg-gray-900 rounded-3xl border border-white/5 relative overflow-hidden flex items-center justify-center shadow-inner min-h-[150px] md:min-h-0">
              <div className="text-center">
                <div className="w-16 h-16 md:w-20 md:h-20 bg-gray-800 rounded-full mx-auto mb-2 md:mb-3 flex items-center justify-center border-2 border-white/5">
                  <span className="text-2xl md:text-3xl">👦</span>
                </div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Self View (Active)</p>
              </div>
              <div className="absolute bottom-3 md:bottom-4 left-3 md:left-4 bg-blue-600/60 backdrop-blur-md px-2 md:px-3 py-1 rounded-lg text-[10px] font-semibold border border-white/10 uppercase tracking-wide">
                You
              </div>
            </div>
            
            <div className="w-16 md:w-24 flex flex-col justify-center gap-3 md:gap-4">
              <button aria-label="Toggle microphone" disabled title="Controlled by your proctor" className="w-10 h-10 md:w-14 md:h-14 bg-white/5 text-white/60 rounded-xl flex items-center justify-center border border-white/10 cursor-not-allowed"><Mic size={18} /></button>
              <button aria-label="Toggle camera" disabled title="Controlled by your proctor" className="w-10 h-10 md:w-14 md:h-14 bg-white/5 text-white/60 rounded-xl flex items-center justify-center border border-white/10 cursor-not-allowed"><Video size={18} /></button>
              <button aria-label="End call" disabled title="Controlled by your proctor" className="w-10 h-10 md:w-14 md:h-14 bg-red-600/10 text-red-500/60 rounded-xl flex items-center justify-center border border-red-600/20 cursor-not-allowed"><PhoneOff size={18} /></button>
              <p className="text-[10px] text-gray-400 text-center leading-snug hidden md:block" aria-hidden="true">
                Controlled by
                <br />
                your proctor
              </p>
            </div>
          </div>
        </div>

        <StudentSplitPaneResizer
          isTabletMode={false}
          leftWidth={leftWidth}
          onDividerPointerDown={handleDrag}
          onDividerKeyDown={handleKeyboardResize}
          ariaLabel="Resize speaking camera and questions panels"
          testId="speaking-pane-resizer"
        />

        <div style={{ width: `calc(${100 - leftWidth}% - 16px)` }} className="h-full flex flex-col relative p-4 md:p-6 lg:p-8 bg-gray-50 overflow-y-auto no-scrollbar min-w-[280px] md:min-w-[320px] pb-20 md:pb-24">
          <div className="max-w-xl mx-auto w-full h-full flex flex-col">
            <div className="mb-8 md:mb-12">
              <h2 className="text-xs md:text-sm font-bold text-blue-600 uppercase tracking-wide mb-3 md:mb-4">Exam Progression</h2>
              <div className="flex gap-1.5 md:gap-2">
                {speakingConfig.parts.map((p, idx) => (
                  <div 
                    key={p.id} 
                    className={`h-1.5 md:h-2 flex-1 rounded-full transition-all duration-500 ${idx === activePartIndex ? 'bg-blue-600 shadow-md shadow-blue-100' : idx < activePartIndex ? 'bg-green-500' : 'bg-gray-200'}`}
                  ></div>
                ))}
              </div>
            </div>

            {activePartIndex === 0 && (
              <div className="flex-1 flex flex-col justify-center animate-in fade-in slide-in-from-bottom-8 duration-500">
                <h2 className="text-2xl md:text-4xl font-black text-gray-900 mb-6 md:mb-8 leading-tight">{currentPart?.label}</h2>
                <div className="space-y-4 md:space-y-6 text-base md:text-xl text-gray-600 leading-relaxed font-medium">
                  <p>The examiner will introduce themselves and ask you general questions about yourself and familiar topics like home, family, work, studies, and interests.</p>
                  <div className="p-4 md:p-8 bg-white border border-gray-200 rounded-xl shadow-md">
                    <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-3 md:mb-4">Current Topic</p>
                    <div className="flex flex-wrap gap-2 md:gap-3">
                      {state.speaking.part1Topics.map(t => (
                        <span key={t} className="px-3 md:px-4 py-1.5 md:py-2 bg-blue-50 text-blue-700 rounded-xl font-bold border border-blue-100 text-sm md:text-base">{t}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <button 
                  onClick={goToNextPart}
                  className="mt-8 md:mt-12 w-full py-4 md:py-5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-lg md:text-xl transition-all shadow-md"
                >
                  Proceed to Next Part
                </button>
              </div>
            )}

            {activePartIndex === 1 && (
              <div className="flex-1 flex flex-col animate-in fade-in slide-in-from-bottom-8 duration-500">
                <h2 className="text-2xl md:text-4xl font-black text-gray-900 mb-6 md:mb-8 leading-tight">{currentPart?.label}</h2>
                
                <div className="bg-white border border-blue-600 rounded-xl p-6 md:p-10 mb-6 md:mb-10 shadow-xl relative overflow-hidden">
                  <h3 className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-4 md:mb-6 relative">Prompt / Cue Card</h3>
                  <div className="relative">
                    <div className="prose prose-base md:prose-lg max-w-none whitespace-pre-wrap text-lg md:text-2xl font-bold text-gray-900 leading-relaxed italic">
                      {cueCardDetails?.topic || state.speaking.cueCard}
                    </div>
                    {(cueCardDetails?.bullets ?? []).filter(Boolean).length > 0 && (
                      <ul className="mt-5 space-y-3 text-base md:text-lg font-medium text-gray-700">
                        {cueCardDetails?.bullets.filter(Boolean).map((bullet) => (
                          <li key={bullet} className="flex gap-3">
                            <span>•</span>
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {cueCardDetails?.timeAllocation && (
                      <div className="mt-5 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">
                        {cueCardDetails.timeAllocation}
                      </div>
                    )}
                  </div>
                </div>

                {isPrep && (
                  <div className="bg-gray-900 rounded-xl p-6 md:p-10 text-center shadow-xl transform scale-105">
                    <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4 md:mb-6">Preparation Timer</h3>
                    <div role="timer" aria-label="Preparation time remaining" className="text-5xl md:text-6xl font-bold mb-6 md:mb-8 text-white tracking-tight tabular-nums">{formatTime(prepTime)}</div>
                    <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden mb-6 md:mb-10">
                      <div className="bg-blue-500 h-full transition-all duration-1000 ease-linear" style={{ width: `${(prepTime / currentPart.prepTime) * 100}%` }}></div>
                    </div>
                    <button 
                      onClick={() => { setIsPrep(false); setIsSpeaking(true); }}
                      className="px-8 md:px-12 py-3 md:py-4 bg-white text-gray-900 rounded-lg text-base md:text-lg font-bold hover:bg-gray-100 transition-all shadow-md"
                    >
                      I'm Ready to Speak Now
                    </button>
                  </div>
                )}

                {isSpeaking && (
                  <div className="bg-green-600 rounded-xl p-6 md:p-10 text-center shadow-xl group">
                    <p className="sr-only" role="status">
                      Speaking time has started.
                    </p>
                    <h3 className="text-xs font-semibold text-green-100 uppercase tracking-wide mb-4 md:mb-6">Speaking Duration</h3>
                    <div role="timer" aria-label="Speaking time" className="text-5xl md:text-6xl font-bold mb-6 md:mb-8 text-white tracking-tight tabular-nums">{formatTime(speakTime)}</div>
                    <div className="w-full bg-white/20 h-2 rounded-full overflow-hidden mb-6 md:mb-10">
                      <div className="bg-white h-full transition-all duration-1000 ease-linear" style={{ width: `${Math.min((speakTime / currentPart.speakingTime) * 100, 100)}%` }}></div>
                    </div>
                    <p className="text-green-100 font-bold mb-6 md:mb-10 text-sm md:text-base">
                      {timeUp
                        ? 'Time for this part is up. Move on when you are ready.'
                        : 'Keep speaking until the examiner stops you.'}
                    </p>
                    <button 
                      onClick={goToNextPart}
                      className="w-full py-4 md:py-5 bg-white text-green-700 hover:bg-green-50 rounded-lg font-bold text-lg md:text-xl transition-all"
                    >
                      {activePartIndex < speakingConfig.parts.length - 1
                        ? `Move to ${speakingConfig.parts[activePartIndex + 1]?.label ?? 'Next Part'}`
                        : 'Complete Interview'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {activePartIndex === 2 && (
              <div className="flex-1 flex flex-col justify-center animate-in fade-in slide-in-from-bottom-8 duration-500">
                <h2 className="text-2xl md:text-4xl font-black text-gray-900 mb-6 md:mb-8 leading-tight">{currentPart?.label}</h2>
                <div className="p-6 md:p-10 bg-white border border-gray-200 shadow-xl rounded-xl text-left">
                  <h3 className="text-xs font-semibold text-green-600 uppercase tracking-wide mb-4 md:mb-6">Advanced Discussion Topics</h3>
                  <ul className="space-y-4 md:space-y-6">
                    {state.speaking.part3Discussion.map((topic, i) => (
                      <li key={i} className="flex gap-3 md:gap-4 group">
                        <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-green-50 text-green-600 flex items-center justify-center font-bold flex-shrink-0 group-hover:bg-green-600 group-hover:text-white transition-all text-sm md:text-base">
                          {i + 1}
                        </div>
                        <p className="text-base md:text-xl font-bold text-gray-800 leading-snug">{topic}</p>
                      </li>
                    ))}
                  </ul>
                </div>
                {confirmComplete ? (
                  <div className="mt-8 md:mt-12 w-full rounded-xl border border-gray-200 bg-white p-4 md:p-6 shadow-md">
                    <p className="text-center text-sm font-semibold text-gray-700 mb-4">
                      Are you sure? This will finish your speaking interview.
                    </p>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setConfirmComplete(false)}
                        className="flex-1 py-3 md:py-4 bg-white border border-gray-300 text-gray-800 rounded-lg font-bold text-base md:text-lg hover:bg-gray-50 transition-all"
                      >
                        Keep Speaking
                      </button>
                      <button
                        onClick={onSubmit}
                        className="flex-1 py-3 md:py-4 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold text-base md:text-lg transition-all shadow-md"
                      >
                        Complete Interview
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmComplete(true)}
                    className="mt-8 md:mt-12 w-full py-4 md:py-6 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold text-lg md:text-2xl transition-all shadow-md"
                  >
                    Complete Examination
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="absolute bottom-16 md:bottom-20 right-4 md:right-6 flex shadow-md z-20">
            <button
              aria-label="Previous part"
              disabled={!hasPrev}
              onClick={() => goToPart(currentIndex - 1)}
              className={`w-9 h-9 md:w-10 md:h-10 lg:w-12 lg:h-12 flex items-center justify-center transition-colors disabled:cursor-not-allowed ${hasPrev ? 'bg-gray-900 hover:bg-gray-800 text-white' : 'bg-gray-100 text-gray-300'}`}
            >
              <ArrowLeft size={16} strokeWidth={2} />
            </button>
            <button
              aria-label="Next part"
              disabled={!hasNext}
              onClick={() => goToPart(currentIndex + 1)}
              className={`w-9 h-9 md:w-10 md:h-10 lg:w-12 lg:h-12 flex items-center justify-center transition-colors disabled:cursor-not-allowed ${hasNext ? 'bg-gray-900 hover:bg-gray-800 text-white' : 'bg-gray-100 text-gray-300'}`}
            >
              <ArrowRight size={16} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

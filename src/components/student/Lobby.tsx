import React from 'react';
import { Play, Clock } from 'lucide-react';
import { Button } from '../ui/Button';
import { ExamState } from '../../types';

interface LobbyProps {
  state: ExamState;
  onStart: () => void;
  onExit: () => void;
}

export function Lobby({ state, onStart, onExit }: LobbyProps) {
  void onExit;

  const enabledModules = Object.values(state.config.sections)
    .filter(s => s.enabled)
    .sort((a, b) => a.order - b.order);
  
  const totalDuration = enabledModules.reduce((acc, s) => acc + s.duration, 0);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen w-full bg-gray-50 p-3 sm:p-4 md:p-6 lg:p-8">
      <div className="bg-white rounded-sm shadow-[0_8px_24px_rgba(9,30,66,0.08)] max-w-2xl w-full overflow-hidden border border-gray-100 flex flex-col max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3rem)] md:max-h-[calc(100vh-4rem)] lg:max-h-[calc(100vh-5rem)]">

        <div className="p-3 sm:p-4 md:p-6 lg:p-10 space-y-3 sm:space-y-4 md:space-y-6 lg:space-y-8 overflow-y-auto flex-1">
          <div className="flex gap-1.5 sm:gap-2 md:gap-3 p-2 sm:p-3 md:p-4 bg-gray-50 border border-gray-100 rounded-sm items-center">
            <div className="bg-purple-100 text-purple-900 p-1 sm:p-1.5 md:p-2 rounded-sm h-fit flex-shrink-0">
              <Clock size={14} />
            </div>
            <div className="flex-1">
              <p className="text-[9px] sm:text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-0.5 sm:mb-1">Total Duration</p>
              <p className="text-[10px] sm:text-xs md:text-sm font-black text-gray-900 leading-tight">{Math.floor(totalDuration / 60)}h {totalDuration % 60}m</p>
            </div>
          </div>

          <div className="space-y-2 sm:space-y-3">
            <p className="text-[9px] sm:text-[10px] font-bold text-gray-500 uppercase tracking-widest">Section Durations</p>
            <div className="space-y-1.5 sm:space-y-2">
              {enabledModules.map((module) => (
                <div key={module.label} className="flex justify-between items-center p-1.5 sm:p-2 bg-white border border-gray-100 rounded-sm">
                  <span className="text-[10px] sm:text-xs md:text-sm font-bold text-gray-900 capitalize">{module.label}</span>
                  <span className="text-[10px] sm:text-xs md:text-sm font-bold text-blue-800">{module.duration} min</span>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2 sm:space-y-3 md:space-y-4">
            <p className="text-[9px] sm:text-[10px] md:text-xs font-black text-gray-600 uppercase tracking-[0.15em]">Candidate Instructions</p>
            <div className="bg-gray-50 border border-gray-100 rounded-sm p-2 sm:p-3 md:p-4 lg:p-6 text-[10px] sm:text-xs md:text-sm text-gray-700 leading-relaxed max-h-32 sm:max-h-40 md:max-h-48 overflow-y-auto no-scrollbar italic whitespace-pre-wrap">
              {state.config.general.instructions || "No specific instructions provided. Please follow the rules for each section."}
            </div>
          </div>

          <div className="pt-2 sm:pt-3 md:pt-4 space-y-2 sm:space-y-3 md:space-y-4">
            <Button 
              variant="primary" 
              size="lg" 
              fullWidth 
              leftIcon={<Play size={16} strokeWidth={3} />}
              onClick={onStart}
              className="py-3 sm:py-4 md:py-5 text-sm sm:text-base md:text-lg font-black shadow-[0_8px_16px_rgba(0,82,204,0.2)] tracking-tight"
            >
              Start Exam
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}

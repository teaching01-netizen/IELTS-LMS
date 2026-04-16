import React from 'react';
import {
  BookOpen,
  Headphones,
  PenTool,
  MessageCircle,
} from 'lucide-react';
import { ExamState, ModuleType } from '../types';

type ExamStateUpdate = ExamState | ((previous: ExamState) => ExamState);

export function Sidebar({
  state,
  setState,
}: {
  state: ExamState;
  setState: (next: ExamStateUpdate) => void | Promise<void>;
}) {
  const modules = [
    { 
      id: 'listening' as ModuleType, 
      icon: Headphones, 
      label: state.config.sections.listening.label, 
      color: 'text-blue-500',
      shortcut: '1'
    },
    { 
      id: 'reading' as ModuleType, 
      icon: BookOpen, 
      label: state.config.sections.reading.label, 
      color: 'text-emerald-500',
      shortcut: '2'
    },
    { 
      id: 'writing' as ModuleType, 
      icon: PenTool, 
      label: state.config.sections.writing.label, 
      color: 'text-amber-500',
      shortcut: '3'
    },
    { 
      id: 'speaking' as ModuleType, 
      icon: MessageCircle, 
      label: state.config.sections.speaking.label, 
      color: 'text-red-500',
      shortcut: '4'
    },
  ].filter(m => state.config.sections[m.id].enabled)
   .sort((a, b) => state.config.sections[a.id].order - state.config.sections[b.id].order);

  return (
    <div className="w-56 bg-gray-50 border-r border-gray-100 flex flex-col h-full flex-shrink-0 shadow-sm">
      <div className="p-4 pt-6">
        <div className="flex items-center gap-3 px-2 mb-6">
          <div className="w-8 h-8 bg-blue-800 rounded-sm flex items-center justify-center text-white font-bold text-xs shadow-md shadow-blue-100">IB</div>
          <div>
            <h1 className="font-bold text-sm text-gray-900 leading-tight">IELTS Builder</h1>
            <p className="text-[10px] text-gray-500 font-bold tracking-widest uppercase">Content Authoring</p>
          </div>
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto px-2 pb-4 no-scrollbar">
        <div className="space-y-1">
          {modules.map(mod => {
            const isActive = state.activeModule === mod.id;
            const Icon = mod.icon;

            return (
              <button
                key={mod.id}
                onClick={() => setState({ ...state, activeModule: mod.id })}
                className={`w-full flex items-center px-3 py-3 text-sm font-semibold transition-all rounded-md group relative ${
                  isActive 
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-100' 
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon 
                  size={18} 
                  className={`transition-colors ${
                    isActive ? 'text-white' : mod.color + ' group-hover:text-gray-900'
                  }`} 
                />
                <span className="flex-1 text-left ml-3">{mod.label}</span>
                {isActive && (
                  <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-600 rounded-r-full" />
                )}
                <span className={`text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-opacity ${
                  isActive ? 'text-white/70' : 'text-gray-400'
                }`}>
                  ⌘{mod.shortcut}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

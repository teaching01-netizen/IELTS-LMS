import React from 'react';
import { Save, ArrowLeft, ArrowRight } from 'lucide-react';
import type { ExamState } from '../types';

type ExamStateUpdate = ExamState | ((previous: ExamState) => ExamState);

interface HeaderProps {
  state: ExamState;
  onUpdateState: (nextState: ExamStateUpdate) => void | Promise<void>;
  onReturnToAdmin: () => void;
  onNavigateToConfig: () => void;
  onNavigateToReview: () => void;
  onSaveDraft?: (() => void) | undefined;
  saveStatusLabel?: string | undefined;
}

export function Header({
  state,
  onUpdateState,
  onReturnToAdmin,
  onNavigateToConfig,
  onNavigateToReview,
  onSaveDraft,
  saveStatusLabel = 'All changes saved',
}: HeaderProps) {
  return (
    <header className="h-14 border-b border-gray-100 bg-white flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-4">
        <button
          onClick={onNavigateToConfig}
          className="p-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
          aria-label="Return to config"
        >
          <ArrowLeft size={18} />
        </button>
        <input
          type="text"
          value={state.title}
          onChange={(event) => {
            void onUpdateState({ ...state, title: event.target.value });
          }}
          className="font-semibold text-lg text-gray-900 outline-none border-b border-transparent hover:border-gray-200 focus:border-blue-700 bg-transparent px-1 transition-colors rounded-md"
          aria-label="Exam title"
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500 font-medium">{saveStatusLabel}</span>
        {onSaveDraft && (
          <button
            onClick={onSaveDraft}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
            aria-label="Save draft"
          >
            <Save size={18} />
          </button>
        )}
        <button
          onClick={onReturnToAdmin}
          className="bg-gray-800 hover:bg-gray-900 text-white px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2 shadow-sm"
        >
          Admin Portal
        </button>
        <button
          onClick={onNavigateToReview}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2 shadow-sm"
        >
          Finish & Review <ArrowRight size={16} />
        </button>
      </div>
    </header>
  );
}

import React from 'react';
import { Save, ArrowLeft, ArrowRight, Eye } from 'lucide-react';
import type { ExamState } from '../types';

type ExamStateUpdate = ExamState | ((previous: ExamState) => ExamState);

interface HeaderProps {
  state: ExamState;
  onUpdateState: (nextState: ExamStateUpdate) => void | Promise<void>;
  onReturnToAdmin: () => void;
  onNavigateToConfig: () => void;
  onNavigateToReview: () => void;
  onOpenPreview?: (() => void) | undefined;
  onLoadSampleExam?: (() => void) | undefined;
  onSaveDraft?: (() => void) | undefined;
  saveStatusLabel?: string | undefined;
}

export function Header({
  state,
  onUpdateState,
  onReturnToAdmin,
  onNavigateToConfig,
  onNavigateToReview,
  onOpenPreview,
  onLoadSampleExam,
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
            const title = event.target.value;
            void onUpdateState({
              ...state,
              title,
              config: {
                ...state.config,
                general: {
                  ...state.config.general,
                  title,
                },
              },
            });
          }}
          className="font-semibold text-lg text-gray-900 outline-none border-b border-transparent hover:border-gray-200 focus:border-blue-700 bg-transparent px-1 transition-colors rounded-md"
          aria-label="Exam title"
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500 font-medium">{saveStatusLabel}</span>
        {onLoadSampleExam && (
          <button
            onClick={onLoadSampleExam}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-800 transition-colors"
            aria-label="Load Academic sample exam"
            title="Replaces Listening/Reading/Writing with an IELTS-style Academic sample."
            type="button"
          >
            Load Sample
          </button>
        )}
        {onSaveDraft && (
          <button
            onClick={onSaveDraft}
            className="p-2 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
            aria-label="Save draft"
          >
            <Save size={18} />
          </button>
        )}
        {onOpenPreview ? (
          <button
            onClick={onOpenPreview}
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-800 transition-colors inline-flex items-center gap-2"
            aria-label="Preview exam"
            title="Open student preview in a new tab"
            type="button"
          >
            <Eye size={16} />
            Preview
          </button>
        ) : null}
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

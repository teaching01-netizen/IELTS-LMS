import React, { useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { WritingTaskConfig } from '../../types';

interface WritingTaskNavigatorProps {
  tasks: WritingTaskConfig[];
  writingAnswers: Record<string, string>;
  currentQuestionId: string | null;
  onNavigate: (id: string) => void;
  onClose: () => void;
}

function canonicalizeWritingTaskId(taskId: string): string {
  return taskId.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function countWords(text: string | undefined): number {
  if (typeof text !== 'string') {
    return 0;
  }
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

export function WritingTaskNavigator({
  tasks,
  writingAnswers,
  currentQuestionId,
  onNavigate,
  onClose,
}: WritingTaskNavigatorProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog.open) {
        dialog.close();
      }
      queueMicrotask(() => previousActiveElementRef.current?.focus());
    };
  }, []);

  const answeredCount = tasks.filter((task) => countWords(writingAnswers[task.id]) > 0).length;

  const dialog = (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] flex flex-col p-0 backdrop:bg-black/50"
      aria-labelledby="writing-task-navigator-title"
      aria-modal="true"
    >
      <div className="flex items-center justify-between p-3 md:p-4 border-b border-gray-200">
        <h2 id="writing-task-navigator-title" className="text-base md:text-lg font-bold text-gray-900">
          Task Navigator
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="student-touch-target flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100"
          aria-label="Close task navigator"
        >
          <X size={18} />
        </button>
      </div>

      <div className="p-3 md:p-4 border-b border-gray-100 bg-gray-50 text-xs md:text-sm">
        <span className="font-medium text-gray-700">
          {answeredCount} of {tasks.length} tasks answered
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-5 space-y-3">
        {tasks.length === 0 ? (
          <p className="text-sm text-gray-500">No writing tasks configured.</p>
        ) : (
          tasks.map((task, index) => {
            const wordCount = countWords(writingAnswers[task.id]);
            const hasResponse = wordCount > 0;
            const isCurrent =
              typeof currentQuestionId === 'string' &&
              currentQuestionId.trim() !== '' &&
              (task.id === currentQuestionId ||
                canonicalizeWritingTaskId(task.id) ===
                  canonicalizeWritingTaskId(currentQuestionId));

            const rowClassName = isCurrent
              ? 'border-blue-800 bg-blue-50'
              : 'border-gray-200 bg-white hover:bg-gray-50';
            const numberSquareClassName = isCurrent
              ? 'bg-blue-800 text-white'
              : 'bg-gray-100 text-gray-700';
            const statusClassName = hasResponse
              ? 'bg-green-100 text-green-900'
              : 'bg-gray-100 text-gray-500';

            return (
              <button
                key={task.id}
                type="button"
                onClick={() => {
                  onNavigate(task.id);
                  onClose();
                }}
                className={`w-full flex items-center gap-3 rounded-md border p-3 text-left transition-colors ${rowClassName}`}
              >
                <span
                  className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-sm font-bold ${numberSquareClassName}`}
                >
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-gray-900">{task.label}</span>
                  <span className="block text-[length:var(--student-meta-font-size)] font-medium text-gray-500">
                    {hasResponse ? `${wordCount} words` : 'No response yet'}
                  </span>
                </span>
                <span
                  className={`flex-shrink-0 rounded-sm px-2 py-1 text-[length:var(--student-meta-font-size)] font-bold ${statusClassName}`}
                >
                  {hasResponse ? 'Answered' : 'Unanswered'}
                </span>
              </button>
            );
          })
        )}
      </div>
    </dialog>
  );

  return typeof document === 'undefined' ? null : createPortal(dialog, document.body);
}

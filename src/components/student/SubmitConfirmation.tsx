import React from 'react';
import { AlertTriangle, CheckCircle, X } from 'lucide-react';
import { Button } from '../ui/Button';

interface SubmitConfirmationProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  answeredCount: number;
  totalQuestions: number;
  flaggedCount: number;
  timeRemaining?: number | undefined;
  unansweredSubmissionPolicy?: 'allow' | 'confirm' | 'block' | undefined;
}

export function SubmitConfirmation({ 
  isOpen, 
  onClose, 
  onConfirm, 
  answeredCount, 
  totalQuestions, 
  flaggedCount,
  timeRemaining,
  unansweredSubmissionPolicy = 'confirm',
}: SubmitConfirmationProps) {
  if (!isOpen) return null;

  const unansweredCount = totalQuestions - answeredCount;
  const hasUnanswered = unansweredCount > 0;
  const hasFlagged = flaggedCount > 0;
  const hardBlocksUnanswered = unansweredSubmissionPolicy === 'block';
  const canSubmit = !(hardBlocksUnanswered && hasUnanswered);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="absolute inset-0 bg-black/50 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-gray-200">
          <div className="flex items-center gap-2 md:gap-3">
            {hasUnanswered ? (
              <div className="p-1.5 md:p-2 bg-amber-100 rounded-lg">
                <AlertTriangle size={20} className="text-amber-600" />
              </div>
            ) : (
              <div className="p-1.5 md:p-2 bg-green-100 rounded-lg">
                <CheckCircle size={20} className="text-green-600" />
              </div>
            )}
            <h2 className="text-lg md:text-xl font-bold text-gray-900">
              {hasUnanswered ? 'Confirm Submission' : 'Ready to Submit?'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 md:p-2 text-gray-500 hover:bg-gray-100 rounded-md transition-colors">
            <X size={18} />
          </button>
        </div>
        
        <div className="p-4 sm:p-6 space-y-3 md:space-y-4">
          {hasUnanswered && (
            <div className={`p-4 border rounded-lg ${hardBlocksUnanswered ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-start gap-3">
                <AlertTriangle size={20} className={`${hardBlocksUnanswered ? 'text-red-700' : 'text-amber-600'} flex-shrink-0 mt-0.5`} />
                <div>
                  <p className={`font-semibold mb-1 ${hardBlocksUnanswered ? 'text-red-900' : 'text-amber-900'}`}>
                    You have {unansweredCount} unanswered question{unansweredCount !== 1 ? 's' : ''}
                  </p>
                  {hardBlocksUnanswered ? (
                    <p className="text-sm text-red-800">
                      You must answer all questions before submitting this section.
                    </p>
                  ) : (
                    <p className="text-sm text-amber-800">
                      Are you sure you want to submit? You cannot change your answers after submission.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {!hasUnanswered && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-start gap-3">
                <CheckCircle size={20} className="text-green-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-green-900 mb-1">
                    All questions answered!
                  </p>
                  <p className="text-sm text-green-800">
                    You've answered all {totalQuestions} questions in this section.
                  </p>
                </div>
              </div>
            </div>
          )}

          {hasFlagged && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Note:</strong> You have {flaggedCount} flagged question{flaggedCount !== 1 ? 's' : ''} that you may want to review before submitting.
              </p>
            </div>
          )}

          {timeRemaining !== undefined && timeRemaining > 0 && (
            <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
              <span>Time remaining:</span>
              <span className="font-mono font-bold">{formatTime(timeRemaining)}</span>
            </div>
          )}

          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Answered:</span>
              <span className="font-semibold text-gray-900">{answeredCount}/{totalQuestions}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Unanswered:</span>
              <span className={`font-semibold ${hasUnanswered ? 'text-amber-600' : 'text-gray-900'}`}>
                {unansweredCount}
              </span>
            </div>
            {hasFlagged && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Flagged:</span>
                <span className="font-semibold text-blue-600">{flaggedCount}</span>
              </div>
            )}
          </div>
        </div>

        <div className="p-4 sm:p-6 border-t border-gray-200 bg-gray-50 rounded-b-lg flex gap-2 md:gap-3">
          <Button
            variant="secondary"
            onClick={onClose}
            className="flex-1 text-sm md:text-base"
          >
            Review Answers
          </Button>
          <Button
            variant={hasUnanswered ? "danger" : "primary"}
            onClick={onConfirm}
            disabled={!canSubmit}
            className="flex-1 text-sm md:text-base"
          >
            Submit Section
          </Button>
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useRef } from 'react';
import { Dialog } from '../../../components/ui/Dialog';
import { CheckCircle2, Circle, AlertTriangle } from 'lucide-react';
import type { PublishReadiness } from '../../../types/domain';

interface PublishConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: 'publish' | 'republish';
  requireSchedule?: boolean;
  onConfirm: () => Promise<void>;
  onSetSchedule: () => void;
  prerequisites: {
    validationPassed: boolean;
    contentReviewed: boolean;
    isScheduled: boolean;
  };
  exam: {
    title: string;
  };
}

export function PublishConfirmationModal({
  isOpen,
  onClose,
  mode = 'publish',
  requireSchedule = true,
  onConfirm,
  onSetSchedule,
  prerequisites,
  exam
}: PublishConfirmationModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  // Focus trap for modal
  useEffect(() => {
    if (!isOpen || !modalRef.current) {
      return;
    }

    // Store the previously focused element
    previousActiveElementRef.current = document.activeElement as HTMLElement;
    
    // Focus the first focusable element in the modal
    const firstInput = modalRef.current.querySelector('button') as HTMLButtonElement;
    if (firstInput) {
      firstInput.focus();
    }

    // Handle Tab key to trap focus within modal
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      
      const focusableElements = modalRef.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ) as NodeListOf<HTMLElement>;
      
      if (!focusableElements || focusableElements.length === 0) return;
      
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      
      if (!firstElement || !lastElement) return;
      
      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    // Handle ESC key to close modal
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleTab);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleTab);
      document.removeEventListener('keydown', handleEscape);
      // Restore focus to previously active element
      previousActiveElementRef.current?.focus();
    };
  }, [isOpen, onClose]);

  const allPrerequisitesMet =
    prerequisites.validationPassed &&
    prerequisites.contentReviewed &&
    (!requireSchedule || prerequisites.isScheduled);

  const modalTitle = mode === 'republish' ? 'Republish Exam' : 'Publish Exam';
  const confirmLabel = mode === 'republish' ? 'Confirm Republish' : 'Confirm Publish';

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={modalTitle}
      size="sm"
      footer={
        <>
          {requireSchedule && !prerequisites.isScheduled && (
            <button
              onClick={() => {
                onClose();
                onSetSchedule();
              }}
              className="px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            >
              Set Schedule
            </button>
          )}
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            disabled={!allPrerequisitesMet}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium text-gray-900 mb-3">Before publishing, confirm:</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              {prerequisites.validationPassed ? (
                <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" aria-hidden="true" />
              ) : (
                <Circle size={16} className="text-blue-400 flex-shrink-0" aria-hidden="true" />
              )}
              <span className={prerequisites.validationPassed ? 'text-gray-700' : 'text-gray-400'}>
                Technical validation passed
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {prerequisites.contentReviewed ? (
                <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" aria-hidden="true" />
              ) : (
                <Circle size={16} className="text-blue-400 flex-shrink-0" aria-hidden="true" />
              )}
              <span className={prerequisites.contentReviewed ? 'text-gray-700' : 'text-gray-400'}>
                You have reviewed content quality
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              {prerequisites.isScheduled ? (
                <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" aria-hidden="true" />
              ) : (
                <Circle size={16} className="text-blue-400 flex-shrink-0" aria-hidden="true" />
              )}
              <span className={prerequisites.isScheduled ? 'text-gray-700' : 'text-gray-400'}>
                Exam is scheduled
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-2 p-3 bg-amber-50 rounded-lg border border-amber-200">
          <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <p className="text-xs text-amber-900">
            <span className="font-semibold">Warning:</span> Publishing creates an immutable version. 
            You can still edit the draft, but students will take this published version.
          </p>
        </div>
      </div>
    </Dialog>
  );
}

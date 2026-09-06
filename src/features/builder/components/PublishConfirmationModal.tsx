import React, { useEffect, useRef, useState } from 'react';
import { Dialog } from '../../../components/ui/Dialog';
import { CheckCircle2, Circle, AlertTriangle, LoaderCircle } from 'lucide-react';
import type { PublishReadiness } from '../../../types/domain';

interface PublishConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: 'publish' | 'republish';
  requireSchedule?: boolean;
  onConfirm: () => Promise<void>;
  onSetSchedule: () => void;
  /** contentReviewed may be driven by the caller's checklist state; the modal additionally requires an explicit in-modal confirmation. */
  prerequisites: {
    validationPassed: boolean;
    contentReviewed: boolean;
    isScheduled: boolean;
  };
  /** Optional controlled confirmation (e.g. shared with the PublishActions checkbox). Uncontrolled when omitted. */
  contentReviewConfirmed?: boolean;
  onContentReviewChange?: (confirmed: boolean) => void;
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
  contentReviewConfirmed: controlledReviewConfirmed,
  onContentReviewChange,
  exam
}: PublishConfirmationModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [uncontrolledReviewConfirmed, setUncontrolledReviewConfirmed] = useState(false);
  const reviewConfirmed = controlledReviewConfirmed ?? uncontrolledReviewConfirmed;
  const setReviewConfirmed = onContentReviewChange ?? setUncontrolledReviewConfirmed;

  const handleConfirm = async () => {
    if (isPending) {
      return;
    }
    setIsPending(true);
    setPublishError(null);
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      setPublishError(
        error instanceof Error ? error.message : 'Could not publish the exam. Please try again.',
      );
    } finally {
      setIsPending(false);
    }
  };

  const handleClose = () => {
    if (isPending) {
      return;
    }
    onClose();
  };

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
      if (e.key === 'Escape' && !isPending) {
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
  }, [isOpen, onClose, isPending]);
  // BLOCK until every prerequisite is met AND the operator explicitly confirms
  // content review inside this modal. `prerequisites.contentReviewed` reflects the
  // caller's checklist state; the in-modal checkbox is the human attestation.
  const contentReviewAttested = prerequisites.contentReviewed && reviewConfirmed;
  const allPrerequisitesMet =
    prerequisites.validationPassed &&
    contentReviewAttested &&
    (!requireSchedule || prerequisites.isScheduled);
  const unmetReasons: string[] = [];
  if (!prerequisites.validationPassed) unmetReasons.push('technical validation must pass');
  if (!prerequisites.contentReviewed) unmetReasons.push('resolve readiness issues, then confirm content review');
  else if (!reviewConfirmed) unmetReasons.push('confirm you reviewed content quality below');
  if (requireSchedule && !prerequisites.isScheduled) unmetReasons.push('a schedule must be set');

  const modalTitle = mode === 'republish' ? 'Republish Exam' : 'Publish Exam';
  const confirmLabel = mode === 'republish' ? 'Confirm Republish' : 'Confirm Publish';
  const scheduleLabel = mode === 'republish' ? 'Reschedule' : 'Set Schedule';
  const checklistTitle = mode === 'republish' ? 'Before republishing, confirm:' : 'Before publishing, confirm:';
  const scheduleChecklistLabel = requireSchedule ? 'Exam is scheduled' : 'Exam is scheduled (optional)';

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={modalTitle}
      size="sm"
      footer={
        <>
          {(mode === 'republish' || (requireSchedule && !prerequisites.isScheduled)) && (
            <button
              disabled={isPending}
              onClick={() => {
                onClose();
                onSetSchedule();
              }}
              className="px-4 py-2 text-sm font-semibold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
            >
              {scheduleLabel}
            </button>
          )}
          <button
            disabled={isPending}
            onClick={handleClose}
            className="px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={!allPrerequisitesMet || isPending}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isPending ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : null}
            {isPending
              ? mode === 'republish'
                ? 'Republishing…'
                : 'Publishing…'
              : confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {publishError ? (
          <div
            role="alert"
            className="flex items-start gap-2 p-3 bg-red-50 rounded-lg border border-red-200 text-sm text-red-800"
          >
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span>{publishError}</span>
          </div>
        ) : null}
        <div>
          <p className="text-sm font-medium text-gray-900 mb-3">{checklistTitle}</p>
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
            <label className="flex items-start gap-2 text-sm cursor-pointer rounded-lg border border-slate-200 p-3 hover:border-slate-300">
              <input
                type="checkbox"
                checked={reviewConfirmed}
                onChange={(e) => setReviewConfirmed(e.target.checked)}
                disabled={!prerequisites.contentReviewed}
                className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Confirm you reviewed content quality"
              />
              <span>
                <span className={contentReviewAttested ? 'text-gray-700 font-medium' : 'text-gray-500'}>
                  You have reviewed content quality
                </span>
                <span className="block text-xs text-gray-500">
                  {prerequisites.contentReviewed
                    ? 'Check to attest answer key and content are reviewed.'
                    : 'Resolve readiness issues first — review cannot count until they pass.'}
                </span>
              </span>
            </label>
            <div className="flex items-center gap-2 text-sm">
              {prerequisites.isScheduled ? (
                <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0" aria-hidden="true" />
              ) : (
                <Circle size={16} className="text-blue-400 flex-shrink-0" aria-hidden="true" />
              )}
              <span
                className={
                  prerequisites.isScheduled || !requireSchedule
                    ? 'text-gray-700'
                    : 'text-gray-400'
                }
              >
                {scheduleChecklistLabel}
              </span>
            </div>
          </div>
        </div>

        {!allPrerequisitesMet && (
          <p role="status" className="text-xs text-slate-600">
            Confirm is blocked until {unmetReasons.join('; ')}.
          </p>
        )}

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

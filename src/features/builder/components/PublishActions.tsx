import React, { useState } from 'react';
import { Upload, Calendar, Lock, Unlock, Archive, CheckCircle2, Circle, ArrowRight, Edit } from 'lucide-react';
import type { PublishReadiness } from '../../../types/domain';
import { PublishConfirmationModal } from './PublishConfirmationModal';

interface PublishSuccessState {
  draftVersion: number;
  publishedVersion: number;
  scheduledDate?: string;
}

interface PublishActionsProps {
  canPublish: boolean;
  publishReadiness?: PublishReadiness;
  onPublish: (notes?: string) => void;
  onSchedulePublish: (scheduledTime: string) => void;
  onUnpublish: (reason?: string) => void;
  onArchive?: (() => void) | undefined;
  onNavigateToConfig?: () => void;
  onNavigateToBuilder?: () => void;
  onViewPublished?: () => void;
  onSetSchedule?: (() => void) | undefined;
  publishSuccess?: PublishSuccessState | null;
  exam?: {
    title: string;
  };
}

export function PublishActions({ 
  canPublish, 
  publishReadiness,
  onPublish, 
  onSchedulePublish, 
  onUnpublish, 
  onArchive,
  onNavigateToConfig,
  onNavigateToBuilder,
  onViewPublished,
  onSetSchedule,
  publishSuccess,
  exam
}: PublishActionsProps) {
  const [publishNotes, setPublishNotes] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const isValidationPassed = publishReadiness?.canPublish ?? false;
  const isContentReviewed = true; // This would be tracked by the system
  const isScheduled = scheduledTime.length > 0;

  const missingPrerequisites = [];
  if (!isValidationPassed) missingPrerequisites.push('Technical validation');
  if (!isContentReviewed) missingPrerequisites.push('Content review');
  if (!isScheduled) missingPrerequisites.push('Exam scheduling');

  const tooltipText = missingPrerequisites.length > 0 
    ? `Complete ${missingPrerequisites.join(', ')} first` 
    : 'Creates an immutable published version. Students take this version, not your draft.';

  // Show success state if publish was successful
  if (publishSuccess) {
    return (
      <div className="space-y-4" role="alert" aria-live="assertive">
        <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-xl border border-emerald-200">
          <CheckCircle2 size={24} className="text-emerald-600 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold text-emerald-900">Exam published successfully</p>
            <p className="text-xs text-emerald-700 mt-1">
              Created: Published v{publishSuccess.publishedVersion} (from Draft {publishSuccess.draftVersion})
            </p>
            <p className="text-xs text-emerald-700">
              Status: Published
            </p>
            {publishSuccess.scheduledDate && (
              <p className="text-xs text-emerald-700">
                Students can access: Starting {publishSuccess.scheduledDate}
              </p>
            )}
          </div>
        </div>

        <div className="p-3 bg-sky-50 rounded-lg border border-sky-100">
          <p className="text-xs text-sky-900">
            Draft remains editable. Create new published version when ready.
          </p>
        </div>

        <div className="flex gap-3">
          {onViewPublished && (
            <button
              onClick={onViewPublished}
              className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-all duration-200 shadow-sm hover:shadow-md flex items-center justify-center gap-2"
              aria-label="View published version"
            >
              <ArrowRight size={16} aria-hidden="true" /> View Published Version
            </button>
          )}
          <button
            onClick={() => {
              // Reset success state and continue editing
              setPublishNotes('');
              setShowSchedule(false);
            }}
            className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-all duration-200 flex items-center justify-center gap-2"
            aria-label="Continue editing draft"
          >
            <Edit size={16} aria-hidden="true" /> Continue Editing Draft
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        {/* Publish Readiness Checklist */}
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200" title="All items must be completed before publishing">
          <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-3">Publish Readiness</p>
          <div className="space-y-2">
            <div 
              className={`flex items-center gap-2 text-xs ${isValidationPassed ? 'text-slate-600' : 'text-slate-400'}`}
              onClick={!isValidationPassed ? onNavigateToBuilder : undefined}
              role={!isValidationPassed ? 'button' : undefined}
              tabIndex={!isValidationPassed ? 0 : undefined}
              title={!isValidationPassed ? 'Fix validation errors to enable publishing' : 'Technical validation passed'}
            >
              {isValidationPassed ? (
                <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" aria-hidden="true" />
              ) : (
                <Circle size={14} className="text-blue-400 flex-shrink-0" aria-hidden="true" />
              )}
              <span>Technical validation passed</span>
            </div>
            <div 
              className={`flex items-center gap-2 text-xs ${isContentReviewed ? 'text-slate-600' : 'text-slate-400'}`}
              onClick={!isContentReviewed ? onNavigateToBuilder : undefined}
              role={!isContentReviewed ? 'button' : undefined}
              tabIndex={!isContentReviewed ? 0 : undefined}
              title={!isContentReviewed ? 'Review content quality before publishing' : 'Content approved for publication'}
            >
              {isContentReviewed ? (
                <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" aria-hidden="true" />
              ) : (
                <Circle size={14} className="text-blue-400 flex-shrink-0" aria-hidden="true" />
              )}
              <span>Content approved {isContentReviewed ? '' : '(awaiting your review)'}</span>
            </div>
            <div 
              className={`flex items-center gap-2 text-xs ${isScheduled ? 'text-slate-600' : 'text-slate-400'}`}
              onClick={!isScheduled ? () => setShowSchedule(true) : undefined}
              role={!isScheduled ? 'button' : undefined}
              tabIndex={!isScheduled ? 0 : undefined}
              title={!isScheduled ? 'Set a schedule for when students can access the exam' : `Scheduled for ${scheduledTime}`}
            >
              {isScheduled ? (
                <CheckCircle2 size={14} className="text-emerald-600 flex-shrink-0" aria-hidden="true" />
              ) : (
                <Circle size={14} className="text-blue-400 flex-shrink-0" aria-hidden="true" />
              )}
              <span>Exam scheduled {isScheduled ? `(${scheduledTime})` : '(click to set date)'}</span>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Publish Notes</label>
          <textarea
            value={publishNotes}
            onChange={(e) => setPublishNotes(e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            rows={3}
            placeholder="Optional notes about this version..."
            aria-label="Publish notes"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setShowConfirmModal(true)}
            disabled={!canPublish}
            className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-all duration-200 shadow-sm hover:shadow-md disabled:bg-slate-300 disabled:cursor-not-allowed disabled:shadow-none"
            title={tooltipText}
            aria-label={canPublish ? 'Publish and schedule exam' : tooltipText}
          >
            Publish & Schedule
          </button>
          <button
            onClick={() => setShowSchedule(!showSchedule)}
            className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-all duration-200 flex items-center justify-center gap-2"
            aria-label="Toggle schedule options"
            aria-expanded={showSchedule}
          >
            <Calendar size={16} aria-hidden="true" /> Schedule
          </button>
        </div>

        {showSchedule && (
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Scheduled Time</label>
            <input
              type="datetime-local"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
              aria-label="Scheduled time"
            />
            <button
              onClick={() => onSchedulePublish(scheduledTime)}
              disabled={!scheduledTime}
              className="w-full px-4 py-2.5 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-all duration-200 shadow-sm hover:shadow-md disabled:bg-slate-300 disabled:cursor-not-allowed disabled:shadow-none"
              aria-label="Confirm schedule"
            >
              Confirm Schedule
            </button>
          </div>
        )}
      </div>

      <div className="pt-4 border-t border-slate-100 space-y-3">
        <button
          onClick={() => onUnpublish()}
          className="w-full px-4 py-2.5 bg-amber-50 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-100 transition-all duration-200 flex items-center justify-center gap-2 border border-amber-200"
          aria-label="Unpublish exam"
        >
          <Unlock size={16} aria-hidden="true" /> Unpublish
        </button>

        {onArchive && (
          <button
            onClick={() => onArchive}
            className="w-full px-4 py-2.5 bg-slate-50 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-100 transition-all duration-200 flex items-center justify-center gap-2 border border-slate-200"
            aria-label="Archive exam"
          >
            <Archive size={16} aria-hidden="true" /> Archive
          </button>
        )}
      </div>

      {/* Publish Confirmation Modal */}
      <PublishConfirmationModal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        onConfirm={async () => {
          onPublish(publishNotes);
          setShowConfirmModal(false);
        }}
        onSetSchedule={() => {
          setShowConfirmModal(false);
          setShowSchedule(true);
          onSetSchedule?.();
        }}
        prerequisites={{
          validationPassed: isValidationPassed,
          contentReviewed: isContentReviewed,
          isScheduled: isScheduled
        }}
        exam={exam || { title: 'Untitled Exam' }}
      />
    </div>
  );
}

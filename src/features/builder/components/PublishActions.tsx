import React, { useState } from 'react';
import { Archive, ArrowRight, Calendar, CheckCircle2, Circle, Edit, LoaderCircle, Unlock } from 'lucide-react';
import type { PublishReadiness } from '../../../types/domain';
import { PublishConfirmationModal } from './PublishConfirmationModal';

interface PublishSuccessState {
  draftVersion: number;
  publishedVersion: number;
  scheduledDate?: string;
  publishedLink?: string;
}

interface PublishActionsProps {
  canPublish: boolean;
  publishReadiness?: PublishReadiness;
  onPublish: (notes?: string) => Promise<void>;
  onRepublishLatestDraft?: () => Promise<{ success: boolean; error?: string } | void>;
  onSchedulePublish: (scheduledTime: string) => Promise<void>;
  scheduledTime?: string;
  onOpenSchedulingWorkflow?: (() => void) | undefined;
  onUnpublish: (reason?: string) => Promise<void>;
  onArchive?: (() => void) | undefined;
  onNavigateToConfig?: () => void;
  onNavigateToBuilder?: () => void;
  onViewPublished?: () => void;
  onSetSchedule?: (() => void) | undefined;
  publishSuccess?: PublishSuccessState | null;
  hasUnpublishedDraftChanges?: boolean;
  draftVersionNumber?: number | undefined;
  publishedVersionNumber?: number | undefined;
  exam?: {
    title: string;
  };
}

export function PublishActions({
  canPublish,
  publishReadiness,
  onPublish,
  onRepublishLatestDraft,
  onSchedulePublish,
  scheduledTime: scheduledTimeProp,
  onOpenSchedulingWorkflow,
  onUnpublish,
  onArchive,
  onNavigateToConfig,
  onNavigateToBuilder,
  onViewPublished,
  onSetSchedule,
  publishSuccess,
  hasUnpublishedDraftChanges = false,
  draftVersionNumber,
  publishedVersionNumber,
  exam,
}: PublishActionsProps) {
  const [publishNotes, setPublishNotes] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [isRepublishing, setIsRepublishing] = useState(false);
  const [republishError, setRepublishError] = useState<string | null>(null);
  const [isScheduling, setIsScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [isUnpublishing, setIsUnpublishing] = useState(false);
  const [unpublishError, setUnpublishError] = useState<string | null>(null);

  const confirmSchedule = async () => {
    if (isScheduling) {
      return;
    }
    setIsScheduling(true);
    setScheduleError(null);
    try {
      await onSchedulePublish(scheduledTime);
      setScheduledTime('');
      setShowSchedule(false);
    } catch (error) {
      setScheduleError(error instanceof Error ? error.message : 'Could not schedule the exam. Please try again.');
    } finally {
      setIsScheduling(false);
    }
  };

  const handleUnpublish = async () => {
    if (isUnpublishing) {
      return;
    }
    setIsUnpublishing(true);
    setUnpublishError(null);
    try {
      await onUnpublish();
    } catch (error) {
      setUnpublishError(error instanceof Error ? error.message : 'Could not unpublish the exam. Please try again.');
    } finally {
      setIsUnpublishing(false);
    }
  };

  const isValidationPassed = publishReadiness?.canPublish ?? false;
  const isContentReviewed = true;
  const usesSchedulingWorkflow = Boolean(onOpenSchedulingWorkflow);
  const effectiveScheduledTime = usesSchedulingWorkflow ? scheduledTimeProp ?? '' : scheduledTime;
  const isScheduled = effectiveScheduledTime.length > 0;

  const isPublished = Boolean(publishSuccess);
  const draftHasChanges = Boolean(hasUnpublishedDraftChanges);
  const scheduleRequired = !isPublished;

  const canPublishNow = canPublish && isValidationPassed && isScheduled;

  const statusLabel = !isPublished
    ? 'Not published yet'
    : draftHasChanges
      ? 'Published (draft has changes)'
      : 'Published (up to date)';

  const nextStepText = (() => {
    if (!isPublished) {
      if (!canPublish) return 'Next step: You do not have permission to publish this exam.';
      if (!isValidationPassed) return 'Next step: Fix technical validation issues.';
      if (!isScheduled) return 'Next step: Schedule when students can access the exam.';
      return 'Next step: Publish.';
    }

    if (draftHasChanges) {
      if (!canPublish) return 'Next step: You do not have permission to republish this exam.';
      return 'Next step: Republish using the latest draft (existing schedules will not change).';
    }

    return 'Up to date. Next step: Reschedule if you need to change access time.';
  })();

  const openScheduling = () => {
    if (usesSchedulingWorkflow) {
      onOpenSchedulingWorkflow?.();
      return;
    }
    setShowSchedule(true);
  };

  const renderStepper = (finalActionLabel: string, finalActionReady: boolean) => (
    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
      <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider mb-3">Next Steps</p>
      <ol className="space-y-2" aria-label="Publish steps">
        <li className="flex items-start gap-2">
          {isValidationPassed ? (
            <CheckCircle2 size={14} className="text-emerald-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
          ) : (
            <Circle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" aria-hidden="true" />
          )}
          <div>
            <p className={`text-xs font-medium ${isValidationPassed ? 'text-slate-700' : 'text-slate-600'}`}>
              1) Technical validation
            </p>
            {!isValidationPassed && (
              <p className="text-[11px] text-slate-500">Fix validation issues in the Builder to continue.</p>
            )}
          </div>
        </li>
        <li className="flex items-start gap-2">
          {isScheduled ? (
            <CheckCircle2 size={14} className="text-emerald-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
          ) : (
            <Circle size={14} className="text-blue-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
          )}
          <div>
            <p className={`text-xs font-medium ${isScheduled || !scheduleRequired ? 'text-slate-700' : 'text-slate-600'}`}>
              2) Schedule {scheduleRequired ? '' : '(optional)'}
            </p>
            {!isScheduled && (
              <p className="text-[11px] text-slate-500">
                {scheduleRequired ? 'Set an access time for students before publishing.' : 'Optional: set or adjust access time.'}
              </p>
            )}
          </div>
        </li>
        <li className="flex items-start gap-2">
          {finalActionReady ? (
            <CheckCircle2 size={14} className="text-emerald-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
          ) : (
            <Circle size={14} className="text-blue-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
          )}
          <div>
            <p className="text-xs font-medium text-slate-700">3) {finalActionLabel}</p>
            {!isPublished && !canPublishNow && (
              <p className="text-[11px] text-slate-500">
                {!canPublish ? 'Blocked: publish permission required.' : !isValidationPassed ? 'Blocked: validation must pass.' : !isScheduled ? 'Blocked: schedule must be set.' : 'Blocked.'}
              </p>
            )}
            {isPublished && draftHasChanges && !canPublish && (
              <p className="text-[11px] text-slate-500">Blocked: publish permission required.</p>
            )}
            {isPublished && !draftHasChanges && (
              <p className="text-[11px] text-slate-500">No draft changes requiring republish.</p>
            )}
          </div>
        </li>
      </ol>
    </div>
  );

  const handleRepublishLatestDraft = async () => {
    if (!onRepublishLatestDraft || isRepublishing) {
      return;
    }

    setRepublishError(null);
    setIsRepublishing(true);
    try {
      const result = await onRepublishLatestDraft();
      if (result && result.success === false) {
        setRepublishError(result.error ?? 'Could not republish. Existing schedules are unchanged.');
      }
    } catch {
      setRepublishError('Could not republish. Existing schedules are unchanged.');
    } finally {
      setIsRepublishing(false);
    }
  };

  if (publishSuccess) {
    const effectiveDraftVersion = draftVersionNumber ?? publishSuccess.draftVersion;
    const effectivePublishedVersion = publishedVersionNumber ?? publishSuccess.publishedVersion;

    return (
      <div className="space-y-6" role="alert" aria-live="assertive">
        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm ring-1 ring-slate-900/5 space-y-1">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</p>
          <p className="text-sm font-semibold text-slate-900">{statusLabel}</p>
          <p className="text-xs text-slate-600">{nextStepText}</p>
        </div>

        {renderStepper(
          hasUnpublishedDraftChanges ? 'Republish Latest Draft' : 'No content action needed',
          hasUnpublishedDraftChanges ? canPublish : true,
        )}

        <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-xl border border-emerald-200">
          <CheckCircle2 size={24} className="text-emerald-600 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold text-emerald-900">Exam published successfully</p>
            <p className="text-xs text-emerald-700 mt-1">
              Created: Published v{publishSuccess.publishedVersion} (from Draft {publishSuccess.draftVersion})
            </p>
            <p className="text-xs text-emerald-700">Status: Published</p>
            {publishSuccess.scheduledDate && (
              <p className="text-xs text-emerald-700">
                Students can access: Starting {publishSuccess.scheduledDate}
              </p>
            )}
          </div>
        </div>

        <div className="p-3 bg-sky-50 rounded-lg border border-sky-100">
          <p className="text-xs text-sky-900">
            Draft remains editable. Republish creates a new immutable published version; existing schedules are unchanged.
          </p>
        </div>

        {hasUnpublishedDraftChanges && (
          <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 space-y-3">
            <p className="text-xs text-amber-900">
              Draft v{effectiveDraftVersion} has changes not in Published v{effectivePublishedVersion}.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  void handleRepublishLatestDraft();
                }}
                disabled={!canPublish || isRepublishing}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-all duration-200 shadow-sm hover:shadow-md disabled:bg-slate-300 disabled:cursor-not-allowed disabled:shadow-none"
                title={
                  !canPublish
                    ? 'Publish permission required to republish.'
                    : 'Republishes using the latest draft. Existing schedules are unchanged.'
                }
                aria-label="Republish latest draft"
              >
                {isRepublishing ? 'Republishing…' : 'Republish'}
              </button>
              <button
                onClick={openScheduling}
                className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-all duration-200 flex items-center justify-center gap-2"
                aria-label="Reschedule"
              >
                <Calendar size={16} aria-hidden="true" /> Reschedule
              </button>
            </div>
            {republishError && (
              <p className="text-xs text-amber-900">
                {republishError}
              </p>
            )}
            {!canPublish && (
              <p className="text-xs text-amber-900">
                Republish is disabled until publish permission is granted.
              </p>
            )}
          </div>
        )}

        {!hasUnpublishedDraftChanges && (
          <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 space-y-3">
            <p className="text-xs text-emerald-900">
              Published version is up to date with the current draft.
            </p>
            <div className="flex gap-3">
              <button
                onClick={openScheduling}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-all duration-200 shadow-sm hover:shadow-md flex items-center justify-center gap-2"
              >
                <Calendar size={16} aria-hidden="true" /> Reschedule
              </button>
              {onViewPublished && (
                <button
                  onClick={onViewPublished}
                  className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-all duration-200 flex items-center justify-center gap-2"
                  aria-label="View published version"
                >
                  <ArrowRight size={16} aria-hidden="true" /> View Published
                </button>
              )}
            </div>
          </div>
        )}

        {publishSuccess.publishedLink && (
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2">
            <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Student Access Link</p>
            <div className="flex gap-2">
              <input
                readOnly
                value={publishSuccess.publishedLink}
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-700"
                aria-label="Published exam link"
              />
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(publishSuccess.publishedLink!);
                  setLinkCopied(true);
                  window.setTimeout(() => setLinkCopied(false), 1500);
                }}
                className="px-4 py-2.5 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-all duration-200"
                aria-label="Copy student link"
              >
                {linkCopied ? 'Copied' : 'Copy Link'}
              </button>
            </div>
          </div>
        )}

        {!usesSchedulingWorkflow && showSchedule && (
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
              onClick={() => void confirmSchedule()}
              disabled={!scheduledTime || isScheduling}
              className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-all duration-200 shadow-sm hover:shadow-md disabled:bg-slate-300 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-2"
              aria-label="Confirm schedule"
            >
              {isScheduling ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : null}
              {isScheduling ? 'Scheduling…' : 'Confirm Schedule'}
            </button>
            {scheduleError ? (
              <p role="alert" className="text-xs text-red-700">{scheduleError}</p>
            ) : null}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => {
              setPublishNotes('');
              setShowSchedule(false);
            }}
            className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-all duration-200 flex items-center justify-center gap-2"
            aria-label="Continue editing draft"
          >
            <Edit size={16} aria-hidden="true" /> Continue Editing Draft
          </button>
        </div>

        <div className="pt-4 border-t border-slate-100 space-y-3">
          <button
            onClick={() => void handleUnpublish()}
            disabled={isUnpublishing}
            className="w-full px-4 py-2.5 bg-amber-50 text-amber-700 rounded-lg text-sm font-medium hover:bg-amber-100 transition-all duration-200 flex items-center justify-center gap-2 border border-amber-200 disabled:opacity-60 disabled:cursor-not-allowed"
            aria-label="Unpublish exam"
          >
            {isUnpublishing ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Unlock size={16} aria-hidden="true" />}
            {isUnpublishing ? 'Unpublishing…' : <span>Unpublish</span>}
          </button>
          {unpublishError ? (
            <p role="alert" className="text-xs text-red-700">{unpublishError}</p>
          ) : null}

          {onArchive && (
            <button
              onClick={() => onArchive()}
              className="w-full px-4 py-2.5 bg-slate-50 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-100 transition-all duration-200 flex items-center justify-center gap-2 border border-slate-200"
              aria-label="Archive exam"
            >
              <Archive size={16} aria-hidden="true" /> Archive
            </button>
          )}
        </div>

        <PublishConfirmationModal
          isOpen={showConfirmModal}
          onClose={() => setShowConfirmModal(false)}
          mode="publish"
          requireSchedule={true}
          onConfirm={async () => {
            await onPublish(publishNotes);
          }}
          onSetSchedule={() => {
            setShowConfirmModal(false);
            if (usesSchedulingWorkflow) {
              onOpenSchedulingWorkflow?.();
            } else {
              setShowSchedule(true);
              onSetSchedule?.();
            }
          }}
          prerequisites={{
            validationPassed: isValidationPassed,
            contentReviewed: isContentReviewed,
            isScheduled,
          }}
          exam={exam || { title: 'Untitled Exam' }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm ring-1 ring-slate-900/5 space-y-1">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</p>
          <p className="text-sm font-semibold text-slate-900">{statusLabel}</p>
          <p className="text-xs text-slate-600">{nextStepText}</p>
        </div>

        {renderStepper('Publish', canPublishNow)}

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

        {!isScheduled ? (
          <div className="flex gap-3">
            <button
              onClick={openScheduling}
              className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-all duration-200 shadow-sm hover:shadow-md flex items-center justify-center gap-2"
            >
              <Calendar size={16} aria-hidden="true" /> Schedule
            </button>
            <button
              onClick={() => {
                setShowConfirmModal(true);
              }}
              disabled
              className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-500 rounded-lg text-sm font-medium cursor-not-allowed"
              title={!isValidationPassed ? 'Fix validation issues first.' : 'Set a schedule first.'}
              aria-label="Publish"
            >
              Publish
            </button>
          </div>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={() => {
                setShowConfirmModal(true);
              }}
              disabled={!canPublishNow}
              className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-all duration-200 shadow-sm hover:shadow-md disabled:bg-slate-300 disabled:cursor-not-allowed disabled:shadow-none"
              title={
                !canPublishNow
                  ? !canPublish
                    ? 'Publish permission required.'
                    : !isValidationPassed
                    ? 'Fix validation issues first.'
                    : 'Set a schedule first.'
                  : 'Creates an immutable published version from the current draft.'
              }
              aria-label="Publish"
            >
              Publish
            </button>
            <button
              onClick={openScheduling}
              className="flex-1 px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-all duration-200 flex items-center justify-center gap-2"
              aria-label="Reschedule"
            >
              <Calendar size={16} aria-hidden="true" /> Reschedule
            </button>
          </div>
        )}

        {!usesSchedulingWorkflow && showSchedule && (
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
              onClick={() => void confirmSchedule()}
              disabled={!scheduledTime || isScheduling}
              className="w-full px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-all duration-200 shadow-sm hover:shadow-md disabled:bg-slate-300 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-2"
              aria-label="Confirm schedule"
            >
              {isScheduling ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : null}
              {isScheduling ? 'Scheduling…' : 'Confirm Schedule'}
            </button>
            {scheduleError ? (
              <p role="alert" className="text-xs text-red-700">{scheduleError}</p>
            ) : null}
          </div>
        )}
      </div>

      <PublishConfirmationModal
        isOpen={showConfirmModal}
        onClose={() => setShowConfirmModal(false)}
        mode="publish"
        requireSchedule={true}
        onConfirm={async () => {
          await onPublish(publishNotes);
        }}
        onSetSchedule={() => {
          setShowConfirmModal(false);
          if (usesSchedulingWorkflow) {
            onOpenSchedulingWorkflow?.();
          } else {
            setShowSchedule(true);
            onSetSchedule?.();
          }
        }}
        prerequisites={{
          validationPassed: isValidationPassed,
          contentReviewed: isContentReviewed,
          isScheduled,
        }}
        exam={exam || { title: 'Untitled Exam' }}
      />
    </div>
  );
}

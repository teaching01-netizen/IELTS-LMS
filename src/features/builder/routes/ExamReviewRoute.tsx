import React from 'react';
import { useParams } from 'react-router-dom';
import { ScheduleSessionModal } from '@components/admin/ScheduleSessionModal';
import { ExamVersionHistory } from '@components/admin/ExamVersionHistory';
import { PublishActions } from '../components/PublishActions';
import { ValidationSummary } from '../components/ValidationSummary';
import { useReviewRouteController } from '../hooks/useReviewRouteController';
import { Exam } from '../../../types';
import { LoadingSurface } from '@components/ui';

export function ExamReviewRoute() {
  const { examId } = useParams<{ examId: string }>();
  const controller = useReviewRouteController(examId);
  const [showScheduleModal, setShowScheduleModal] = React.useState(false);

  if (controller.isLoading) {
    return <LoadingSurface label="Loading exam review…" />;
  }

  if (controller.error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-red-600">Error: {controller.error}</div>
      </div>
    );
  }

  const currentDraftVersion = controller.versions.find(
    (version) => version.id === controller.exam?.currentDraftVersionId,
  );
  const currentPublishedVersion = controller.versions.find(
    (version) => version.id === controller.exam?.currentPublishedVersionId,
  );
  const hasUnpublishedDraftChanges = (() => {
    const draftId = controller.exam?.currentDraftVersionId ?? null;
    if (!draftId || !currentPublishedVersion) {
      return false;
    }

    // Preferred signal: published version should reference the draft it was created from.
    if (currentPublishedVersion.parentVersionId) {
      return currentPublishedVersion.parentVersionId !== draftId;
    }

    // Legacy safety: if we can't trust parent linkage, fall back to version number mismatch.
    if (currentDraftVersion) {
      return currentDraftVersion.versionNumber !== currentPublishedVersion.versionNumber;
    }

    return false;
  })();
  const latestSchedule = [...controller.schedules]
    .sort((left, right) => new Date(right.startTime).getTime() - new Date(left.startTime).getTime())
    .find((schedule) => schedule.status === 'scheduled' || schedule.status === 'live' || schedule.status === 'completed');
  const scheduledTime = latestSchedule ? new Date(latestSchedule.startTime).toLocaleString() : '';
  const publishedLink =
    latestSchedule && typeof window !== 'undefined'
      ? `${window.location.origin}/student/${latestSchedule.id}/register`
      : latestSchedule
        ? `/student/${latestSchedule.id}/register`
        : undefined;
  const publishSuccess =
    controller.exam?.status === 'published' && currentPublishedVersion
      ? {
          draftVersion: currentDraftVersion?.versionNumber ?? currentPublishedVersion.versionNumber,
          publishedVersion: currentPublishedVersion.versionNumber,
          ...(scheduledTime ? { scheduledDate: scheduledTime } : {}),
          ...(publishedLink ? { publishedLink } : {}),
        }
      : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200 px-8 py-5 sticky top-0 z-10">
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Review & Publish</h1>
          <p className="text-sm text-slate-500 mt-1">{controller.exam?.title || 'Untitled Exam'}</p>
        </div>

        <div className="p-8 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm ring-1 ring-slate-900/5 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Validation Summary</h2>
              {controller.publishReadiness ? (
                <ValidationSummary publishReadiness={controller.publishReadiness} />
              ) : (
                <div className="space-y-3" role="status" aria-live="polite" aria-busy="true">
                  <span className="sr-only">Loading validation…</span>
                  <div className="h-4 w-40 rounded bg-slate-100 animate-pulse" />
                  <div className="h-3 w-full rounded bg-slate-50 animate-pulse" />
                  <div className="h-3 w-5/6 rounded bg-slate-50 animate-pulse" />
                  <div className="h-9 w-32 rounded bg-slate-100 animate-pulse" />
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm ring-1 ring-slate-900/5 p-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-4">Publish Actions</h2>
              {controller.publishReadiness ? (
                <PublishActions
                  canPublish={controller.publishReadiness.canPublish}
                  publishReadiness={controller.publishReadiness}
                  onPublish={controller.handlePublish}
                  onSchedulePublish={controller.handleSchedulePublish}
                  scheduledTime={scheduledTime}
                  onOpenSchedulingWorkflow={() => setShowScheduleModal(true)}
                  onUnpublish={controller.handleUnpublish}
                  publishSuccess={publishSuccess}
                  hasUnpublishedDraftChanges={hasUnpublishedDraftChanges}
                  draftVersionNumber={currentDraftVersion?.versionNumber}
                  publishedVersionNumber={currentPublishedVersion?.versionNumber}
                  exam={{ title: controller.exam?.title || 'Untitled Exam' }}
                />
              ) : (
                <div className="space-y-3" role="status" aria-live="polite" aria-busy="true">
                  <span className="sr-only">Loading actions…</span>
                  <div className="h-4 w-48 rounded bg-slate-100 animate-pulse" />
                  <div className="h-3 w-full rounded bg-slate-50 animate-pulse" />
                  <div className="flex gap-3 pt-2">
                    <div className="h-10 w-32 rounded bg-slate-100 animate-pulse" />
                    <div className="h-10 w-36 rounded bg-slate-100 animate-pulse" />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm ring-1 ring-slate-900/5 p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-4">Version History</h2>
            {controller.exam && (
              <ExamVersionHistory
                exam={controller.exam}
                versions={controller.versions}
                events={[]}
                onRestoreVersion={controller.handleRestoreVersion}
                onRepublishVersion={controller.handleRepublishVersion}
                onCompareVersions={async () => null}
              />
            )}
          </div>
        </div>

        {controller.exam && (
          <ScheduleSessionModal
            isOpen={showScheduleModal}
            exams={
              [
                {
                  id: controller.exam.id,
                  title: controller.exam.title,
                  type: controller.exam.type,
                  status: controller.exam.status === 'published' ? 'Published' : controller.exam.status === 'archived' ? 'Archived' : 'Draft',
                  author: controller.exam.owner,
                  lastModified: controller.exam.updatedAt,
                  createdAt: controller.exam.createdAt,
                  content: controller.state as Exam['content'],
                },
              ] satisfies Exam[]
            }
            examEntities={[controller.exam]}
            initialExamId={controller.exam.id}
            onClose={() => setShowScheduleModal(false)}
            onCreateSchedule={async (schedule) => {
              await controller.handleCreateSchedule(schedule);
            }}
          />
        )}

        <div className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-sm border-t border-slate-200 px-8 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <button
              onClick={controller.handleNavigateToBuilder}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              ← Back to Builder
            </button>
            <button
              onClick={controller.handleBackToAdmin}
              className="px-5 py-2.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-all duration-200"
            >
              Return to Admin
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, Clock, GitCompare } from 'lucide-react';
import { PublishActions } from '@builder/components/PublishActions';
import { ExamVersionHistory } from '@components/admin/ExamVersionHistory';
import { ErrorSurface, LoadingSurface } from '@components/ui';
import { useReviewRouteController } from '@builder/hooks/useReviewRouteController';
import type { ExamEvent, ExamSchedule, ExamVersionSummary, VersionDiff } from '../../../types/domain';

export function ExamReviewRoute() {
  const { examId } = useParams<{ examId: string }>();
  const navigate = useNavigate();
  const controller = useReviewRouteController(examId);
  const [events, setEvents] = useState<ExamEvent[]>([]);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);

  // Real audit events from the repository (not a placeholder empty list).
  useEffect(() => {
    let cancelled = false;
    if (!examId) {
      setEvents([]);
      return;
    }
    void (async () => {
      try {
        const loaded = await controller.loadEvents();
        if (!cancelled) {
          setEvents(loaded);
          setEventsError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setEvents([]);
          setEventsError(error instanceof Error ? error.message : 'Failed to load audit events.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examId]);

  // Real version diff via the lifecycle compare — no fabricated "no changes" copy.
  const handleCompareVersions = useCallback(async (versionIdA: string, versionIdB: string): Promise<VersionDiff | null> => {
    setCompareError(null);
    try {
      return await controller.compareVersions(versionIdA, versionIdB);
    } catch (error) {
      setCompareError(error instanceof Error ? error.message : 'Failed to compare versions.');
      return null;
    }
  }, [controller]);

  const handleRestoreVersion = useCallback(async (versionId: string) => {
    await controller.handleRestoreVersion(versionId);
  }, [controller]);

  const handleRepublishVersion = useCallback(async (versionId: string) => {
    await controller.handleRepublishVersion(versionId);
  }, [controller]);

  if (!examId) {
    return <ErrorSurface title="Missing exam id" description="Return to Admin and reopen this exam." actionLabel="Back to Admin" onAction={() => navigate('/admin')} />;
  }

  if (controller.isLoading) {
    return <LoadingSurface label="Loading review…" />;
  }

  if (controller.error) {
    return (
      <ErrorSurface
        title="Could not load review"
        description={controller.error}
        actionLabel="Retry"
        onAction={() => void controller.reload()}
      />
    );
  }

  if (!controller.exam) {
    return (
      <ErrorSurface
        title="Exam Not Found"
        description="The requested exam could not be loaded."
        actionLabel="Back to Admin"
        onAction={controller.handleBackToAdmin}
      />
    );
  }

  const versions: ExamVersionSummary[] = controller.versions;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Review &amp; Publish</h1>
          <p className="text-sm text-gray-500">{controller.exam.title}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => controller.handleNavigateToBuilder()}
            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Back to Builder
          </button>
          <button
            onClick={controller.handleBackToAdmin}
            className="px-4 py-2 text-sm bg-gray-900 text-white rounded-md hover:bg-black"
          >
            Admin
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        {controller.publishReadiness && (
          <section className="bg-white border border-gray-200 rounded-xl p-5" aria-label="Publish readiness">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3">Readiness</h2>
            {controller.publishReadiness.canPublish ? (
              <p className="flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2 size={16} /> Ready to publish.
              </p>
            ) : (
              <div className="text-sm text-amber-800">
                <p className="flex items-center gap-2 font-medium">
                  <XCircle size={16} /> Resolve before publishing:
                </p>
                <ul className="mt-2 space-y-1">
                  {controller.publishReadiness.errors.map((issue) => (
                    <li key={`${issue.field}:${issue.message}`}>
                      <button
                        type="button"
                        onClick={() => controller.handleNavigateToBuilder(issue.field)}
                        className="text-left underline decoration-amber-600/50 underline-offset-2 hover:text-amber-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 rounded"
                        title={`Go to ${issue.field}`}
                        aria-label={`Go to failing section: ${issue.field} — ${issue.message}`}
                      >
                        {issue.message}
                        <span className="ml-1 text-[11px] text-amber-700">({issue.field} →)</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-4 text-xs text-gray-500">
              Publishing is gated below: readiness must pass, then confirm in the Publish
              panel. Select a readiness issue to jump to the failing section.
            </p>
          </section>
        )}

        {eventsError && (
          <div role="alert" className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            {eventsError}
          </div>
        )}
        {compareError && (
          <div role="alert" className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
            {compareError}
          </div>
        )}

        <section className="bg-white border border-gray-200 rounded-xl p-5" aria-label="Schedules">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Clock size={16} /> Schedules ({controller.schedules.length})
          </h2>
          {controller.schedules.length === 0 ? (
            <p className="text-sm text-gray-500">No schedules yet. Publishing creates an immutable version; schedules pin to it.</p>
          ) : (
            <ul className="text-sm text-gray-700 space-y-1">
              {controller.schedules.map((schedule: ExamSchedule) => (
                <li key={schedule.id}>
                  {schedule.examTitle} · {schedule.cohortName} · opens {schedule.startTime}
                </li>
              ))}
            </ul>
          )}
        </section>

        <PublishActions
          canPublish={controller.exam.canPublish}
          {...(controller.publishReadiness ? { publishReadiness: controller.publishReadiness } : {})}
          onPublish={(notes) => controller.handlePublish(notes)}
          onRepublishLatestDraft={() => controller.handleRepublishLatestDraft()}
          onSchedulePublish={(scheduledTime) => controller.handleSchedulePublish(scheduledTime)}
          onUnpublish={(reason) => controller.handleUnpublish(reason)}
          onNavigateToBuilder={() => controller.handleNavigateToBuilder()}
          exam={{ title: controller.exam.title }}
        />

        <section aria-label="Version history">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 flex items-center gap-2">
            <GitCompare size={16} /> Versions
          </h2>
          <ExamVersionHistory
            exam={controller.exam}
            versions={versions}
            events={events}
            onRestoreVersion={handleRestoreVersion}
            onRepublishVersion={handleRepublishVersion}
            onCompareVersions={handleCompareVersions}
          />
        </section>
      </main>
    </div>
  );
}

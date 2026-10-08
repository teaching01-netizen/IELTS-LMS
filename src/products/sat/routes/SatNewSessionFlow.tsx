import { useEffect, useRef, useState } from 'react';
import { useAccessDistributionOverview, useAccessLinkMembers, useCreateAccessLink } from '../../../features/exam-authoring/api/assessmentAccessLinkQueries';
import type { AccessLinkMemberInput, AssessmentAccessLink, CreateAssessmentAccessLinkRequest } from '../../../features/exam-authoring/contracts/accessLinks';
import { AccessLinkEditorSheet } from '../../../features/exam-authoring/ui/access-links/AccessLinkEditorSheet';
import { satPublishScopeCopy } from '../../../features/exam-authoring/ui/release/releaseSelectors';
import { SatFormDialog } from '../ui/ConfirmDialog';
import { SatPageError } from '../ui/SatPage';

export interface SatNewSessionExam {
  id: string;
  title: string;
  currentPublishedVersionId: string | null;
  currentPublishedScope?: 'full' | 'reading-writing' | 'math' | null | undefined;
}

const EMPTY_MEMBERS: AccessLinkMemberInput[] = [];

/**
 * The one way to prepare a sitting from the global Sessions page. It asks which
 * exam, then opens the SAME session setup the exam's own Sessions tab uses, so a
 * session always gets its version pin, audience, sections, check-in window and
 * student link atomically from one request.
 */
export function SatNewSessionFlow({
  exams,
  examsLoading,
  onClose,
  onGoToExamLibrary,
  onCreated,
}: {
  exams: readonly SatNewSessionExam[];
  examsLoading: boolean;
  onClose: () => void;
  onGoToExamLibrary: () => void;
  /** Called with the new session's schedule id once the server confirmed it. */
  onCreated: (scheduleId: string) => void;
}) {
  const [examId, setExamId] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLSelectElement | null>(null);
  const chosen = exams.find((exam) => exam.id === examId) ?? null;
  const [draftChoice, setDraftChoice] = useState('');
  useEffect(() => {
    if (chosen) return;
    const frame = window.requestAnimationFrame(() => firstFieldRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [chosen]);

  if (chosen) return <NewSessionSetup exam={chosen} onClose={onClose} onCreated={onCreated} />;

  const selection = draftChoice || exams[0]?.id || '';
  const selectedExam = exams.find((exam) => exam.id === selection) ?? null;
  return (
    <SatFormDialog open eyebrow="Digital SAT" title="New Session" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (selectedExam) setExamId(selectedExam.id);
        }}
      >
        <div className="space-y-4 px-5 py-4">
          {examsLoading && !exams.length ? (
            <p role="status" className="rounded-[12px] bg-black/[0.035] px-4 py-4 text-[12px] leading-5 text-slate-500">Loading published SAT exams…</p>
          ) : exams.length ? (
            <>
              <label htmlFor="sat-session-exam" className="block text-[12px] font-semibold text-slate-600">
                Exam
                <select
                  ref={firstFieldRef}
                  id="sat-session-exam"
                  aria-label="SAT exam"
                  value={selection}
                  onChange={(event) => setDraftChoice(event.target.value)}
                  className="mt-1.5 h-11 w-full rounded-[11px] border border-[var(--sat-staff-border-strong,rgba(0,0,0,0.09))] bg-white px-3 text-[13px] outline-none focus:border-[var(--sat-staff-accent-ring,rgba(0,113,227,0.4))] focus:ring-4 focus:ring-[var(--sat-staff-accent-ring-soft,rgba(0,113,227,0.1))]"
                >
                  {exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}
                </select>
              </label>
              {selectedExam ? (
                <p className="-mt-2 text-[12px] leading-4 text-slate-400">
                  Students will receive {satPublishScopeCopy(selectedExam.currentPublishedScope ?? 'full')} in this session.
                </p>
              ) : null}
            </>
          ) : (
            <div className="rounded-[12px] bg-black/[0.035] px-4 py-4">
              <p className="text-[13px] font-semibold text-slate-900">Publish a SAT exam before creating a session.</p>
              <button
                type="button"
                onClick={onGoToExamLibrary}
                className="mt-3 min-h-11 rounded-[10px] bg-[var(--sat-staff-accent,#0071e3)] px-4 text-[12px] font-semibold text-white"
              >
                Go to Exam Library
              </button>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] px-5 py-3">
          <button type="button" onClick={onClose} className="min-h-11 rounded-[10px] px-3 text-[12px] font-semibold text-slate-500 hover:bg-black/[0.04]">Cancel</button>
          <button
            type="submit"
            disabled={!selectedExam}
            className="min-h-11 rounded-[10px] bg-[var(--sat-staff-accent,#0071e3)] px-4 text-[12px] font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400"
          >
            Continue
          </button>
        </div>
      </form>
    </SatFormDialog>
  );
}

function NewSessionSetup({ exam, onClose, onCreated }: { exam: SatNewSessionExam; onClose: () => void; onCreated: (scheduleId: string) => void }) {
  const overview = useAccessDistributionOverview(exam.id);
  const createMutation = useCreateAccessLink(exam.id);
  const [prefill, setPrefill] = useState<AssessmentAccessLink | null>(null);
  const membersQuery = useAccessLinkMembers(prefill?.id ?? null);
  const version = overview.data?.currentPublishedVersion ?? null;

  if (overview.error && !overview.data) {
    return (
      <SatFormDialog open eyebrow="Digital SAT" title="New Session" onClose={onClose}>
        <div className="px-5 py-4">
          <SatPageError
            title="Session setup could not load"
            description={overview.error instanceof Error ? overview.error.message : 'The exam’s published version is unavailable.'}
            retryLabel="Retry"
            onRetry={() => void overview.refetch()}
          />
        </div>
      </SatFormDialog>
    );
  }
  if (!version) {
    return (
      <SatFormDialog open eyebrow="Digital SAT" title="New Session" onClose={onClose}>
        <p role="status" className="px-5 py-6 text-[12px] leading-5 text-slate-500">
          {overview.isLoading ? `Loading ${exam.title}…` : `${exam.title} has no published version. Publish it before creating a session.`}
        </p>
      </SatFormDialog>
    );
  }

  const create = async (request: CreateAssessmentAccessLinkRequest) => {
    // Pinned to the version this setup was opened on, even if another author publishes meanwhile.
    const created = await createMutation.mutateAsync({ ...request, publishedVersionId: version.id });
    onCreated(created.scheduleId);
  };

  return (
    <AccessLinkEditorSheet
      open
      link={null}
      prefill={prefill}
      providerKey="sat"
      publishScope={version.publishScope}
      targetVersionNumber={version.versionNumber}
      members={(membersQuery.data ?? EMPTY_MEMBERS) as AccessLinkMemberInput[]}
      membersLoading={Boolean(prefill?.audienceType === 'selected_students' && membersQuery.isLoading)}
      membersError={prefill?.audienceType === 'selected_students' && membersQuery.error ? 'The student roster could not load. Retry before continuing.' : null}
      onRetryMembers={() => void membersQuery.refetch()}
      isSaving={createMutation.isPending}
      reuseOptions={overview.data?.links ?? []}
      onReuseSetup={setPrefill}
      onClose={() => { if (!createMutation.isPending) onClose(); }}
      onCreate={create}
    />
  );
}

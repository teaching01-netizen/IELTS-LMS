import { useEffect, useState } from 'react';
import { useAccessDistributionOverview, useAccessLinkMembers, useCreateAccessLink } from '../../../features/exam-authoring/api/assessmentAccessLinkQueries';
import type { AccessLinkMemberInput, AssessmentAccessLink, CreateAssessmentAccessLinkRequest } from '../../../features/exam-authoring/contracts/accessLinks';
import { AccessLinkEditorSheet } from '../../../features/exam-authoring/ui/access-links/AccessLinkEditorSheet';
import { satPublishScopeCopy } from '../../../features/exam-authoring/ui/release/releaseSelectors';
import { SatFormDialog } from '../ui/ConfirmDialog';
import { SatButton, SatField, SatInlineError } from '../ui/SatPage';

export interface SatNewSessionExam {
  id: string;
  title: string;
  currentPublishedVersionId: string | null;
  currentPublishedScope?: 'full' | 'reading-writing' | 'math' | null | undefined;
}

const EMPTY_MEMBERS: AccessLinkMemberInput[] = [];

/** The published version a room from this sheet is pinned to, captured once per exam. */
interface PinnedTarget {
  examId: string;
  id: string;
  versionNumber: number;
  publishScope: 'full' | 'reading-writing' | 'math';
}

/**
 * Global room creation from the Rooms page. The exam is the first field of the
 * SAME room setup sheet the exam's own Rooms tab uses, so a room always gets its
 * version pin, audience, sections, check-in window and student link atomically
 * from one request, without a separate "choose an exam" step.
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
  const chosen = exams.find((exam) => exam.id === examId) ?? exams[0] ?? null;
  const chosenId = chosen?.id ?? '';
  const overview = useAccessDistributionOverview(chosenId, Boolean(chosenId));
  const createMutation = useCreateAccessLink(chosenId);
  const [prefill, setPrefill] = useState<AssessmentAccessLink | null>(null);
  const membersQuery = useAccessLinkMembers(prefill?.id ?? null);
  const version = overview.data?.currentPublishedVersion ?? null;
  // The overview polls every ~30s and another author can publish meanwhile. One
  // target is captured per chosen exam and kept while that exam stays chosen, so
  // a background refresh can never change the version this room will use.
  const [target, setTarget] = useState<PinnedTarget | null>(null);
  const pinned = target?.examId === chosenId ? target : null;
  useEffect(() => {
    if (!chosenId || !version || pinned) return;
    setTarget({ examId: chosenId, id: version.id, versionNumber: version.versionNumber, publishScope: version.publishScope ?? 'full' });
  }, [chosenId, pinned, version]);

  if (!chosen) {
    return (
      <SatFormDialog open eyebrow="Digital SAT" title="Create room" onClose={onClose}>
        <div className="px-6 py-5">
          {examsLoading ? (
            <p role="status" className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Loading published exams…</p>
          ) : (
            <>
              <p className="text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)]">No published exams yet</p>
              <p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">A room delivers one published version. Publish an exam first.</p>
              <SatButton variant="primary" onClick={onGoToExamLibrary} className="mt-3">Go to Exams</SatButton>
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] px-6 py-4">
          <SatButton variant="quiet" onClick={onClose}>Cancel</SatButton>
        </div>
      </SatFormDialog>
    );
  }

  const create = async (request: CreateAssessmentAccessLinkRequest) => {
    // Pinned to the version captured when this exam was chosen, even if another
    // author publishes (or the polling overview reports a newer release) meanwhile.
    if (!pinned) throw new Error('The exam’s published version is still loading.');
    const created = await createMutation.mutateAsync({ ...request, publishedVersionId: pinned.id });
    onCreated(created.scheduleId);
  };

  const examPicker = (
    <div className="space-y-3">
      <SatField
        id="sat-session-exam"
        label="Exam"
        help={pinned ? `Students receive ${satPublishScopeCopy(pinned.publishScope)} from Version ${pinned.versionNumber}. The room stays on that version.` : undefined}
      >
        {(control) => (
          <select
            {...control}
            value={chosenId}
            disabled={createMutation.isPending}
            onChange={(event) => {
              // A reused setup belongs to the exam it came from.
              setPrefill(null);
              setExamId(event.target.value);
            }}
            className="sat-input"
          >
            {exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}
          </select>
        )}
      </SatField>
      {overview.error && !overview.data ? (
        <SatInlineError
          title="Room setup could not load"
          description={overview.error instanceof Error ? overview.error.message : 'The exam’s published version is unavailable.'}
          onRetry={() => void overview.refetch()}
        />
      ) : !pinned ? (
        <p role="status" className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
          {!version && !overview.isLoading
            ? `${chosen.title} has no published version. Publish it before creating a room.`
            : `Loading ${chosen.title}…`}
        </p>
      ) : null}
    </div>
  );

  return (
    <AccessLinkEditorSheet
      open
      link={null}
      prefill={prefill}
      providerKey="sat"
      examTitle={chosen.title}
      publishScope={pinned?.publishScope ?? chosen.currentPublishedScope ?? 'full'}
      targetVersionNumber={pinned?.versionNumber ?? null}
      members={(membersQuery.data ?? EMPTY_MEMBERS) as AccessLinkMemberInput[]}
      membersLoading={Boolean(prefill?.audienceType === 'selected_students' && membersQuery.isLoading)}
      membersError={prefill?.audienceType === 'selected_students' && membersQuery.error ? 'The student roster could not load. Retry before continuing.' : null}
      onRetryMembers={() => void membersQuery.refetch()}
      isSaving={createMutation.isPending}
      submitDisabled={!pinned}
      contentBeforeFields={examPicker}
      reuseOptions={overview.data?.links ?? []}
      onReuseSetup={setPrefill}
      onClose={() => { if (!createMutation.isPending) onClose(); }}
      onCreate={create}
    />
  );
}

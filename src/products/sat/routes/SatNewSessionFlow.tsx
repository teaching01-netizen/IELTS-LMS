import { useEffect, useRef, useState } from 'react';
import { useAccessDistributionOverview, useAccessLinkMembers, useCreateAccessLink } from '../../../features/exam-authoring/api/assessmentAccessLinkQueries';
import type { AccessLinkMemberInput, AssessmentAccessLink, CreateAssessmentAccessLinkRequest } from '../../../features/exam-authoring/contracts/accessLinks';
import { AccessLinkEditorSheet } from '../../../features/exam-authoring/ui/access-links/AccessLinkEditorSheet';
import { satPublishScopeCopy } from '../../../features/exam-authoring/ui/release/releaseSelectors';
import { SatFormDialog } from '../ui/ConfirmDialog';
import { SatButton, SatField, SatInlineError } from '../ui/SatPage';
import { SatRoomSetupProgress } from '../../../features/exam-authoring/ui/access-links/SatRoomSetupProgress';

export interface SatNewSessionExam {
  id: string;
  title: string;
  currentPublishedVersionId: string | null;
  currentPublishedScope?: 'full' | 'reading-writing' | 'math' | null | undefined;
}

const EMPTY_MEMBERS: AccessLinkMemberInput[] = [];

/**
 * Global room creation from the Rooms page. It asks which exam, then opens the
 * SAME room setup the exam's own Rooms tab uses, so a room always gets its
 * version pin, audience, sections, check-in window and student link
 * atomically from one request. Exam-level creation skips straight to setup.
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

  if (chosen) return <NewSessionSetup exam={chosen} onClose={onClose} onCreated={onCreated} onBackToExamChoice={() => setExamId(null)} />;

  const selection = draftChoice || exams[0]?.id || '';
  const selectedExam = exams.find((exam) => exam.id === selection) ?? null;
  return (
    <SatFormDialog open eyebrow="Digital SAT" title="Create room" onClose={onClose}>
      <SatRoomSetupProgress current={1} total={3} label="Choose an exam" description="Pick the published SAT exam this room will use." />
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (selectedExam) setExamId(selectedExam.id);
        }}
      >
        <div className="space-y-4 px-6 py-5">
          {examsLoading && !exams.length ? (
            <p role="status" className="rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))] px-4 py-4 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Loading published exams…</p>
          ) : exams.length ? (
            <SatField
              id="sat-session-exam"
              label="Exam"
              help={selectedExam ? `Students receive ${satPublishScopeCopy(selectedExam.currentPublishedScope ?? 'full')} from the exam's current published version. The room stays on that version.` : undefined}
            >
              {(control) => (
                <select
                  ref={firstFieldRef}
                  {...control}
                  value={selection}
                  onChange={(event) => setDraftChoice(event.target.value)}
                  className="sat-input"
                >
                  {exams.map((exam) => <option key={exam.id} value={exam.id}>{exam.title}</option>)}
                </select>
              )}
            </SatField>
          ) : (
            <div className="rounded-[var(--sat-staff-radius-control,10px)] bg-[var(--sat-staff-fill-faint,rgba(0,0,0,0.035))] px-4 py-4">
              <p className="text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)]">No published exams yet</p>
              <p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">A room delivers one published version. Publish an exam first.</p>
              <SatButton variant="secondary" onClick={onGoToExamLibrary} className="mt-3">Go to Exams</SatButton>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] px-6 py-4">
          <SatButton variant="quiet" onClick={onClose}>Cancel</SatButton>
          <SatButton variant="primary" type="submit" disabled={!selectedExam}>Continue</SatButton>
        </div>
      </form>
    </SatFormDialog>
  );
}

function NewSessionSetup({ exam, onClose, onCreated, onBackToExamChoice }: { exam: SatNewSessionExam; onClose: () => void; onCreated: (scheduleId: string) => void; onBackToExamChoice: () => void }) {
  const overview = useAccessDistributionOverview(exam.id);
  const createMutation = useCreateAccessLink(exam.id);
  const [prefill, setPrefill] = useState<AssessmentAccessLink | null>(null);
  const membersQuery = useAccessLinkMembers(prefill?.id ?? null);
  const version = overview.data?.currentPublishedVersion ?? null;
  // The overview polls every ~30s and another author can publish meanwhile.
  // One target is captured when setup begins and kept for the whole form, so a
  // background refresh can never change the version this room will use nor
  // reinitialize the editor over fields the author already filled in.
  const [target, setTarget] = useState<{
    id: string;
    versionNumber: number;
    publishScope: 'full' | 'reading-writing' | 'math';
  } | null>(null);
  useEffect(() => {
    if (target || !version) return;
    setTarget({
      id: version.id,
      versionNumber: version.versionNumber,
      publishScope: version.publishScope ?? 'full',
    });
  }, [target, version]);

  if (overview.error && !overview.data) {
    return (
      <SatFormDialog open eyebrow="Digital SAT" title="Create room" onClose={onClose}>
        <SatRoomSetupProgress current={2} total={3} label="Setup" description="Name the room, choose its sections, who may join, and when check-in opens." />
        <div className="px-6 py-5">
          <SatInlineError
            title="Room setup could not load"
            description={overview.error instanceof Error ? overview.error.message : 'The exam’s published version is unavailable.'}
            onRetry={() => void overview.refetch()}
          />
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] px-6 py-4">
          <SatButton variant="quiet" onClick={onClose}>Cancel</SatButton>
          <SatButton variant="secondary" onClick={onBackToExamChoice}>Back</SatButton>
        </div>
      </SatFormDialog>
    );
  }
  if (!version || !target) {
    return (
      <SatFormDialog open eyebrow="Digital SAT" title="Create room" onClose={onClose}>
        <SatRoomSetupProgress current={2} total={3} label="Setup" description="Name the room, choose its sections, who may join, and when check-in opens." />
        <p role="status" className="px-6 py-6 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">
          {!version && !overview.isLoading
            ? `${exam.title} has no published version. Publish it before creating a room.`
            : `Loading ${exam.title}…`}
        </p>
        <div className="flex items-center justify-between gap-2 border-t border-[var(--sat-staff-border-hairline,rgba(0,0,0,0.06))] px-6 py-4">
          <SatButton variant="quiet" onClick={onClose}>Cancel</SatButton>
          <SatButton variant="secondary" onClick={onBackToExamChoice}>Back</SatButton>
        </div>
      </SatFormDialog>
    );
  }

  const create = async (request: CreateAssessmentAccessLinkRequest) => {
    // Pinned to the version this setup was opened on, even if another author
    // publishes (or the polling overview reports a newer release) meanwhile.
    const created = await createMutation.mutateAsync({ ...request, publishedVersionId: target.id });
    onCreated(created.scheduleId);
  };

  return (
    <AccessLinkEditorSheet
      open
      link={null}
      guidedCreation
      stepOffset={1}
      totalSteps={3}
      onBackToPreviousStep={onBackToExamChoice}
      prefill={prefill}
      providerKey="sat"
      examTitle={exam.title}
      publishScope={target.publishScope}
      targetVersionNumber={target.versionNumber}
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

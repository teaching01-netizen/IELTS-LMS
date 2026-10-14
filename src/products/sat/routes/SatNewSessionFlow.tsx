import { useState } from 'react';
import { useAccessDistributionOverview, useAccessLinkMembers } from '../../../features/exam-authoring/api/assessmentAccessLinkQueries';
import type { AccessLinkMemberInput, AssessmentAccessLink } from '../../../features/exam-authoring/contracts/accessLinks';
import type { AssessmentValidationIssue } from '../../../features/exam-authoring/contracts/assessment';
import { SatCreateRoomFlow } from '../../../features/exam-authoring/ui/publish/SatCreateRoomFlow';
import { SatFormDialog } from '../ui/ConfirmDialog';
import { SatButton, SatField } from '../ui/SatPage';

export interface SatNewSessionExam {
  id: string;
  title: string;
}

const EMPTY_MEMBERS: AccessLinkMemberInput[] = [];

/**
 * Global room creation from the Rooms page. The exam is the first field of the
 * SAME one-action Create room form the exam's own Rooms tab uses: any exam with
 * content can be chosen, and the server captures (or reuses) its latest saved
 * release when the room is created. No exam needs to be published first.
 */
export function SatNewSessionFlow({
  exams,
  examsLoading,
  onClose,
  onGoToExamLibrary,
  onFixIssue,
  onCreated,
}: {
  exams: readonly SatNewSessionExam[];
  examsLoading: boolean;
  onClose: () => void;
  onGoToExamLibrary: () => void;
  /** Opens the exam content a create-room check named. */
  onFixIssue: (examId: string, issue: AssessmentValidationIssue) => void;
  /** Called with the new session's schedule id once the server confirmed it. */
  onCreated: (scheduleId: string) => void;
}) {
  const [examId, setExamId] = useState<string | null>(null);
  const chosen = exams.find((exam) => exam.id === examId) ?? exams[0] ?? null;
  const chosenId = chosen?.id ?? '';
  const overview = useAccessDistributionOverview(chosenId, Boolean(chosenId));
  const [prefill, setPrefill] = useState<AssessmentAccessLink | null>(null);
  const membersQuery = useAccessLinkMembers(prefill?.id ?? null);

  if (!chosen) {
    return (
      <SatFormDialog open eyebrow="Digital SAT" title="Create room" onClose={onClose}>
        <div className="px-6 py-5">
          {examsLoading ? (
            <p role="status" className="text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">Loading exams…</p>
          ) : (
            <>
              <p className="text-[14px] font-semibold leading-5 text-[var(--sat-staff-text-primary,#1d1d1f)]">No exams yet</p>
              <p className="mt-1 text-[14px] leading-5 text-[var(--sat-staff-text-secondary,#515154)]">A room delivers an exam. Create an exam and add its questions first.</p>
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

  const examPicker = (
    <SatField
      id="sat-session-exam"
      label="Exam"
      help="A saved version of this exam is captured automatically for the room."
    >
      {(control) => (
        <select
          {...control}
          value={chosenId}
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
  );

  return (
    <SatCreateRoomFlow
      key={prefill?.id ?? 'new-room'}
      examId={chosenId}
      examTitle={chosen.title}
      examPicker={examPicker}
      prefill={prefill}
      reuseOptions={overview.data?.links ?? []}
      onReuseSetup={setPrefill}
      members={(membersQuery.data ?? EMPTY_MEMBERS) as AccessLinkMemberInput[]}
      membersLoading={Boolean(prefill?.audienceType === 'selected_students' && membersQuery.isLoading)}
      membersError={prefill?.audienceType === 'selected_students' && membersQuery.error ? 'The student roster could not load. Retry before continuing.' : null}
      onRetryMembers={() => void membersQuery.refetch()}
      onClose={onClose}
      onFixIssue={(issue) => onFixIssue(chosenId, issue)}
      onRoomCreated={(link) => onCreated(link.scheduleId)}
    />
  );
}

import { SatConfirmDialog } from './ConfirmDialog';

export const SAT_SESSION_WARN_MESSAGE = 'Please return your attention to the exam.';

export type SatSessionRoomConfirmation =
  | { kind: 'start'; joinedCount: number; readyCount: number | null; sectionsLabel: string; perCandidateTiming: boolean | null }
  | { kind: 'complete' }
  | { kind: 'terminate'; studentId: string; studentName: string }
  | { kind: 'warn'; studentId: string; studentName: string }
  | { kind: 'extend-session'; minutes: number; stage: string; sectionKey: string; runtimeRevision: number; remainingLabel: string }
  | { kind: 'extend-student'; minutes: number; moduleId: string; studentId: string; studentName: string; remainingLabel: string };

export function SatSessionRoomConfirmDialog({
  confirm,
  onCancel,
  onConfirm,
}: {
  confirm: SatSessionRoomConfirmation | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!confirm) return null;

  // Every confirmation names who is affected (the whole room or one student)
  // and what actually happens, so room and student actions cannot be confused.
  const title = confirm.kind === 'start'
    ? 'Start the exam for this room?'
    : confirm.kind === 'complete'
    ? 'End the exam for everyone in this room?'
    : confirm.kind === 'terminate'
      ? `End ${confirm.studentName}’s attempt?`
      : confirm.kind === 'warn'
        ? `Send warning to ${confirm.studentName}?`
        : confirm.kind === 'extend-session'
          ? `Add ${confirm.minutes} minutes to ${confirm.stage}?`
          : `Add ${confirm.minutes} minutes for ${confirm.studentName}?`;
  const description = confirm.kind === 'start'
    ? `${confirm.joinedCount} joined${confirm.readyCount === null ? '' : ` · ${confirm.readyCount} ready`}. ${confirm.sectionsLabel} begins for students who have joined. ${confirm.perCandidateTiming === null ? 'Timing is shown in the run sheet once the exam starts.' : confirm.perCandidateTiming ? 'Each student receives the full configured time; late arrivals start their own clock.' : 'Students share the room clock; late arrivals receive the time left in the current window.'} Starting cannot be undone.`
    : confirm.kind === 'complete'
    ? 'Affects every student in this room. The exam is completed for the whole room. Use this only when testing is finished; it cannot be undone.'
    : confirm.kind === 'terminate'
      ? `Affects only ${confirm.studentName}. Their current attempt ends now and their recorded answers remain available. Other students are not affected.`
      : confirm.kind === 'warn'
        ? `Only ${confirm.studentName} sees this message: “${SAT_SESSION_WARN_MESSAGE}”`
        : confirm.kind === 'extend-session'
          ? `Affects every student in this room. Current stage remaining: ${confirm.remainingLabel}. The extension applies to the current stage immediately.`
          : `Affects only ${confirm.studentName}. Their remaining time: ${confirm.remainingLabel}. The extension applies to this attempt immediately.`;

  return (
    <SatConfirmDialog
      open
      title={title}
      description={description}
      confirmLabel={confirm.kind === 'start'
        ? 'Start exam'
        : confirm.kind === 'complete'
        ? 'End exam'
        : confirm.kind === 'terminate'
          ? 'End attempt'
          : confirm.kind === 'warn'
            ? 'Send warning'
            : `Add ${confirm.minutes} minutes`}
      destructive={confirm.kind === 'terminate' || confirm.kind === 'complete'}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

import { SatConfirmDialog } from './ConfirmDialog';

export const SAT_SESSION_WARN_MESSAGE = 'Please return your attention to the exam.';

export type SatSessionRoomConfirmation =
  | { kind: 'complete' }
  | { kind: 'terminate'; studentId: string; studentName: string }
  | { kind: 'warn'; studentId: string; studentName: string }
  | { kind: 'extend-session'; minutes: number; stage: string; remainingLabel: string }
  | { kind: 'extend-student'; minutes: number; studentId: string; studentName: string; remainingLabel: string };

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

  const title = confirm.kind === 'complete'
    ? 'Finish this SAT session?'
    : confirm.kind === 'terminate'
      ? `End ${confirm.studentName}’s attempt?`
      : confirm.kind === 'warn'
        ? `Send warning to ${confirm.studentName}?`
        : confirm.kind === 'extend-session'
          ? `Add ${confirm.minutes} minutes to ${confirm.stage}?`
          : `Add ${confirm.minutes} minutes for ${confirm.studentName}?`;
  const description = confirm.kind === 'complete'
    ? 'The session will be completed for the cohort. This should only be used when testing is finished.'
    : confirm.kind === 'terminate'
      ? 'This ends the student’s current attempt. Their recorded answers remain available.'
      : confirm.kind === 'warn'
        ? `The student will see exactly: “${SAT_SESSION_WARN_MESSAGE}”`
        : confirm.kind === 'extend-session'
          ? `Current stage remaining: ${confirm.remainingLabel}. The extension applies to the current stage immediately.`
          : `Current remaining: ${confirm.remainingLabel}. The extension applies to this attempt immediately.`;

  return (
    <SatConfirmDialog
      open
      title={title}
      description={description}
      confirmLabel={confirm.kind === 'complete'
        ? 'Finish Session'
        : confirm.kind === 'terminate'
          ? 'End Attempt'
          : confirm.kind === 'warn'
            ? 'Send Warning'
            : `Add ${confirm.minutes} Minutes`}
      destructive={confirm.kind === 'terminate' || confirm.kind === 'complete'}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

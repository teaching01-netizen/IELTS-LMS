import {
  getStudentSaveStatusChipLabel,
  getStudentSaveStatusPresentation,
  type StudentAutoSaveStatus,
} from '../../../components/student/saveStatusPresentation';

/**
 * Visible save state for `ielts_shared_schedule_v1` rooms. It is deliberately
 * outside the exam headers (which stay uncluttered) and never says submitted:
 * "Saved to server" means the server acknowledged these writes, not that the
 * exam was submitted.
 */
export function IeltsSharedSaveStatus({
  status,
  needsReview = false,
}: {
  status: StudentAutoSaveStatus | null | undefined;
  /** Retained/unscored work exists, so no status may read as fully saved. */
  needsReview?: boolean | undefined;
}) {
  if (!status && !needsReview) return null;
  const effective = needsReview ? 'needs_recovery' : status;
  if (!effective) return null;
  const tone = getStudentSaveStatusPresentation(effective).tone;
  const toneClassName =
    tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
      : tone === 'danger'
        ? 'border-rose-200 bg-rose-50 text-rose-900'
        : tone === 'warning'
          ? 'border-amber-200 bg-amber-50 text-amber-900'
          : 'border-slate-200 bg-slate-50 text-slate-700';
  return (
    <div className="flex justify-end px-4 pt-2">
      <p
        role="status"
        aria-live="polite"
        data-testid="student-save-status"
        className={`rounded-full border px-3 py-1 text-xs font-medium ${toneClassName}`}
      >
        {getStudentSaveStatusChipLabel(effective)}
      </p>
    </div>
  );
}

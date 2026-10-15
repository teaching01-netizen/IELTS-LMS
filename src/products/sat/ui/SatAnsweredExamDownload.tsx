import { useMemo } from 'react';
import { fetchSatAnsweredExam } from '../../../features/results/api/satResultsQueries';
import type { AssessmentAnsweredExam } from '../../../features/student-delivery/contracts/assessmentDelivery';
import { useAnsweredExamPrint } from '../../../features/student-delivery/ui/transitions/SatScoreReport';
import type { StudentScoreReportView } from '../../../features/student-delivery/ui/transitions/score-report/scoreReportViewModel';

/**
 * Staff copy of the student's answered-exam PDF (PDF-08): the same server
 * projection and print gate, independent of the student's report switch.
 * `view` adds the score report to the paper; omit it for an unscored attempt.
 */
export function SatAnsweredExamDownload({ attemptId, view = null }: { attemptId: string; view?: StudentScoreReportView | null }) {
  const source = useMemo(() => ({ load: () => fetchSatAnsweredExam<AssessmentAnsweredExam>(attemptId) }), [attemptId]);
  const { download, print, paper } = useAnsweredExamPrint(source, view);
  return (
    <div className="mt-3 print:hidden">
      <button type="button" disabled={download === 'preparing'} onClick={() => void print()} className="sat-btn sat-btn--secondary sat-press disabled:opacity-50">
        {download === 'preparing' ? 'Preparing answered exam…' : 'Download answered exam (PDF)'}
      </button>
      {download === 'failed' ? (
        <p role="alert" className="mt-2 text-[14px] leading-5 text-[var(--sat-staff-danger,#b42318)]">
          The answered exam could not be fully loaded, so no PDF was made. It is available once the attempt has ended. Try again.
        </p>
      ) : null}
      {paper}
    </div>
  );
}

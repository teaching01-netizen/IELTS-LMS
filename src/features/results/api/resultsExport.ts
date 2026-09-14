import { downloadCsv } from '../../../utils/csvExport';
import { resultsGateway } from '../infrastructure/resultsGateway';
import type { ActScienceDetail, AdminResultRow } from './resultsQueries';

const ACT_EXPORT_HEADERS = [
  'studentName',
  'studentId',
  'attemptId',
  'scheduleId',
  'totalScore',
  'maxScore',
  'percentage',
  'outcomeStatus',
  'releaseStatus',
  'integrityStatus',
  'questionId',
  'questionNumber',
  'response',
  'correctAnswer',
  'isCorrect',
];

function csvValue(value: unknown): unknown {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

/**
 * Exports the ACT rows through the canonical science detail endpoint. The
 * endpoint reads section_submissions.auto_grading_results, so this export
 * remains aligned with the report and override surfaces.
 */
export async function downloadActScienceCsv(results: AdminResultRow[]): Promise<number> {
  const actResults = results.filter((result) => result.providerKey === 'act');
  const details = await Promise.all(
    actResults.map((result) =>
      resultsGateway.get<ActScienceDetail>(
        `/v1/results/act-science/${encodeURIComponent(result.attemptId)}`,
      ),
    ),
  );

  const rows = details.flatMap((detail) => {
    const base = [
      detail.studentName,
      detail.studentId,
      detail.attemptId,
      detail.scheduleId,
      detail.totalScore,
      detail.maxScore,
      detail.percentage,
      detail.outcomeStatus,
      detail.releaseStatus,
      detail.integrityStatus ?? '',
    ];
    if (detail.questions.length === 0) {
      return [[...base, '', '', '', '', '']];
    }
    return detail.questions.map((question) => [
      ...base,
      question.questionId,
      question.displayOrder,
      csvValue(question.response),
      csvValue(question.correctAnswer),
      question.isCorrect ?? '',
    ]);
  });

  downloadCsv(
    `act-science-results-${new Date().toISOString().slice(0, 10)}.csv`,
    ACT_EXPORT_HEADERS,
    rows,
  );
  return details.length;
}

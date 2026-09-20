import { downloadCsv } from '../../../utils/csvExport';
import { ACT_SCIENCE_SKILL_CATEGORIES, type ActScienceSkillCategory } from '../../../types';
import { resultsGateway } from '../infrastructure/resultsGateway';
import type { ActScienceDetail, AdminResultRow } from './resultsQueries';

const ACT_EXPORT_HEADERS = [
  'studentName',
  'studentId',
  'attemptId',
  'scheduleId',
  'Course',
  'Total Score',
  'Interpretation of Data (IOD)',
  'Scientific Investigation (SIN)',
  'Evaluating Scientific Arguments and Models with Evidence (ESA)',
  'IOD correct',
  'SIN correct',
  'ESA correct',
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

type CategoryCounts = Record<ActScienceSkillCategory, { total: number; correct: number }>;

function summarizeActScienceCategories(questions: ActScienceDetail['questions']): CategoryCounts {
  const counts = Object.fromEntries(
    ACT_SCIENCE_SKILL_CATEGORIES.map(({ value }) => [value, { total: 0, correct: 0 }]),
  ) as CategoryCounts;

  for (const question of questions) {
    const category = question.skillCategory;
    if (!category || !(category in counts)) continue;
    counts[category].total += 1;
    if (question.isCorrect === true) counts[category].correct += 1;
  }

  return counts;
}

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
    const categoryCounts = summarizeActScienceCategories(detail.questions);
    const iod = categoryCounts.interpretation_of_data;
    const sin = categoryCounts.scientific_investigation;
    const esa = categoryCounts.evaluating_scientific_arguments_and_models_with_evidence;
    const base = [
      detail.studentName,
      detail.studentId,
      detail.attemptId,
      detail.scheduleId,
      detail.course ?? '',
      detail.totalScore,
      iod.total,
      sin.total,
      esa.total,
      iod.correct,
      sin.correct,
      esa.correct,
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

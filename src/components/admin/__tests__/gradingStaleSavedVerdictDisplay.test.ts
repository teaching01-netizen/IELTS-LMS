import { describe, expect, test } from 'vitest';

import {
  AUTO_GRADING_TIMESTAMP,
  READING_MODULE,
  readingExam,
  sectionWithSingleResult,
} from '../../../../e2e/helpers/ieltsGradingFixtures';
import { getStudentQuestionsForModule } from '../../../features/exam-authoring/api/examAuthoringGateway';
import type { ExamState, QuestionBlock } from '../../../types';
import type { ObjectiveQuestionResult, SectionSubmission } from '../../../types/grading';
import { buildExamObjectiveOverviewRows } from '../examObjectiveOverviewUtils';
import { buildCaseSensitiveMap } from '../gradingAnswerUtils';
import { buildStudentPdfBytes } from '../gradingPerStudentExport/studentPdf';
import { buildObjectiveQuestionTableRows } from '../gradingPerStudentExport/objective/tableRows';
import {
  buildObjectiveSectionDisplaySummary,
  buildQuestionTracebackGroups,
  buildWideObjectiveExport,
  deriveIeltsBandScore,
  scoreSectionForRecheck,
  type WideObjectiveExport,
} from '../gradingReviewUtils';

/**
 * The prod bug: saved `autoGradingResults` produced before the IELTS
 * exact-case rule existed still say `28th june` matches `28th June`. The
 * displayed verdict/score and the PDF/CSV export must use the current website
 * re-check, while the saved score stays official until a regrade and the
 * "Saved score is out of date — regrade" warning keeps rendering.
 */

const STALE_QUESTION_ID = 'q-28';
const DESCRIPTORS = 're-check precondition';

function staleCaseExam(): ExamState {
  return readingExam('Stale saved verdicts', [{
    id: 'short-block',
    type: 'SHORT_ANSWER',
    instruction: '',
    questions: [{
      id: STALE_QUESTION_ID,
      prompt: 'When does the fair open?',
      correctAnswer: '28th June',
      acceptedAnswers: ['28th June', '28 June'],
      answerRule: 'ONE_WORD',
    }],
  }], { content: 'The fair opens on 28th June.' });
}

/** Saved result predates exact-case grading: it awards the case-only variant. */
function staleSubmission(overrides: Partial<ObjectiveQuestionResult> = {}): SectionSubmission {
  const base = sectionWithSingleResult({
    questionId: STALE_QUESTION_ID,
    studentAnswer: '28th june',
    correctAnswer: '28th June',
    isCorrect: true,
    scoringRule: 'one_word',
    awardedScore: 1,
    maxScore: 1,
  });
  const questionResults = (base.autoGradingResults?.questionResults ?? [])
    .map((result) => ({ ...result, ...overrides }));
  return {
    ...base,
    autoGradingResults: { ...base.autoGradingResults, questionResults },
  } as SectionSubmission;
}

function overviewRows(state: ExamState, section: SectionSubmission) {
  return buildExamObjectiveOverviewRows(
    [{ submission: { id: 'sub-1', studentName: 'Narin Example' }, sections: [section] }],
    { examState: state },
  );
}

function tracebackItems(state: ExamState, section: SectionSubmission) {
  return buildQuestionTracebackGroups(state, section, READING_MODULE)
    .flatMap((group) => group.items);
}

function buildWide(state: ExamState, section: SectionSubmission): WideObjectiveExport {
  return buildWideObjectiveExport({
    session: { sessionId: 'session-1', examTitle: 'IELTS Case E2E' },
    submissions: [{
      id: 'sub-1',
      studentName: 'Narin Example',
      scheduleId: 'schedule-1',
      studentId: 'student-1',
      cohortName: 'Cohort',
      submittedAt: AUTO_GRADING_TIMESTAMP,
    } as never],
    sectionSubmissions: [{ submissionId: 'sub-1', sectionSubmission: section }],
    examState: state,
    moduleType: READING_MODULE,
    mode: 'auto',
  });
}

function tableRows(state: ExamState, wide: WideObjectiveExport) {
  return buildObjectiveQuestionTableRows(wide.columns, wide.rows[0]!, {
    caseSensitiveByQuestionId: buildCaseSensitiveMap(
      getStudentQuestionsForModule(state, READING_MODULE),
    ),
  });
}

/** Text chunks the per-student PDF actually paints (uncompressed jsPDF text). */
function pdfTextChunks(state: ExamState, wide: WideObjectiveExport): string[] {
  const bytes = buildStudentPdfBytes(
    {
      submissionId: 'sub-1',
      studentName: 'Narin Example',
      studentId: 'student-1',
      sectionData: {
        reading: {
          columns: wide.columns,
          row: wide.rows[0]!,
          objectiveContext: {
            caseSensitiveByQuestionId: buildCaseSensitiveMap(
              getStudentQuestionsForModule(state, READING_MODULE),
            ),
          },
        },
      },
    },
    ['reading'],
    new Date(AUTO_GRADING_TIMESTAMP),
  );
  expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('%PDF');
  return [...new TextDecoder().decode(bytes).matchAll(/\(([^()]*)\) Tj/g)]
    .map((match) => match[1]!);
}

describe('stale saved objective verdicts follow the exact-case re-check', () => {
  test('shows Incorrect on the overview, traceback, CSV row and PDF for a case-only saved Correct', () => {
    const examState = staleCaseExam();
    const section = staleSubmission();

    // Fixture precondition: today's exact-case rule rejects the saved verdict.
    const recheck = scoreSectionForRecheck(examState, section, READING_MODULE);
    expect(recheck?.byId.get(STALE_QUESTION_ID)).toMatchObject({
      correctness: false,
      awardedScore: 0,
      maxScore: 1,
    });

    const rows = overviewRows(examState, section);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      questionId: STALE_QUESTION_ID,
      isCorrect: false,
      awardedScore: 0,
      maxScore: 1,
      savedResultOutOfDate: true,
    });

    const item = tracebackItems(examState, section)[0];
    expect(item).toMatchObject({
      questionId: STALE_QUESTION_ID,
      correctness: false,
      awardedScore: 0,
      maxScore: 1,
    });

    const summary = buildObjectiveSectionDisplaySummary(examState, section, READING_MODULE);
    expect(summary).toMatchObject({
      totalScore: 0,
      maxScore: 1,
      correctCount: 0,
      savedOutOfDate: true,
    });

    const wide = buildWide(examState, section);
    const wideRow = wide.rows[0]!;
    expect(wideRow[`score:${STALE_QUESTION_ID}`]).toBe(0);
    expect(wideRow['totalScore']).toBe(0);
    expect(wideRow['maxScore']).toBe(1);
    expect(wideRow['correctCount']).toBe(0);
    expect(wideRow['ieltsBandScore']).toBe(0);
    expect(wideRow['ieltsBandScore']).toBe(deriveIeltsBandScore(examState, READING_MODULE, 0));

    const table = tableRows(examState, wide);
    expect(table).toHaveLength(1);
    expect(table[0]).toMatchObject({
      studentAnswer: '28th june',
      rightAnswer: '28th June | 28 June',
      correct: 'No',
      score: '0',
    });

    const chunks = pdfTextChunks(examState, wide);
    expect(chunks).toContain('28th june');
    expect(chunks).toContain('No');
    expect(chunks).not.toContain('Yes');
    expect(chunks).toContain('0/1');
    const gatedLabelIndex = chunks.indexOf('Correct:');
    expect(chunks[gatedLabelIndex + 1]).toBe('0');
    const questionRowStart = chunks.indexOf('Q1');
    expect(chunks.slice(questionRowStart, questionRowStart + 6)).toContain('No');
  });

  test('reduces the export total, correct count and band while the saved score stays official', () => {
    const questionBlocks: QuestionBlock[] = [{
      id: 'short-block',
      type: 'SHORT_ANSWER',
      instruction: '',
      questions: [
        {
          id: STALE_QUESTION_ID,
          prompt: 'When does the fair open?',
          correctAnswer: '28th June',
          acceptedAnswers: ['28th June', '28 June'],
          answerRule: 'ONE_WORD',
        },
        ...[
          ['q-1', 'Alpha', 'One?'],
          ['q-2', 'Bravo', 'Two?'],
          ['q-3', 'Charlie', 'Three?'],
          ['q-4', 'Delta', 'Four?'],
          ['q-5', 'Echo', 'Five?'],
        ].map(([id, answer, prompt]) => ({
          id: id!,
          prompt: prompt!,
          correctAnswer: answer!,
          answerRule: 'ONE_WORD' as const,
        })),
      ],
    }];
    const examState = readingExam('Stale saved totals', questionBlocks, {
      content: 'The fair opens on 28th June.',
    });
    const answers: Record<string, string> = {
      [STALE_QUESTION_ID]: '28th june',
      'q-1': 'Alpha',
      'q-2': 'Bravo',
      'q-3': 'Charlie',
      'q-4': 'Delta',
      'q-5': 'Echo',
    };
    const questionResults: ObjectiveQuestionResult[] = Object.entries(answers)
      .map(([questionId, studentAnswer]) => ({
        questionId,
        studentAnswer,
        correctAnswer: questionId === STALE_QUESTION_ID ? '28th June' : studentAnswer,
        isCorrect: true,
        awardedScore: 1,
        maxScore: 1,
        scoringRule: 'one_word',
        hasOverride: false,
      }));
    // The saved snapshot claims 6/6; the exact-case re-check awards 5/6.
    const section = {
      id: 'sec-1',
      submissionId: 'sub-1',
      section: READING_MODULE,
      answers: { type: READING_MODULE, passages: [], answers },
      autoGradingResults: {
        generatedAt: AUTO_GRADING_TIMESTAMP,
        totalScore: 6,
        maxScore: 6,
        percentage: 100,
        questionResults,
      },
      gradingStatus: 'auto_graded',
      submittedAt: AUTO_GRADING_TIMESTAMP,
    } as unknown as SectionSubmission;

    expect(deriveIeltsBandScore(examState, READING_MODULE, 5)).toBe(2.5);
    expect(deriveIeltsBandScore(examState, READING_MODULE, 6)).toBe(3);
    expect(findStaleOverrides(overviewRows(examState, section))).toEqual([STALE_QUESTION_ID]);
    expect(buildObjectiveSectionDisplaySummary(examState, section, READING_MODULE)).toMatchObject({
      totalScore: 5,
      maxScore: 6,
      correctCount: 5,
      savedOutOfDate: true,
    });

    const wide = buildWide(examState, section);
    const wideRow = wide.rows[0]!;
    expect(wideRow[`score:${STALE_QUESTION_ID}`]).toBe(0);
    expect(wideRow['score:q-1']).toBe(1);
    expect(wideRow['totalScore']).toBe(5);
    expect(wideRow['maxScore']).toBe(6);
    expect(wideRow['correctCount']).toBe(5);
    expect(wideRow['percentage']).toBeCloseTo((5 / 6) * 100, 5);
    expect(wideRow['ieltsBandScore']).toBe(2.5);

    const table = tableRows(examState, wide);
    expect(table.find((row) => row.studentAnswer === '28th june')).toMatchObject({
      correct: 'No',
      score: '0',
    });
    expect(table.filter((row) => row.correct === 'Yes')).toHaveLength(5);

    const chunks = pdfTextChunks(examState, wide);
    expect(chunks).toContain('5/6');
    expect(chunks.indexOf('Correct:')).toBeGreaterThanOrEqual(0);
    const correctLabelIndex = chunks.indexOf('Correct:');
    expect(chunks[correctLabelIndex + 1]).toBe('5');
    const bandLabelIndex = chunks.indexOf('Band:');
    expect(chunks[bandLabelIndex + 1]).toBe('2.5');
    expect(chunks).toContain('No');
    expect(chunks).toContain('Yes');
  });
});

/** Question ids the overview flags as out of date (rows are exceptions only). */
function findStaleOverrides(
  rows: ReturnType<typeof buildExamObjectiveOverviewRows>,
): string[] {
  return rows.filter((row) => row.savedResultOutOfDate).map((row) => row.questionId);
}

describe('saved overrides keep precedence over the re-check', () => {
  test('a per-student manual override stays Correct', () => {
    const examState = staleCaseExam();
    const section = staleSubmission({
      hasOverride: false,
      manualOverride: {
        isCorrect: true,
        awardedScore: 1,
        overriddenBy: 'teacher-1',
        overriddenAt: '2026-01-02T00:00:00.000Z',
        reason: 'Accepted after review',
      },
    });

    const row = overviewRows(examState, section)[0];
    expect(row).toMatchObject({
      isCorrect: true,
      awardedScore: 1,
      savedResultOutOfDate: false,
    });
    expect(row?.manualOverride?.overriddenBy).toBe('teacher-1');

    const item = tracebackItems(examState, section)[0];
    expect(item).toMatchObject({ correctness: true, awardedScore: 1 });

    const wide = buildWide(examState, section);
    expect(wide.rows[0]?.[`score:${STALE_QUESTION_ID}`]).toBe(1);
    expect(wide.rows[0]?.['totalScore']).toBe(1);
    expect(wide.rows[0]?.['correctCount']).toBe(1);
    expect(tableRows(examState, wide)[0]?.correct).toBe('Yes');
  });

  test('a schedule answer-key override stays Correct', () => {
    const examState = staleCaseExam();
    const section = staleSubmission({ hasOverride: true });

    const row = overviewRows(examState, section)[0];
    expect(row).toMatchObject({
      isCorrect: true,
      awardedScore: 1,
      savedResultOutOfDate: false,
    });

    const item = tracebackItems(examState, section)[0];
    expect(item).toMatchObject({ correctness: true, awardedScore: 1 });

    const wide = buildWide(examState, section);
    expect(wide.rows[0]?.[`score:${STALE_QUESTION_ID}`]).toBe(1);
    expect(wide.rows[0]?.['totalScore']).toBe(1);
    expect(wide.rows[0]?.['correctCount']).toBe(1);
    expect(tableRows(examState, wide)[0]?.correct).toBe('Yes');
  });
});

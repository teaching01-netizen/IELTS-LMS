import { expect, test } from '@playwright/test';
import { getStudentQuestionsForModule } from '../src/features/exam-authoring/api/examAuthoringGateway';
import { scoreObjectiveDescriptors } from '../src/features/grading/objectiveScoring';
import { buildCaseSensitiveMap } from '../src/components/admin/gradingAnswerUtils';
import { buildExamObjectiveOverviewRows } from '../src/components/admin/examObjectiveOverviewUtils';
import {
  buildObjectiveExportRows,
  buildQuestionTracebackGroups,
  buildWideObjectiveExport,
} from '../src/components/admin/gradingReviewUtils';
import { buildObjectiveQuestionTableRows } from '../src/components/admin/gradingPerStudentExport/objective/tableRows';
import { buildStudentPdfBytes } from '../src/components/admin/gradingPerStudentExport/studentPdf';
import type { ExamState } from '../src/types';
import { readingExam, sectionFor } from './helpers/ieltsGradingFixtures';

// Prod-like flow: student types/picks (stored answer shapes exactly as the
// delivery UI writes them) → auto-grade → traceback review → overall check →
// wide export → per-student table → real PDF bytes. No mocks anywhere.
// Go parity is proven by the shared parity fixture (both suites read
// testdata/objective-grading-parity/full-coverage-exam.json); this spec proves
// every website surface agrees with the website scorer on one realistic exam.

function buildFlowExam(): ExamState {
  return readingExam('IELTS Flow E2E', [
    {
      id: 'tfng-block',
      type: 'TFNG',
      instruction: '',
      mode: 'TFNG',
      questions: [{ id: 'tfng-1', statement: 'The event opens in June.', correctAnswer: 'T' }],
    },
    {
      id: 'cloze-block',
      type: 'CLOZE',
      instruction: '',
      answerRule: 'ONE_WORD',
      questions: [{ id: 'cloze-1', prompt: 'The opening is ____.', correctAnswer: 'daily' }],
    },
    {
      id: 'short-block',
      type: 'SHORT_ANSWER',
      instruction: '',
      questions: [{ id: 'short-1', prompt: 'Who opened it?', correctAnswer: 'Urwin', acceptedAnswers: ['Urwin', 'URWIN'], answerRule: 'ONE_WORD' }],
    },
    {
      id: 'match-block',
      type: 'MATCHING',
      instruction: '',
      headings: [{ id: 'H1', text: 'First' }, { id: 'H2', text: 'Second' }],
      questions: [{ id: 'match-1', paragraphLabel: 'C', correctHeading: 'H2' }],
    },
    {
      id: 'map-block',
      type: 'MAP',
      instruction: '',
      questions: [{ id: 'map-1', label: 'Gate', correctAnswer: 'North Gate', x: 10, y: 20 }],
    },
    {
      id: 'note-block',
      type: 'NOTE_COMPLETION',
      instruction: 'Complete the notes.',
      questions: [{
        id: 'note-1',
        noteText: 'Surname: ____. Hall: ____ ____.',
        answerRule: 'ONE_WORD',
        blanks: [
          { id: 'nblank-1', correctAnswer: 'Urwin', acceptedAnswers: ['Urwin', 'URWIN'], position: 0 },
          { id: 'nblank-2', correctAnswer: 'Garden', position: 1 },
          { id: 'nblank-3', correctAnswer: 'Hall', position: 2 },
        ],
      }],
    },
    {
      id: 'table-block',
      type: 'TABLE_COMPLETION',
      instruction: '',
      answerRule: 'ONE_WORD',
      headers: ['Answer'],
      rows: [[''], ['']],
      cells: [
        { id: 'cell-1', row: 0, col: 0, correctAnswer: 'Garden' },
        { id: 'cell-2', row: 1, col: 0, correctAnswer: 'Hall' },
      ],
    },
    {
      id: 'single-block',
      type: 'SINGLE_MCQ',
      instruction: '',
      stem: 'Choose one',
      options: [
        { id: 'Option-A', text: 'Alpha', isCorrect: true },
        { id: 'Option-B', text: 'Beta', isCorrect: false },
      ],
    },
    {
      id: 'multi-block',
      type: 'MULTI_MCQ',
      instruction: '',
      stem: 'Choose two',
      requiredSelections: 2,
      options: [
        { id: 'o1', text: 'One', isCorrect: true },
        { id: 'o2', text: 'Two', isCorrect: true },
        { id: 'o3', text: 'Three', isCorrect: false },
      ],
    },
    {
      id: 'class-block',
      type: 'CLASSIFICATION',
      instruction: '',
      categories: ['A', 'B'],
      items: [{ id: 'ci1', text: 'Item one', correctCategory: 'A' }],
    },
    {
      id: 'feat-block',
      type: 'MATCHING_FEATURES',
      instruction: '',
      options: ['X', 'Y'],
      features: [{ id: 'fi1', text: 'Feature one', correctMatch: 'X' }],
    },
  ], { content: 'Mr Urwin opened the Garden Hall on 28 June.' });
}

// Stored shapes exactly as the delivery UI writes them.
function correctAnswers(): Record<string, unknown> {
  return {
    'tfng-1': 'T',
    'cloze-1': 'daily',
    'short-1': 'Urwin',
    'match-1': 'H2',
    'map-1': 'North Gate',
    'note-1': ['Urwin', 'Garden', 'Hall'],
    'table-block': ['Garden', 'Hall'],
    'single-block': 'Option-A',
    'multi-block': ['o1', 'o2'],
    'class-block': ['A'],
    'feat-block': ['X'],
  };
}

function wrongAnswers(): Record<string, unknown> {
  return {
    // Control-selected types get a wrong option; typed types get case-flipped
    // values that must fail under default-strict policy.
    'tfng-1': 'F',
    'cloze-1': 'Daily',
    'short-1': 'urwin',
    'match-1': 'H1',
    'map-1': 'north gate',
    'note-1': ['urwin', 'garden', 'hall'],
    'table-block': ['garden', 'hall'],
    'single-block': 'Option-B',
    'multi-block': ['o1', 'o3'],
    'class-block': ['B'],
    'feat-block': ['Y'],
  };
}

function runFullFlow(state: ExamState, answers: Record<string, unknown>) {
  const descriptors = getStudentQuestionsForModule(state, 'reading');
  const scoring = scoreObjectiveDescriptors(descriptors, answers as never);
  const section = sectionFor(state, answers, scoring);

  const groups = buildQuestionTracebackGroups(state, section, 'reading');
  const items = groups.flatMap((group) => group.items);
  const overviewRows = buildExamObjectiveOverviewRows(
    [{ submission: { id: 'submission-1', studentName: 'Flow Student' }, sections: [section] }],
    { examState: state },
  );
  const wide = buildWideObjectiveExport({
    session: { examTitle: 'IELTS Flow E2E', sessionId: 'session-1' },
    submissions: [{
      id: 'submission-1', studentName: 'Flow Student', scheduleId: 'sched-1',
      studentId: 'st-1', cohortName: 'c', submittedAt: '2026-01-01T00:00:00.000Z',
    } as never],
    sectionSubmissions: [{ submissionId: 'submission-1', sectionSubmission: section }],
    examState: state,
    moduleType: 'reading',
    mode: 'auto',
  });
  const wideRow = wide.rows[0]!;
  const caseMap = buildCaseSensitiveMap(descriptors);
  const table = buildObjectiveQuestionTableRows(wide.columns, wideRow, { caseSensitiveByQuestionId: caseMap });
  const pdfBytes = buildStudentPdfBytes(
    {
      submissionId: 'submission-1', studentName: 'Flow Student', studentId: 'st-1',
      sectionData: { reading: { columns: wide.columns, row: wideRow, caseSensitiveByQuestionId: caseMap } },
    },
    ['reading'],
    new Date('2026-01-01T00:00:00.000Z'),
  );
  return { descriptors, scoring, groups, items, overviewRows, wide, wideRow, table, pdfBytes, section };
}

test.describe('IELTS student → check → export PDF flow', () => {
  test('all-correct student: every surface agrees, PDF valid', async () => {
    const state = buildFlowExam();
    const flow = runFullFlow(state, correctAnswers());

    expect(flow.scoring.totalScore).toBe(flow.scoring.maxScore);
    expect(flow.scoring.maxScore).toBeGreaterThan(10);

    // Traceback review matches the scorer on every item.
    for (const item of flow.items) {
      const score = flow.scoring.byId.get(item.questionId);
      expect(item.correctness, item.questionId).toBe(score?.correctness ?? null);
      expect(item.awardedScore, item.questionId).toBe(score?.awardedScore ?? null);
      expect(item.maxScore, item.questionId).toBe(score?.maxScore ?? null);
    }
    const awardedSum = flow.items.reduce((sum, item) => sum + (item.awardedScore ?? 0), 0);
    const maxSum = flow.items.reduce((sum, item) => sum + (item.maxScore ?? 0), 0);
    expect(awardedSum).toBe(flow.scoring.totalScore);
    expect(maxSum).toBe(flow.scoring.maxScore);

    // Overview audit never contradicts the scorer where it surfaces a row.
    for (const row of flow.overviewRows) {
      expect(row.isCorrect, row.questionId).toBe(flow.scoring.byId.get(row.questionId)?.correctness ?? null);
    }

    // Wide export carries the same totals; per-student Yes rows add up.
    expect(flow.wideRow['totalScore']).toBe(flow.scoring.totalScore);
    expect(flow.wideRow['maxScore']).toBe(flow.scoring.maxScore);
    const yesCount = flow.table.filter((row) => row.correct === 'Yes').length;
    const scoreSum = flow.table.reduce((sum, row) => sum + (Number(row.score) || 0), 0);
    expect(yesCount).toBe(flow.scoring.totalScore);
    expect(scoreSum).toBe(flow.scoring.totalScore);

    // Real PDF bytes, generated through the threaded export path.
    expect(flow.pdfBytes.length).toBeGreaterThan(1000);
    expect(Buffer.from(flow.pdfBytes.subarray(0, 4)).toString('latin1')).toBe('%PDF');

    // Row-level export API agrees too.
    const rowExports = buildObjectiveExportRows({
      session: { examTitle: 'IELTS Flow E2E', sessionId: 'session-1' },
      submission: { id: 'submission-1', studentName: 'Flow Student', scheduleId: 'sched-1', studentId: 'st-1', cohortName: 'c' } as never,
      sectionSubmission: flow.section,
      examState: state,
      moduleType: 'reading',
    });
    expect(rowExports.length).toBeGreaterThan(0);
  });

  test('all-wrong student: strict case fails everywhere including PDF table', async () => {
    const state = buildFlowExam();
    const flow = runFullFlow(state, wrongAnswers());

    // Only the choose-2 partial credit survives (o1 correct of o1+o3): 1 point.
    // Every typed answer and every other choice is Incorrect.
    expect(flow.scoring.totalScore).toBe(1);
    for (const item of flow.items) {
      expect(item.correctness, item.questionId).not.toBe(true);
    }
    for (const row of flow.overviewRows) {
      expect(row.isCorrect, row.questionId).toBe(flow.scoring.byId.get(row.questionId)?.correctness ?? null);
    }
    const yesRows = flow.table.filter((row) => row.correct === 'Yes');
    expect(yesRows).toHaveLength(1);
    expect(flow.table.filter((row) => row.correct === 'No').length).toBeGreaterThan(10);
    expect(flow.wideRow['totalScore']).toBe(1);
    expect(flow.pdfBytes.length).toBeGreaterThan(1000);
    expect(Buffer.from(flow.pdfBytes.subarray(0, 4)).toString('latin1')).toBe('%PDF');

    // The original report: lowercase urwin is Incorrect, not just unscored.
    const shortRow = flow.table.find((row) => row.studentAnswer === 'urwin');
    expect(shortRow?.correct).toBe('No');
  });

  test('grouped-Note correct group yields one Yes row to PDF', async () => {
    const state = readingExam('IELTS Group Flow', [{
      id: 'gnote-block',
      type: 'NOTE_COMPLETION',
      instruction: '',
      questions: [{
        id: 'gq',
        noteText: 'A ____ and ____.',
        answerRule: 'ONE_WORD',
        blanks: [
          { id: 'g1', position: 0, correctAnswer: 'Urwin', scoreGroupId: 'grp', requiredCorrect: 2 },
          { id: 'g2', position: 1, correctAnswer: 'Garden', scoreGroupId: 'grp', requiredCorrect: 2 },
        ],
      }],
    }], { content: 'Grouped.' });
    const flow = runFullFlow(state, { gq: ['Urwin', 'Garden'] });
    expect(flow.scoring.totalScore).toBe(1);
    expect(flow.scoring.maxScore).toBe(1);
    const yesRows = flow.table.filter((row) => row.correct === 'Yes');
    expect(yesRows).toHaveLength(1);
    expect(flow.wideRow['totalScore']).toBe(1);
    expect(flow.pdfBytes.length).toBeGreaterThan(500);
  });

  test('grouped-Note partial credit stays consistent to PDF', async () => {
    const state = readingExam('IELTS Group Flow', [{
      id: 'gnote-block',
      type: 'NOTE_COMPLETION',
      instruction: '',
      questions: [{
        id: 'gq',
        noteText: 'A ____ and ____.',
        answerRule: 'ONE_WORD',
        blanks: [
          { id: 'g1', position: 0, correctAnswer: 'Urwin', scoreGroupId: 'grp', requiredCorrect: 2 },
          { id: 'g2', position: 1, correctAnswer: 'Garden', scoreGroupId: 'grp', requiredCorrect: 2 },
        ],
      }],
    }], { content: 'Grouped.' });
    // One right (exact case), one wrong case: group needs 2 → 0/1 everywhere.
    const flow = runFullFlow(state, { gq: ['Urwin', 'garden'] });
    expect(flow.scoring.totalScore).toBe(0);
    expect(flow.scoring.maxScore).toBe(1);
    expect(flow.wideRow['totalScore']).toBe(0);
    const yesCount = flow.table.filter((row) => row.correct === 'Yes').length;
    expect(yesCount).toBe(0);
    expect(flow.pdfBytes.length).toBeGreaterThan(500);
  });
});

import { expect, test } from '@playwright/test';
import { getStudentQuestionsForModule } from '../src/features/exam-authoring/api/examAuthoringGateway';
import { scoreObjectiveDescriptors } from '../src/features/grading/objectiveScoring';
import {
  buildCaseSensitiveMap,
  isStudentAnswerCorrect,
} from '../src/components/admin/gradingAnswerUtils';
import { buildExamObjectiveOverviewRows } from '../src/components/admin/examObjectiveOverviewUtils';
import {
  buildQuestionTracebackGroups,
  buildWideObjectiveExport,
} from '../src/components/admin/gradingReviewUtils';
import { buildObjectiveQuestionTableRows } from '../src/components/admin/gradingPerStudentExport/objective/tableRows';
import { buildStudentPdfBytes } from '../src/components/admin/gradingPerStudentExport/studentPdf';
import type { ExamState, QuestionBlock } from '../src/types';
import { readingExam, sectionFor } from './helpers/ieltsGradingFixtures';

// 100% matrices: every question type × every input class a student can produce.
// Each case asserts scorer == traceback == overview (where surfaced) and the
// aggregates assert wide export + table Yes-count + real PDF bytes.
// Word-count probe (locked here): answerRule never gates grading verdicts.

const MATRICES_PASSAGE = { id: 'p1', title: 'P1', content: 'Content.' };

function examWith(blocks: QuestionBlock[]): ExamState {
  return readingExam('IELTS Matrices', blocks, MATRICES_PASSAGE);
}

function checkSurfaces(
  state: ExamState,
  answers: Record<string, unknown>,
  expected: Record<string, boolean | null>,
  ruleFor?: (blockType: string) => string,
) {
  const descriptors = getStudentQuestionsForModule(state, 'reading');
  const scoring = scoreObjectiveDescriptors(descriptors, answers as never);
  for (const [id, want] of Object.entries(expected)) {
    expect(scoring.byId.get(id)?.correctness, `score ${id}`).toBe(want);
    expect(isStudentAnswerCorrect(descriptors.find((d) => d.id === id)!, answers as never), `direct ${id}`).toBe(want);
  }
  const section = sectionFor(state, answers, scoring, ruleFor);
  const items = buildQuestionTracebackGroups(state, section, 'reading').flatMap((g) => g.items);
  for (const item of items) {
    if (item.questionId in expected) {
      expect(item.correctness, `traceback ${item.questionId}`).toBe(expected[item.questionId]);
    }
  }
  const rows = buildExamObjectiveOverviewRows(
    [{ submission: { id: 'sub-1', studentName: 'S' }, sections: [section] }],
    { examState: state },
  );
  for (const row of rows) {
    expect(row.isCorrect, `overview ${row.questionId}`).toBe(
      scoring.byId.get(row.questionId)?.correctness ?? null,
    );
  }
  return { descriptors, scoring, section };
}

const noteBlanks = (extra = {}) => ([
  { id: 'b1', correctAnswer: 'Urwin', acceptedAnswers: ['Urwin', 'URWIN'], position: 0, ...(extra as object) },
  { id: 'b2', correctAnswer: 'Garden', position: 1, ...(extra as object) },
]);

function noteExam(blanks: ReturnType<typeof noteBlanks>): ExamState {
  return examWith([{
    id: 'nb', type: 'NOTE_COMPLETION', instruction: '',
    questions: [{ id: 'nq', noteText: 'A ____ B ____.', blanks, answerRule: 'ONE_WORD' }],
  }]);
}

test.describe('question-type input matrices', () => {
  test('TFNG: options, lowercase, invalid, empty, YNNG mode', async () => {
    const tfng = (mode: 'TFNG' | 'YNNG', correctAnswer: 'T' | 'F' | 'NG' | 'Y' | 'N'): ExamState => examWith([{
      id: 'tb', type: 'TFNG', instruction: '', mode,
      questions: [{ id: 't1', statement: 'S.', correctAnswer }],
    }]);
    const rule = () => 'tfng';
    checkSurfaces(tfng('TFNG', 'T'), { t1: 'T' }, { t1: true }, rule);
    checkSurfaces(tfng('TFNG', 'T'), { t1: 'F' }, { t1: false }, rule);
    checkSurfaces(tfng('TFNG', 'T'), { t1: 't' }, { t1: false }, rule);
    checkSurfaces(tfng('TFNG', 'T'), { t1: 'X' }, { t1: false }, rule);
    checkSurfaces(tfng('TFNG', 'T'), {}, { t1: false }, rule);
    checkSurfaces(tfng('YNNG', 'Y'), { t1: 'Y' }, { t1: true }, rule);
    checkSurfaces(tfng('YNNG', 'Y'), { t1: 'y' }, { t1: false }, rule);
    checkSurfaces(tfng('YNNG', 'NG'), { t1: 'NG' }, { t1: true }, rule);
  });

  test('CLOZE full battery incl. punctuation keys and opt-out mirror', async () => {
    const cloze = (correctAnswer: string, acceptedAnswers?: string[], extra = {}) => examWith([{
      id: 'cb', type: 'CLOZE', instruction: '', answerRule: 'ONE_WORD',
      questions: [{ id: 'c1', prompt: 'P ____.', correctAnswer, ...(acceptedAnswers ? { acceptedAnswers } : {}), ...extra }],
    }]);
    const daily = cloze('daily');
    checkSurfaces(daily, { c1: 'daily' }, { c1: true });
    checkSurfaces(daily, { c1: 'Daily' }, { c1: false });
    checkSurfaces(daily, { c1: '  daily  ' }, { c1: true });
    checkSurfaces(daily, { c1: '' }, { c1: false });
    checkSurfaces(daily, { c1: 'dailyx' }, { c1: false });
    checkSurfaces(cloze('daily', undefined, { caseSensitive: false }), { c1: 'Daily' }, { c1: true });
    const art = cloze('state-of-the-art', ['state-of-the-art', 'advanced']);
    checkSurfaces(art, { c1: 'state of the art' }, { c1: true });
    checkSurfaces(art, { c1: 'State of the art' }, { c1: false });
    checkSurfaces(art, { c1: 'advanced' }, { c1: true });
    checkSurfaces(art, { c1: 'ADVANCED' }, { c1: false });
    checkSurfaces(cloze('waiter'), { c1: 'waiter ' }, { c1: true });
    checkSurfaces(cloze('1790'), { c1: '1790' }, { c1: true });
    checkSurfaces(cloze('1790'), { c1: 'in 1790' }, { c1: false });
  });

  test('SHORT full battery incl. invisible, accents, empty family', async () => {
    const short = (correctAnswer: string, acceptedAnswers?: string[], extra = {}) => examWith([{
      id: 'sb', type: 'SHORT_ANSWER', instruction: '',
      questions: [{ id: 's1', prompt: 'Who?', correctAnswer, ...(acceptedAnswers ? { acceptedAnswers } : {}), answerRule: 'ONE_WORD', ...extra }],
    }]);
    checkSurfaces(short('Urwin', ['Urwin', 'URWIN']), { s1: 'URWIN' }, { s1: true });
    checkSurfaces(short('Urwin', ['Urwin', 'URWIN']), { s1: 'urwin' }, { s1: false });
    checkSurfaces(short('Urwin', ['Urwin', 'URWIN']), { s1: '  Urwin\n' }, { s1: true });
    checkSurfaces(short('café'), { s1: 'cafe' }, { s1: false });
    checkSurfaces(short('café'), { s1: 'CAFÉ' }, { s1: false });
    checkSurfaces(short('x'), { s1: '' }, { s1: false });
    checkSurfaces(short('x'), { s1: '   ' }, { s1: false });
    checkSurfaces(short('x'), {}, { s1: false });
    checkSurfaces(short('x'), { s1: ['x', 'y'] } as never, { s1: false });
    checkSurfaces(short('dog', ['dog', 'cat']), { s1: 'cat' }, { s1: true });
    checkSurfaces(short('dog', ['dog', 'cat']), { s1: 'Cat' }, { s1: false });
  });

  test('MATCHING headings: exact, wrong, case-flip, unknown, empty', async () => {
    const matching = () => examWith([{
      id: 'mb', type: 'MATCHING', instruction: '',
      headings: [{ id: 'H1', text: 'First' }, { id: 'H2', text: 'Second' }],
      questions: [{ id: 'm1', paragraphLabel: 'C', correctHeading: 'H2' }],
    }]);
    const rule = () => 'matching';
    checkSurfaces(matching(), { m1: 'H2' }, { m1: true }, rule);
    checkSurfaces(matching(), { m1: 'H1' }, { m1: false }, rule);
    checkSurfaces(matching(), { m1: 'h2' }, { m1: false }, rule);
    checkSurfaces(matching(), { m1: 'H9' }, { m1: false }, rule);
    checkSurfaces(matching(), {}, { m1: false }, rule);
  });

  test('MAP free text + precedence + opt-out', async () => {
    const map = (q: object) => examWith([{ id: 'mp', type: 'MAP', instruction: '', questions: [{ id: 'm1', label: 'Gate', x: 1, y: 2, ...q }] } as never]);
    checkSurfaces(map({ correctAnswer: 'North Gate' }), { m1: 'North Gate' }, { m1: true });
    checkSurfaces(map({ correctAnswer: 'North Gate' }), { m1: 'north gate' }, { m1: false });
    checkSurfaces(map({ correctAnswer: 'North Gate', caseSensitive: false }), { m1: 'north gate' }, { m1: true });
    checkSurfaces(map({ correctAnswer: 'North Gate' }), { m1: '' }, { m1: false });
    checkSurfaces(map({ correctAnswer: 'North Gate', acceptedAnswers: ['north entrance'] }), { m1: 'north entrance' }, { m1: false });
    checkSurfaces(map({ correctAnswer: '', acceptedAnswers: ['north entrance'] }), { m1: 'north entrance' }, { m1: true });
  });

  test('SENTENCE blanks + word-count probe (rule never gates)', async () => {
    const sent = (blanks: object[], extraQ = {}) => examWith([{
      id: 'sn', type: 'SENTENCE_COMPLETION', instruction: '',
      questions: [{ id: 's1', sentence: 'A ____ B ____.', blanks, answerRule: 'ONE_WORD', ...extraQ }],
    }]);
    const blanks = [
      { id: 'b1', position: 0, correctAnswer: 'alpha' },
      { id: 'b2', position: 1, correctAnswer: 'beta' },
    ];
    checkSurfaces(sent(blanks), { s1: ['alpha', 'beta'] }, { 's1:b1': true, 's1:b2': true });
    checkSurfaces(sent(blanks), { s1: ['beta', 'alpha'] }, { 's1:b1': false, 's1:b2': false });
    checkSurfaces(sent(blanks), { s1: ['Alpha', 'beta'] }, { 's1:b1': false, 's1:b2': true });
    checkSurfaces(sent(blanks), { s1: ['', 'beta'] }, { 's1:b1': false, 's1:b2': true });
    // Probe locked: three words under ONE_WORD still grade by text match.
    checkSurfaces(sent([{ id: 'b1', position: 0, correctAnswer: 'a b c' }]), { s1: ['a b c'] }, { 's1:b1': true });
  });

  test('NOTE blanks incl. short/long arrays and opt-out', async () => {
    checkSurfaces(noteExam(noteBlanks()), { nq: ['Urwin', 'Garden'] }, { 'nq:b1': true, 'nq:b2': true });
    checkSurfaces(noteExam(noteBlanks()), { nq: ['urwin', 'garden'] }, { 'nq:b1': false, 'nq:b2': false });
    checkSurfaces(noteExam(noteBlanks({ caseSensitive: false })), { nq: ['urwin', 'garden'] }, { 'nq:b1': true, 'nq:b2': true });
    const three = noteBlanks();
    void three;
    const state = noteExam(noteBlanks());
    // Only 2 slots exist: extra elements ignored, missing covered above.
    checkSurfaces(state, { nq: ['Urwin', 'Garden', 'Extra'] }, { 'nq:b1': true, 'nq:b2': true });
    checkSurfaces(state, { nq: 'Urwin' } as never, { 'nq:b1': false, 'nq:b2': false });
  });

  test('TABLE cells incl. grouped threshold and opt-out', async () => {
    const table = (cells: object[]) => examWith([{
      id: 'tb', type: 'TABLE_COMPLETION', instruction: '', answerRule: 'ONE_WORD',
      headers: ['A'], rows: [[''], ['']], cells,
    }]);
    const cells = [
      { id: 'c1', row: 0, col: 0, correctAnswer: 'Garden' },
      { id: 'c2', row: 1, col: 0, correctAnswer: 'Hall' },
    ];
    checkSurfaces(table(cells), { tb: ['Garden', 'Hall'] }, { 'tb:c1': true, 'tb:c2': true });
    checkSurfaces(table(cells), { tb: ['garden', 'Hall'] }, { 'tb:c1': false, 'tb:c2': true });
    checkSurfaces(table([{ ...cells[0], caseSensitive: false }, cells[1]]), { tb: ['garden', 'Hall'] }, { 'tb:c1': true, 'tb:c2': true });
    checkSurfaces(table(cells), { tb: ['Garden'] }, { 'tb:c1': true, 'tb:c2': false });
  });

  test('DIAGRAM and FLOW slots incl. arrays and opt-out', async () => {
    const dg = examWith([{ id: 'dg', type: 'DIAGRAM_LABELING', instruction: '', imageUrl: '', labels: [{ id: 'l1', x: 1, y: 2, correctAnswer: 'North' }] }]);
    checkSurfaces(dg, { dg: ['North'] }, { 'dg:l1': true });
    checkSurfaces(dg, { dg: ['north'] }, { 'dg:l1': false });
    checkSurfaces(dg, { dg: ['north', 'extra'] }, { 'dg:l1': false });
    checkSurfaces(dg, { dg: [] }, { 'dg:l1': false });
    const fl = examWith([{ id: 'fl', type: 'FLOW_CHART', instruction: '', steps: [{ id: 's1', label: 'Step', correctAnswer: 'First', caseSensitive: false }] }]);
    checkSurfaces(fl, { fl: ['first'] }, { 'fl:s1': true });
    checkSurfaces(fl, { fl: ['Second'] }, { 'fl:s1': false });
  });

  test('CLASSIFICATION and MATCHING_FEATURES selects', async () => {
    const cl = examWith([{ id: 'cl', type: 'CLASSIFICATION', instruction: '', categories: ['A', 'B'], items: [{ id: 'i1', text: 'Item', correctCategory: 'A' }] }]);
    checkSurfaces(cl, { cl: ['A'] }, { 'cl:i1': true }, () => 'classification');
    checkSurfaces(cl, { cl: ['B'] }, { 'cl:i1': false }, () => 'classification');
    checkSurfaces(cl, { cl: ['a'] }, { 'cl:i1': false }, () => 'classification');
    checkSurfaces(cl, { cl: ['Z'] }, { 'cl:i1': false }, () => 'classification');
    checkSurfaces(cl, {}, { 'cl:i1': false }, () => 'classification');
    const ft = examWith([{ id: 'ft', type: 'MATCHING_FEATURES', instruction: '', options: ['X', 'Y'], features: [{ id: 'f1', text: 'Feat', correctMatch: 'X' }] }]);
    checkSurfaces(ft, { ft: ['X'] }, { 'ft:f1': true }, () => 'matching_features');
    checkSurfaces(ft, { ft: ['Y'] }, { 'ft:f1': false }, () => 'matching_features');
    checkSurfaces(ft, { ft: ['x'] }, { 'ft:f1': false }, () => 'matching_features');
  });

  test('SINGLE exact IDs, empties, duplicates on MULTI, over-select', async () => {
    const sg = examWith([{ id: 'sg', type: 'SINGLE_MCQ', instruction: '', stem: 'Pick', options: [{ id: 'o1', text: 'One', isCorrect: true }, { id: 'o2', text: 'Two', isCorrect: false }] }]);
    const srule = () => 'single_choice';
    checkSurfaces(sg, { sg: 'o1' }, { sg: true }, srule);
    checkSurfaces(sg, { sg: 'o2' }, { sg: false }, srule);
    checkSurfaces(sg, { sg: 'O1' }, { sg: false }, srule);
    checkSurfaces(sg, { sg: '' }, { sg: false }, srule);
    checkSurfaces(sg, {}, { sg: false }, srule);
    const mu = examWith([{ id: 'mu', type: 'MULTI_MCQ', instruction: '', stem: 'Pick two', requiredSelections: 2, options: [{ id: 'o1', text: 'One', isCorrect: true }, { id: 'o2', text: 'Two', isCorrect: true }, { id: 'o3', text: 'Three', isCorrect: false }] }]);
    const mrule = () => 'multi_choice';
    const sc = (a: unknown) => scoreObjectiveDescriptors(getStudentQuestionsForModule(mu, 'reading'), { mu: a } as never);
    expect(sc(['o1', 'o2']).byId.get('mu')).toMatchObject({ correctness: true, awardedScore: 2, maxScore: 2 });
    expect(sc(['o1']).byId.get('mu')).toMatchObject({ correctness: false, awardedScore: 1, maxScore: 2 });
    expect(sc(['o1', 'o2', 'o3']).byId.get('mu')).toMatchObject({ correctness: false, awardedScore: 0 });
    expect(sc(['o1', 'o1']).byId.get('mu')?.correctness).toBe(false);
    expect(sc(['O1', 'o2']).byId.get('mu')?.correctness).toBe(false);
    expect(sc([]).byId.get('mu')?.status).toBe('verified_unanswered');
    checkSurfaces(mu, { mu: ['o1', 'o2'] }, { mu: true }, mrule);
    checkSurfaces(mu, { mu: ['o1', 'o3'] }, { mu: false }, mrule);
  });

  test('TREE unordered, distinctness, optional, case flags', async () => {
    const tree = (leaves: object[]) => examWith([{
      id: 'tr', type: 'SHORT_ANSWER', instruction: '', questions: [],
      subAnswerModeEnabled: true, answerTree: [{ id: 'r1', children: leaves }],
    }]);
    const leaves = [
      { id: 'lf1', acceptedAnswers: ['yes'], required: true },
      { id: 'lf2', acceptedAnswers: ['no'], required: true },
      { id: 'lf3', acceptedAnswers: ['maybe'], required: false },
    ];
    const ids = (a: unknown) => a as never;
    checkSurfaces(tree(leaves), { 'tr::tree::r1::lf1': 'yes', 'tr::tree::r1::lf2': 'no' }, { 'tr::tree::r1::lf1': true, 'tr::tree::r1::lf2': true });
    // Swapped still satisfies distinct required leaves (root correct); per-leaf assignment follows the match.
    const swapped = scoreObjectiveDescriptors(getStudentQuestionsForModule(tree(leaves), 'reading'), ids({ 'tr::tree::r1::lf1': 'no', 'tr::tree::r1::lf2': 'yes' }));
    expect([...swapped.byId.values()][0]?.correctness).toBe(true);
    // One answer cannot satisfy two leaves.
    const dup = scoreObjectiveDescriptors(getStudentQuestionsForModule(tree(leaves), 'reading'), ids({ 'tr::tree::r1::lf1': 'yes', 'tr::tree::r1::lf2': 'yes' }));
    expect(dup.totalScore).toBe(0);
    // Optional leaf missing is fine when required leaves match.
    const opt = scoreObjectiveDescriptors(getStudentQuestionsForModule(tree(leaves), 'reading'), ids({ 'tr::tree::r1::lf1': 'yes', 'tr::tree::r1::lf2': 'no' }));
    expect(opt.totalScore).toBe(1);
    // Case flag per leaf (direct verdicts); the group fails on lf2's case,
    // so the shared mark is 0 while the opt-out leaf still matches directly.
    const cased = tree([
      { id: 'lf1', acceptedAnswers: ['yes'], required: true, caseSensitive: false },
      { id: 'lf2', acceptedAnswers: ['no'], required: true },
    ]);
    const casedDs = getStudentQuestionsForModule(cased, 'reading');
    const casedAnswers = { 'tr::tree::r1::lf1': 'YES', 'tr::tree::r1::lf2': 'NO' };
    expect(isStudentAnswerCorrect(casedDs.find((d) => d.id === 'tr::tree::r1::lf1')!, casedAnswers as never)).toBe(true);
    expect(isStudentAnswerCorrect(casedDs.find((d) => d.id === 'tr::tree::r1::lf2')!, casedAnswers as never)).toBe(false);
    expect(scoreObjectiveDescriptors(casedDs, casedAnswers as never).totalScore).toBe(0);
  });

  test('per-type aggregates agree to export and PDF', async () => {
    const state = buildAggregateExam();
    const answers: Record<string, unknown> = {
      'tfng-1': 'T', 'cz-1': 'daily', 'sh-1': 'Urwin', 'm-1': 'H2', 'map-1': 'North Gate',
      'nq': ['Urwin', 'Garden'], 'tbl': ['Garden', 'Hall'], 'dg': ['North'], 'fl': ['First'],
      'cl': ['A'], 'ft': ['X'], sg: 'o1', mu: ['o1', 'o2'],
      'tr::tree::r1::lf1': 'yes', 'tr::tree::r1::lf2': 'no',
    };
    verifyExportPdf(state, answers);
    const wrong: Record<string, unknown> = {
      'tfng-1': 'F', 'cz-1': 'Daily', 'sh-1': 'urwin', 'm-1': 'H1', 'map-1': 'north gate',
      'nq': ['urwin', 'garden'], 'tbl': ['garden', 'hall'], 'dg': ['north'], 'fl': ['first'],
      'cl': ['B'], 'ft': ['Y'], sg: 'o2', mu: ['o1', 'o3'],
      'tr::tree::r1::lf1': 'no', 'tr::tree::r1::lf2': 'no',
    };
    const flow = verifyExportPdf(state, wrong);
    // Only MULTI partial credit survives.
    expect(flow.scoring.totalScore).toBe(1);
  });
});

function buildAggregateExam(): ExamState {
  return examWith([
    { id: 'tfng-block', type: 'TFNG', instruction: '', mode: 'TFNG', questions: [{ id: 'tfng-1', statement: 'S.', correctAnswer: 'T' }] },
    { id: 'cz-block', type: 'CLOZE', instruction: '', answerRule: 'ONE_WORD', questions: [{ id: 'cz-1', prompt: 'P ____.', correctAnswer: 'daily' }] },
    { id: 'sh-block', type: 'SHORT_ANSWER', instruction: '', questions: [{ id: 'sh-1', prompt: 'Who?', correctAnswer: 'Urwin', acceptedAnswers: ['Urwin', 'URWIN'], answerRule: 'ONE_WORD' }] },
    { id: 'm-block', type: 'MATCHING', instruction: '', headings: [{ id: 'H1', text: 'F' }, { id: 'H2', text: 'S' }], questions: [{ id: 'm-1', paragraphLabel: 'C', correctHeading: 'H2' }] },
    { id: 'mp-block', type: 'MAP', instruction: '', questions: [{ id: 'map-1', label: 'Gate', correctAnswer: 'North Gate', x: 1, y: 2 }] },
    { id: 'n-block', type: 'NOTE_COMPLETION', instruction: '', questions: [{ id: 'nq', noteText: 'A ____ B ____.', answerRule: 'ONE_WORD', blanks: [{ id: 'b1', correctAnswer: 'Urwin', acceptedAnswers: ['Urwin', 'URWIN'], position: 0 }, { id: 'b2', correctAnswer: 'Garden', position: 1 }] }] },
    { id: 'tbl', type: 'TABLE_COMPLETION', instruction: '', answerRule: 'ONE_WORD', headers: ['A'], rows: [[''], ['']], cells: [{ id: 'c1', row: 0, col: 0, correctAnswer: 'Garden' }, { id: 'c2', row: 1, col: 0, correctAnswer: 'Hall' }] },
    { id: 'dg', type: 'DIAGRAM_LABELING', instruction: '', imageUrl: '', labels: [{ id: 'l1', x: 1, y: 2, correctAnswer: 'North' }] },
    { id: 'fl', type: 'FLOW_CHART', instruction: '', steps: [{ id: 's1', label: 'Step', correctAnswer: 'First' }] },
    { id: 'cl', type: 'CLASSIFICATION', instruction: '', categories: ['A', 'B'], items: [{ id: 'i1', text: 'Item', correctCategory: 'A' }] },
    { id: 'ft', type: 'MATCHING_FEATURES', instruction: '', options: ['X', 'Y'], features: [{ id: 'f1', text: 'Feat', correctMatch: 'X' }] },
    { id: 'sg', type: 'SINGLE_MCQ', instruction: '', stem: 'Pick', options: [{ id: 'o1', text: 'One', isCorrect: true }, { id: 'o2', text: 'Two', isCorrect: false }] },
    { id: 'mu', type: 'MULTI_MCQ', instruction: '', stem: 'Pick two', requiredSelections: 2, options: [{ id: 'o1', text: 'One', isCorrect: true }, { id: 'o2', text: 'Two', isCorrect: true }, { id: 'o3', text: 'Three', isCorrect: false }] },
    { id: 'tr', type: 'SHORT_ANSWER', instruction: '', questions: [], subAnswerModeEnabled: true, answerTree: [{ id: 'r1', children: [{ id: 'lf1', acceptedAnswers: ['yes'], required: true }, { id: 'lf2', acceptedAnswers: ['no'], required: true }] }] },
  ]);
}

function verifyExportPdf(state: ExamState, answers: Record<string, unknown>) {
  const ruleFor = (blockType: string) => ['TFNG', 'MATCHING', 'MAP', 'SINGLE_MCQ', 'MULTI_MCQ', 'CLASSIFICATION', 'MATCHING_FEATURES'].includes(blockType) ? blockType.toLowerCase() : 'one_word';
  const descriptors = getStudentQuestionsForModule(state, 'reading');
  const scoring = scoreObjectiveDescriptors(descriptors, answers as never);
  const section = sectionFor(state, answers, scoring, ruleFor);
  const wide = buildWideObjectiveExport({
    session: { examTitle: 'M', sessionId: 's' },
    submissions: [{ id: 'sub-1', studentName: 'S', scheduleId: 's', studentId: 's', cohortName: 'c' } as never],
    sectionSubmissions: [{ submissionId: 'sub-1', sectionSubmission: section }],
    examState: state,
    moduleType: 'reading',
    mode: 'auto',
  });
  const wideRow = wide.rows[0]!;
  expect(wideRow['totalScore']).toBe(scoring.totalScore);
  expect(wideRow['maxScore']).toBe(scoring.maxScore);
  const caseMap = buildCaseSensitiveMap(descriptors);
  const table = buildObjectiveQuestionTableRows(wide.columns, wideRow, { caseSensitiveByQuestionId: caseMap });
  expect(table.filter((r) => r.correct === 'Yes').length).toBe(scoring.totalScore);
  const pdf = buildStudentPdfBytes(
    {
      submissionId: 'sub-1', studentName: 'S', studentId: 's',
      sectionData: { reading: { columns: wide.columns, row: wideRow, caseSensitiveByQuestionId: caseMap } },
    },
    ['reading'],
    new Date('2026-01-01T00:00:00.000Z'),
  );
  expect(Buffer.from(pdf.subarray(0, 4)).toString('latin1')).toBe('%PDF');
  return { scoring, table };
}

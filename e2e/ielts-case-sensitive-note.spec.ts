import { expect, test } from '@playwright/test';
import { getStudentQuestionsForModule } from '../src/features/exam-authoring/api/examAuthoringGateway';
import { isQuestionAnswered, isQuestionFullyAnswered } from '../src/services/examAdapterService';
import { scoreObjectiveDescriptors } from '../src/features/grading/objectiveScoring';
import { isStudentAnswerCorrect } from '../src/components/admin/gradingAnswerUtils';
import {
  buildExamObjectiveOverviewRows,
} from '../src/components/admin/examObjectiveOverviewUtils';
import {
  buildWideObjectiveExport,
} from '../src/components/admin/gradingReviewUtils';
import { buildObjectiveQuestionTableRows } from '../src/components/admin/gradingPerStudentExport/objective/tableRows';
import type { ExamState } from '../src/types';
import type { SectionSubmission } from '../src/types/grading';
import {
  AUTO_GRADING_TIMESTAMP,
  READING_MODULE,
  readingExam,
  sectionWithSingleResult,
} from './helpers/ieltsGradingFixtures';

// E2EDD: executable end-to-end behavior first. No mocks, no snapshots.
// Vertical slice: exam JSON (caseSensitive flag) → website scorer → traceback
// → overview audit → wide export → per-student table rows. Go parity is
// covered by backend/go/internal/grading projection CaseSensitive paths.

function noteExam(caseSensitive: boolean | undefined): ExamState {
  const blanks = Array.from({ length: 8 }, (_, i) => {
    if (i !== 7) {
      return { id: `blank-${i + 1}`, correctAnswer: `word${i + 1}`, position: i };
    }
    return {
      id: 'blank-8',
      correctAnswer: 'Urwin',
      acceptedAnswers: ['Urwin', 'URWIN'],
      position: 7,
      ...(caseSensitive === undefined ? {} : { caseSensitive }),
    };
  });
  return readingExam('IELTS Case E2E', [{
    id: 'note-block',
    type: 'NOTE_COMPLETION',
    instruction: 'Complete the notes.',
    questions: [{
      id: 'note-1',
      noteText: 'Surname: ____',
      blanks,
      answerRule: 'ONE_WORD',
    }],
  }], { content: 'Mr Urwin arrived.' });
}

function answerMapFor(state: ExamState, student: string) {
  const descriptors = getStudentQuestionsForModule(state, 'reading');
  const target = descriptors.find((d) => d.id === 'note-1:blank-8')!;
  expect(target).toBeDefined();
  // NOTE blanks are stored as array under question id.
  const answers: Record<string, unknown> = { 'note-1': Array.from({ length: 8 }, (_, i) => (i === 7 ? student : `word${i + 1}`)) };
  return { descriptors, target, answers: answers as never };
}

test.describe('IELTS Note blank 8 case-sensitive Urwin', () => {
  test('strict blank: urwin is Incorrect everywhere, Urwin/URWIN Correct', async () => {
    const state = noteExam(true);
    for (const student of ['urwin', 'uRwIn', 'urWIN ']) {
      const { descriptors, target, answers } = answerMapFor(state, student);
      expect(isStudentAnswerCorrect(target, answers)).toBe(false);
      const scoring = scoreObjectiveDescriptors(descriptors, answers);
      expect(scoring.byId.get('note-1:blank-8')?.correctness).toBe(false);

      const section = sectionWithSingleResult({
        questionId: 'note-1:blank-8',
        studentAnswer: student.trim(),
        correctAnswer: 'Urwin | URWIN',
        isCorrect: false,
      });
      const rows = buildExamObjectiveOverviewRows(
        [{ submission: { id: 'submission-1', studentName: 'Case Student' }, sections: [section] }],
        { examState: state },
      );
      // Overview surfaces case-only diffs; strict blank must recompute Incorrect.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.isCorrect).toBe(false);

      const wide = buildWideObjectiveExport({
        session: { examTitle: 'IELTS Case E2E', sessionId: 'session-1' },
        submissions: [{ id: 'submission-1', studentName: 'Case Student', scheduleId: 'sched-1', studentId: 'st-1', cohortName: 'c' } as never],
        sectionSubmissions: [{ submissionId: 'submission-1', sectionSubmission: section }],
        examState: state,
        moduleType: 'reading',
        mode: 'auto',
      });
      const table = buildObjectiveQuestionTableRows(wide.columns, wide.rows[0]!, { caseSensitiveByQuestionId: { 'note-1:blank-8': true } });
      const q8 = table.find((r) => r.studentAnswer === student.trim());
      expect(q8?.correct).toBe('No');
    }

    for (const student of ['Urwin', 'URWIN', '  Urwin  ']) {
      const { descriptors, target, answers } = answerMapFor(state, student);
      expect(isStudentAnswerCorrect(target, answers)).toBe(true);
      const scoring = scoreObjectiveDescriptors(descriptors, answers);
      expect(scoring.byId.get('note-1:blank-8')?.correctness).toBe(true);
    }
  });

  test('default policy (no flag): urwin is Incorrect — strict by default', async () => {
    const state = noteExam(undefined);
    const { descriptors, target, answers } = answerMapFor(state, 'urwin');
    expect(isStudentAnswerCorrect(target, answers)).toBe(false);
    expect(scoreObjectiveDescriptors(descriptors, answers).byId.get('note-1:blank-8')?.correctness).toBe(false);

    const section = sectionWithSingleResult({
      questionId: 'note-1:blank-8',
      studentAnswer: 'urwin',
      correctAnswer: 'Urwin | URWIN',
      isCorrect: false,
    });
    const rows = buildExamObjectiveOverviewRows(
      [{ submission: { id: 'submission-1', studentName: 'Case Student' }, sections: [section] }],
      { examState: state },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isCorrect).toBe(false);

    const wide = buildWideObjectiveExport({
      session: { examTitle: 'IELTS Case E2E', sessionId: 'session-1' },
      submissions: [{ id: 'submission-1', studentName: 'Case Student', scheduleId: 'sched-1', studentId: 'st-1', cohortName: 'c' } as never],
      sectionSubmissions: [{ submissionId: 'submission-1', sectionSubmission: section }],
      examState: state,
      moduleType: 'reading',
      mode: 'auto',
    });
    const table = buildObjectiveQuestionTableRows(wide.columns, wide.rows[0]!, {});
    expect(table.find((r) => r.studentAnswer === 'urwin')?.correct).toBe('No');
  });

  test('explicit opt-out (caseSensitive:false): urwin stays Correct', async () => {
    const state = noteExam(false);
    const { descriptors, target, answers } = answerMapFor(state, 'urwin');
    expect(isStudentAnswerCorrect(target, answers)).toBe(true);
    expect(scoreObjectiveDescriptors(descriptors, answers).byId.get('note-1:blank-8')?.correctness).toBe(true);
  });

  test('unanswered stays unscored, not Incorrect', async () => {
    const state = noteExam(true);
    const { descriptors } = answerMapFor(state, '');
    const scoring = scoreObjectiveDescriptors(descriptors, { 'note-1': Array.from({ length: 8 }, (_, i) => (i === 7 ? '' : `word${i + 1}`)) } as never);
    expect(scoring.byId.get('note-1:blank-8')?.status).toBe('verified_unanswered');
  });

  test('shared pool honors per-blank strictness (mixed flags)', async () => {
    const state = readingExam('IELTS Pool E2E', [{
      id: 'sent-block',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete.',
      questions: [{
        id: 's1',
        sentence: 'The ____ and ____.',
        answerRule: 'ONE_WORD',
        acceptAnyAnswerKey: true,
        sharedAcceptedAnswers: ['Garden'],
        blanks: [
          { id: 'b1', position: 0, correctAnswer: 'Garden' },
          { id: 'b2', position: 1, correctAnswer: 'Garden', caseSensitive: false },
        ],
      }],
    }], { content: 'Garden.' });
    const descriptors = getStudentQuestionsForModule(state, 'reading');
    // Strict blank rejects lowercase; opt-out blank accepts it — same pool key.
    const strictFirst = scoreObjectiveDescriptors(descriptors, { s1: ['garden', 'other'] } as never);
    expect(strictFirst.byId.get('s1:b1')?.correctness).toBe(false);
    const optOutSecond = scoreObjectiveDescriptors(descriptors, { s1: ['other', 'garden'] } as never);
    expect(optOutSecond.byId.get('s1:b2')?.correctness).toBe(true);
    const exactFirst = scoreObjectiveDescriptors(descriptors, { s1: ['Garden', 'other'] } as never);
    expect(exactFirst.byId.get('s1:b1')?.correctness).toBe(true);
  });

  test('grouped Note blanks share one mark and one number', async () => {
    const state = readingExam('IELTS Note Group E2E', [{
      id: 'note-group-block',
      type: 'NOTE_COMPLETION',
      instruction: 'Complete.',
      questions: [{
        id: 'nq',
        noteText: 'A ____ and ____.',
        answerRule: 'ONE_WORD',
        blanks: [
          { id: 'ng1', position: 0, correctAnswer: 'Urwin', scoreGroupId: 'g1', requiredCorrect: 2 },
          { id: 'ng2', position: 1, correctAnswer: 'Garden', scoreGroupId: 'g1', requiredCorrect: 2 },
        ],
      }],
    }], { content: 'Grouped note.' });
    const { getQuestionNumberLabel } = await import('../src/features/exam-authoring/api/examAuthoringGateway');
    const descriptors = getStudentQuestionsForModule(state, 'reading');
    const d1 = descriptors.find((d) => d.id === 'nq:ng1')!;
    const d2 = descriptors.find((d) => d.id === 'nq:ng2')!;
    expect(d1.rootId).toBe(d2.rootId);
    expect(d1.rootId).toContain('::group::');
    expect(getQuestionNumberLabel(descriptors, 'nq:ng1')).toBe(getQuestionNumberLabel(descriptors, 'nq:ng2'));
    const scoring = scoreObjectiveDescriptors(descriptors, { nq: ['Urwin', 'Garden'] } as never);
    expect(scoring.byId.get('nq:ng1')).toMatchObject({ correctness: true, awardedScore: 1, maxScore: 1 });
    expect(scoring.byId.get('nq:ng2')).toMatchObject({ correctness: true, awardedScore: 0, maxScore: 0 });
    expect(scoring.totalScore).toBe(1);
    expect(scoring.maxScore).toBe(1);
    const partial = scoreObjectiveDescriptors(descriptors, { nq: ['urwin', 'Garden'] } as never);
    expect(partial.totalScore).toBe(0);

    // The student navigation/footer reads the same group members the scorer
    // reads: any answered member marks the chip partial, the 2-required
    // threshold completes it.
    expect(isQuestionAnswered(d1, { nq: ['', 'Garden'] } as never)).toBe(true);
    expect(isQuestionFullyAnswered(d1, { nq: ['Urwin', 'Garden'] } as never)).toBe(true);
    expect(isQuestionFullyAnswered(d1, { nq: ['Urwin', ''] } as never)).toBe(false);
  });

  test('SINGLE_MCQ option IDs compare exactly, unknown key is invalid', async () => {
    const options = [
      { id: 'Option-A', text: 'Alpha', isCorrect: true },
      { id: 'Option-B', text: 'Beta', isCorrect: false },
    ];
    const block = {
      id: 'single-exact',
      type: 'SINGLE_MCQ',
      instruction: '',
      stem: 'Choose one',
      questions: [{ id: 'sq1', stem: 'Choose one', options }],
    } as never;
    const base = {
      id: 'sq1',
      blockId: 'single-exact',
      groupId: 'p1',
      groupLabel: 'Passage 1',
      isMulti: false,
      correctCount: 1,
      answerKey: 'sq1',
      block,
      question: { id: 'sq1', stem: 'Choose one', options },
    } as never;
    expect(isStudentAnswerCorrect(base, { sq1: 'Option-A' })).toBe(true);
    expect(isStudentAnswerCorrect(base, { sq1: 'Option A' })).toBe(false);
    expect(isStudentAnswerCorrect(base, { sq1: 'option-a' })).toBe(false);
    const stale = { ...base, id: 'gone', answerKey: 'gone', question: null } as never;
    expect(isStudentAnswerCorrect(stale, { gone: 'Option-A' })).toBeNull();
  });

  test('tree opt-out survives heal round-trip', async () => {
    const { normalizeSubAnswerTree } = await import('../src/utils/subAnswerTree');
    const { healSubAnswerTreeForBlock } = await import('../src/utils/subAnswerTreeSlots');
    const { isSubAnswerLeafCorrect } = await import('../src/utils/subAnswerTree');
    const tree = [{ id: 'r1', children: [{ id: 'lf1', acceptedAnswers: ['yes'], required: true, caseSensitive: false }] }];
    const healed = healSubAnswerTreeForBlock({ id: 'blk', type: 'SHORT_ANSWER', instruction: '', questions: [] } as never, 1, tree as never);
    const leaf = (healed[0] as never as { children: Array<{ caseSensitive?: boolean }> }).children[0]!;
    expect(leaf.caseSensitive).toBe(false);
    expect(normalizeSubAnswerTree(healed as never)[0]).toMatchObject({ id: 'r1' });
    expect(isSubAnswerLeafCorrect(['yes'], 'YES', false)).toBe(true);
    expect(isSubAnswerLeafCorrect(['yes'], 'YES', true)).toBe(false);
  });

  test('MAP precedence is locked: correctAnswer wins over acceptedAnswers', async () => {
    const state = readingExam('IELTS Map E2E', [{
      id: 'map-block',
      type: 'MAP',
      instruction: '',
      questions: [{ id: 'm1', label: 'Gate', correctAnswer: 'North Gate', acceptedAnswers: ['north entrance'], x: 0, y: 0 }],
    } as never], { content: 'Map.' });
    const descriptors = getStudentQuestionsForModule(state, 'reading');
    const target = descriptors.find((d) => d.id === 'm1')!;
    expect(isStudentAnswerCorrect(target, { m1: 'north entrance' } as never)).toBe(false);
    expect(isStudentAnswerCorrect(target, { m1: 'North Gate' } as never)).toBe(true);
  });

  test('pool key-health count follows the pool rule', async () => {
    const { countUniqueSharedSentenceKeys } = await import('../src/utils/sentenceCompletionAnswerPool');
    expect(countUniqueSharedSentenceKeys({
      id: 's', sentence: '', answerRule: 'ONE_WORD', acceptAnyAnswerKey: true,
      sharedAcceptedAnswers: ['Garden', 'garden'], blanks: [],
    } as never)).toBe(2);
  });

  test('overview pool consumption agrees with scorer on repeats', async () => {
    const state = readingExam('IELTS Pool Overview E2E', [{
      id: 'sent-block',
      type: 'SENTENCE_COMPLETION',
      instruction: 'Complete.',
      questions: [{
        id: 's1',
        sentence: 'The ____ and ____.',
        answerRule: 'ONE_WORD',
        acceptAnyAnswerKey: true,
        sharedAcceptedAnswers: ['Garden'],
        blanks: [
          { id: 'b1', position: 0, correctAnswer: 'Garden', caseSensitive: false },
          { id: 'b2', position: 1, correctAnswer: 'Garden', caseSensitive: false },
        ],
      }],
    }], { content: 'Garden.' });
    // Opt-out pool: b1's 'Garden' consumes the folded key; b2's 'garden'
    // matches it in isolation but is consumed, so the scorer says Incorrect —
    // the audit must say Incorrect too (pre-fix it recomputes per-row: Correct).
    const section = {
      id: 'section-1',
      submissionId: 'submission-1',
      section: READING_MODULE,
      answers: { type: READING_MODULE, passages: [] },
      autoGradingResults: {
        generatedAt: AUTO_GRADING_TIMESTAMP,
        totalScore: 1,
        maxScore: 2,
        percentage: 50,
        questionResults: [
          { questionId: 's1:b1', studentAnswer: 'Garden', correctAnswer: 'Garden', isCorrect: true, awardedScore: 1, maxScore: 1, scoringRule: 'one_word', hasOverride: false },
          { questionId: 's1:b2', studentAnswer: 'garden', correctAnswer: 'Garden', isCorrect: false, awardedScore: 0, maxScore: 1, scoringRule: 'one_word', hasOverride: false },
        ],
      },
      gradingStatus: 'auto_graded',
      submittedAt: AUTO_GRADING_TIMESTAMP,
    } as unknown as SectionSubmission;
    const rows = buildExamObjectiveOverviewRows(
      [{ submission: { id: 'submission-1', studentName: 'Pool Student' }, sections: [section] }],
      { examState: state },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.questionId).toBe('s1:b2');
    expect(rows[0]?.isCorrect).toBe(false);
  });

  test('wide export group honors override maxScore', async () => {
    const state = readingExam('IELTS Group Max E2E', [{
      id: 'table-block',
      type: 'TABLE_COMPLETION',
      instruction: '',
      answerRule: 'ONE_WORD',
      headers: ['Answer'],
      rows: [[''], ['']],
      cells: [
        { id: 'c1', row: 0, col: 0, correctAnswer: 'x', scoreGroupId: 'g1', requiredCorrect: 2 },
        { id: 'c2', row: 1, col: 0, correctAnswer: 'y', scoreGroupId: 'g1', requiredCorrect: 2 },
      ],
    }], { content: 'Grouped.' });
    const questionResults = [
      { questionId: 'table-block:c1', studentAnswer: 'x', correctAnswer: 'x', isCorrect: true, awardedScore: 2, maxScore: 2, scoringRule: 'table_completion', hasOverride: true },
      { questionId: 'table-block:c2', studentAnswer: 'y', correctAnswer: 'y', isCorrect: true, awardedScore: 0, maxScore: 0, scoringRule: 'table_completion', hasOverride: false },
    ];
    const section = {
      id: 'section-1',
      submissionId: 'submission-1',
      section: READING_MODULE,
      answers: { type: READING_MODULE, passages: [] },
      autoGradingResults: { generatedAt: AUTO_GRADING_TIMESTAMP, totalScore: 2, maxScore: 2, percentage: 100, questionResults },
      gradingStatus: 'auto_graded',
      submittedAt: AUTO_GRADING_TIMESTAMP,
    } as unknown as SectionSubmission;
    const { buildWideObjectiveExport: buildWide } = await import('../src/components/admin/gradingReviewUtils');
    const wide = buildWide({ session: { examTitle: 't', sessionId: 's' }, submissions: [{ id: 'submission-1' } as never], sectionSubmissions: [{ submissionId: 'submission-1', sectionSubmission: section }], examState: state, moduleType: 'reading', mode: 'auto' });
    const row = wide.rows[0]!;
    const scoreKey = wide.columns.find((c) => c.key.startsWith('scoreGroup:'))!.key;
    expect(row[scoreKey]).toBe(2);
  });

  test('choose-N traceback attributes Yes to truly-correct picks first', async () => {
    const { buildQuestionTracebackGroups: buildGroups } = await import('../src/components/admin/gradingReviewUtils');
    const state = readingExam('IELTS Choose-N E2E', [{
      id: 'multi',
      type: 'MULTI_MCQ',
      instruction: '',
      stem: 'Choose',
      requiredSelections: 3,
      options: [
        { id: 'o1', text: 'One', isCorrect: true },
        { id: 'o2', text: 'Two', isCorrect: true },
        { id: 'o3', text: 'Three', isCorrect: true },
      ],
    }], { content: 'Pick.' });
    const section = {
      id: 'section-1',
      submissionId: 'submission-1',
      section: READING_MODULE,
      answers: { type: READING_MODULE, passages: [], answers: { multi: ['ow', 'o1', 'o2'] } },
      autoGradingResults: {
        generatedAt: AUTO_GRADING_TIMESTAMP,
        totalScore: 1,
        maxScore: 3,
        percentage: 33.33,
        questionResults: [{ questionId: 'multi', studentAnswer: 'ow, o1, o2', correctAnswer: 'o1, o2, o3', isCorrect: false, awardedScore: 1, maxScore: 3, scoringRule: 'multi_choice', hasOverride: false }],
      },
      gradingStatus: 'auto_graded',
      submittedAt: AUTO_GRADING_TIMESTAMP,
    } as unknown as SectionSubmission;
    const found = buildGroups(state, section, 'reading').flatMap((g) => g.items).find((i) => i.questionId === 'multi')!;
    expect(found.selectionScores).toEqual([0, 1, 0]);
  });

  test('literal pipe in key and answer is unrepresentable (splits to variants)', async () => {
    const state = readingExam('IELTS Pipe E2E', [{
      id: 'short-block',
      type: 'SHORT_ANSWER',
      instruction: '',
      questions: [{ id: 'pipe-1', prompt: 'Say it', correctAnswer: 'a|b', answerRule: 'ONE_WORD' }],
    }], { content: 'Pipes.' });
    const descriptors = getStudentQuestionsForModule(state, 'reading');
    const target = descriptors.find((d) => d.id === 'pipe-1')!;
    // Key splits to [a, b]; the whole string matches neither, on every surface.
    expect(isStudentAnswerCorrect(target, { 'pipe-1': 'a|b' } as never)).toBe(false);
    expect(isStudentAnswerCorrect(target, { 'pipe-1': 'a' } as never)).toBe(true);
    expect(scoreObjectiveDescriptors(descriptors, { 'pipe-1': 'a|b' } as never).byId.get('pipe-1')?.correctness).toBe(false);
  });

  test('matching key row reads hand-JSON acceptedAnswers before correctHeading', async () => {
    const state = readingExam('IELTS Match Key E2E', [{
      id: 'match-block',
      type: 'MATCHING',
      instruction: '',
      headings: [{ id: 'H1', text: 'First' }, { id: 'H2', text: 'Second' }],
      questions: [{ id: 'match-1', paragraphLabel: 'C', correctHeading: 'H2', acceptedAnswers: ['H1'] } as never],
    }], { content: 'Paragraphs.' });
    const descriptors = getStudentQuestionsForModule(state, 'reading');
    const target = descriptors.find((d) => d.id === 'match-1')!;
    // correct-answer.md Phase 2: acceptedAnswers precede correctHeading.
    expect(isStudentAnswerCorrect(target, { 'match-1': 'H1' } as never)).toBe(true);
    expect(isStudentAnswerCorrect(target, { 'match-1': 'H2' } as never)).toBe(false);
  });

  test('fallback grouped verdict honors the group threshold map', async () => {
    const { buildObjectiveQuestionTableRows: buildRows } = await import('../src/components/admin/gradingPerStudentExport/objective/tableRows');
    const columns = [
      { key: 'answer:g1', label: 'Q8 Answer (1)' },
      { key: 'answer:g2', label: 'Q8 Answer (2)' },
      { key: 'scoreGroup:g1', label: 'Q8 Score' },
    ];
    const row = {
      'answer:g1': 'Urwin',
      'rightAnswer:g1': 'Urwin',
      'answer:g2': 'wrong',
      'rightAnswer:g2': 'Garden',
      'scoreGroup:g1': '',
    };
    // Default threshold (any correct): merged single row Yes.
    const def = buildRows(columns, row, { caseSensitiveByQuestionId: { g1: true, g2: true } });
    expect(def).toHaveLength(1);
    expect(def[0]?.correct).toBe('Yes');
    // Threshold 2 with one miss: merged single row No.
    const strict = buildRows(columns, row, {
      caseSensitiveByQuestionId: { g1: true, g2: true },
      groupThresholdByScoreKey: { 'scoreGroup:g1': 2 },
    });
    expect(strict).toHaveLength(1);
    expect(strict[0]?.correct).toBe('No');
  });

  test('export fallback honors opt-out map when score is missing', async () => {
    const { buildCaseSensitiveMap } = await import('../src/components/admin/gradingAnswerUtils');
    const strictState = noteExam(true);
    const strictDescriptors = getStudentQuestionsForModule(strictState, 'reading');
    const strictMap = buildCaseSensitiveMap(strictDescriptors);
    expect(strictMap['note-1:blank-8']).toBe(true);

    const columns = [{ key: 'answer:note-1:blank-8', label: 'Q8 Answer' }];
    const row = { 'answer:note-1:blank-8': 'urwin', 'rightAnswer:note-1:blank-8': 'Urwin | URWIN' };
    expect(buildObjectiveQuestionTableRows(columns, row, { caseSensitiveByQuestionId: strictMap }).find(
      (r) => r.studentAnswer === 'urwin',
    )?.correct).toBe('No');

    const optOutState = noteExam(false);
    const optOutMap = buildCaseSensitiveMap(
      getStudentQuestionsForModule(optOutState, 'reading'),
    );
    expect(optOutMap['note-1:blank-8']).toBe(false);
    expect(buildObjectiveQuestionTableRows(columns, row, { caseSensitiveByQuestionId: optOutMap }).find(
      (r) => r.studentAnswer === 'urwin',
    )?.correct).toBe('Yes');
  });
});

import { describe, expect, it } from 'vitest';
import {
  canPublishExam,
  flattenListeningQuestions,
  flattenReadingQuestions,
  getBlockSpan,
  migrateExam,
  validateListeningPart,
  validateListeningModule,
  validatePassage,
  validateReadingModule,
} from '../examUtils';
import type { Exam, ListeningPart, Passage, QuestionBlock } from '../../types';

const tfng = (id: string): QuestionBlock => ({
  id, type: 'TFNG', mode: 'TFNG', instruction: '',
  questions: [{ id: 'q1', statement: 'S', correctAnswer: 'T' }],
});

function passage(overrides: Partial<Passage> = {}): Passage {
  return { id: 'p1', title: 'Title', content: 'Content', blocks: [tfng('b1')], ...overrides };
}

function part(overrides: Partial<ListeningPart> = {}): ListeningPart {
  return { id: 'lp1', title: 'Part 1', audioUrl: '', pins: [], blocks: [tfng('b1')], ...overrides };
}

describe('validatePassage', () => {
  it('requires title and content', () => {
    const errors = validatePassage(passage({ title: '  ', content: '' }));
    expect(errors.map((e) => e.field)).toEqual(expect.arrayContaining(['title', 'content']));
  });
  it('fans out block errors', () => {
    const bad: QuestionBlock = { id: 'b9', type: 'TFNG', mode: 'TFNG', instruction: '', questions: [] };
    expect(validatePassage(passage({ blocks: [bad] })).length).toBeGreaterThan(0);
  });
  it('accepts a well-formed passage', () => {
    expect(validatePassage(passage())).toEqual([]);
  });
});

describe('validateListeningPart', () => {
  it('requires a title', () => {
    expect(validateListeningPart(part({ title: '' })).some((e) => e.field === 'title')).toBe(true);
  });
  it('rejects invalid audio urls but accepts empty', () => {
    expect(validateListeningPart(part({ audioUrl: 'not-a-url' })).some((e) => e.field === 'audioUrl')).toBe(true);
    expect(validateListeningPart(part({ audioUrl: 'https://example.com/a.mp3' })).some((e) => e.field === 'audioUrl')).toBe(false);
  });
  it('flags bad pin times (error) and blank pin labels (warning)', () => {
    const errors = validateListeningPart(part({ pins: [{ time: '99', label: '' }] as never }));
    const byField = Object.fromEntries(errors.map((e) => [e.field, e.type]));
    expect(byField['pins[0].time']).toBe('error');
    expect(byField['pins[0].label']).toBe('warning');
  });
  it('accepts valid mm:ss pins', () => {
    expect(validateListeningPart(part({ pins: [{ time: '04:30', label: 'Intro' }] as never }))).toEqual([]);
  });
});

describe('module validators', () => {
  it('require at least one passage / part', () => {
    expect(validateReadingModule([])).toEqual([
      { field: 'reading', message: 'At least one passage is required', type: 'error' },
    ]);
    expect(validateListeningModule([])).toEqual([
      { field: 'listening', message: 'At least one listening part is required', type: 'error' },
    ]);
  });
  it('aggregate nested errors', () => {
    expect(validateReadingModule([passage({ title: '' })]).length).toBeGreaterThan(0);
    expect(validateListeningModule([part({ title: '' })]).some((e) => e.field === 'title')).toBe(true);
  });
});

describe('getBlockSpan', () => {
  it('assigns contiguous 1-based spans and handles empty blocks', () => {
    const empty: QuestionBlock = { id: 'e', type: 'TFNG', mode: 'TFNG', instruction: '', questions: [] };
    expect(getBlockSpan([tfng('b1'), tfng('b2'), empty], 1)).toEqual([
      { startNum: 1, endNum: 1 },
      { startNum: 2, endNum: 2 },
      { startNum: 3, endNum: 3 },
    ]);
  });
});

describe('flatten helpers', () => {
  it('flattenReadingQuestions tags passage ids and indices', () => {
    const flat = flattenReadingQuestions([passage(), passage({ id: 'p2' })]);
    expect(flat.map((f) => [f.passageId, f.index])).toEqual([['p1', 0], ['p2', 1]]);
    expect(flat[0]?.block.id).toBe('b1');
  });
  it('flattenListeningQuestions tags part ids and indices', () => {
    const flat = flattenListeningQuestions([part()]);
    expect(flat[0]?.partId).toBe('lp1');
    expect(flat[0]?.question).toMatchObject({ id: 'q1' });
  });
});

describe('migrateExam', () => {
  it('fills missing content defaults on a sparse exam', () => {
    const exam = { id: 'x', title: 'T', content: { reading: { passages: [] }, listening: { parts: [] } } } as unknown as Exam;
    const migrated = migrateExam(exam);
    expect(migrated.id).toBe('x');
    expect(migrated.content.activeModule).toBeTruthy();
    expect(migrated.content.config).toBeTruthy();
  });
  it('does not mutate the input exam', () => {
    const exam = { id: 'x', title: 'T', content: { reading: { passages: [] }, listening: { parts: [] } } } as unknown as Exam;
    const before = JSON.stringify(exam);
    migrateExam(exam);
    expect(JSON.stringify(exam)).toBe(before);
  });
});

describe('canPublishExam title gate', () => {
  it('rejects a blank title even with valid modules', () => {
    const exam = {
      title: '   ',
      content: { reading: { passages: [passage()] }, listening: { parts: [part()] } },
    } as unknown as Exam;
    const result = canPublishExam(exam);
    expect(result.canPublish).toBe(false);
    expect(result.errors.some((e) => e.field === 'title')).toBe(true);
  });
});

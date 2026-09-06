import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SORT,
  deserializeFilters,
  formatExamStats,
  getCompactStatsString,
  hasActiveFilters,
  serializeFilters,
  type ExamFilterOptions,
} from '../examStats';

const emptyStats = {
  totalQuestions: 0,
  readingQuestions: 0,
  listeningQuestions: 0,
  hasWriting: false,
  hasSpeaking: false,
};

describe('formatExamStats', () => {
  it('lists each present module and falls back to No content', () => {
    expect(formatExamStats(emptyStats)).toBe('No content');
    expect(formatExamStats({ ...emptyStats, readingQuestions: 13 })).toBe('13 Reading');
    expect(
      formatExamStats({ ...emptyStats, readingQuestions: 13, listeningQuestions: 40, hasWriting: true, hasSpeaking: true }),
    ).toBe('13 Reading, 40 Listening, Writing, Speaking');
  });
});

describe('getCompactStatsString', () => {
  it('pluralizes question counts', () => {
    expect(getCompactStatsString({ ...emptyStats, totalQuestions: 0 })).toBe('0 questions');
    expect(getCompactStatsString({ ...emptyStats, totalQuestions: 1 })).toBe('1 question');
    expect(getCompactStatsString({ ...emptyStats, totalQuestions: 40 })).toBe('40 questions');
  });
});

describe('hasActiveFilters', () => {
  const idle: ExamFilterOptions = { search: '', status: [], type: [], creator: [] };
  it('is false for default filters', () => {
    expect(hasActiveFilters(idle)).toBe(false);
    expect(hasActiveFilters({ ...idle, search: '   ' })).toBe(false);
  });
  it('detects each active dimension', () => {
    expect(hasActiveFilters({ ...idle, search: 'ielts' })).toBe(true);
    expect(hasActiveFilters({ ...idle, status: ['live'] })).toBe(true);
    expect(hasActiveFilters({ ...idle, type: ['academic'] })).toBe(true);
    expect(hasActiveFilters({ ...idle, creator: ['admin'] })).toBe(true);
    expect(hasActiveFilters({ ...idle, dateRange: { start: '2026-01-01' } })).toBe(true);
    expect(hasActiveFilters({ ...idle, questionCount: { min: 10 } })).toBe(true);
  });
});

describe('serialize/deserializeFilters', () => {
  it('round-trips filters through a query string', () => {
    const filters: ExamFilterOptions = {
      search: 'academic',
      status: ['live', 'draft'],
      type: ['ielts'],
      creator: ['admin'],
      dateRange: { start: '2026-01-01', end: '2026-12-31' },
      questionCount: { min: 10, max: 100 },
    };
    const qs = serializeFilters(filters, { field: 'questionCount', direction: 'asc' });
    const back = deserializeFilters(qs);
    expect(back.filters).toEqual(filters);
    expect(back.sort).toEqual({ field: 'questionCount', direction: 'asc' });
  });
  it('falls back to defaults on an empty query', () => {
    const back = deserializeFilters('');
    expect(back.filters.search).toBe('');
    expect(back.sort).toEqual(DEFAULT_SORT);
  });
});

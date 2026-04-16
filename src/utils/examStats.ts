/**
 * Exam Statistics Utilities
 * 
 * Shared helpers for calculating exam statistics (question counts, etc.)
 * Used across validation, search, export, and UI components.
 */

import { Exam, ExamState } from '../types';
import { ExamEntity, ExamVersion } from '../types/domain';
import {
  getReadingTotalQuestions,
  getListeningTotalQuestions
} from './examUtils';

/**
 * Statistics summary for an exam
 */
export interface ExamStats {
  totalQuestions: number;
  readingQuestions: number;
  listeningQuestions: number;
  readingPassages: number;
  listeningParts: number;
  hasWriting: boolean;
  hasSpeaking: boolean;
}

/**
 * Calculate statistics from legacy Exam type
 */
export function getExamStatsFromExam(exam: Exam): ExamStats {
  const readingQuestions = getReadingTotalQuestions(exam.content.reading.passages);
  const listeningQuestions = getListeningTotalQuestions(exam.content.listening.parts);
  
  return {
    totalQuestions: readingQuestions + listeningQuestions,
    readingQuestions,
    listeningQuestions,
    readingPassages: exam.content.reading.passages.length,
    listeningParts: exam.content.listening.parts.length,
    hasWriting: exam.content.config.sections.writing.enabled,
    hasSpeaking: exam.content.config.sections.speaking.enabled
  };
}

/**
 * Calculate statistics from ExamState
 */
export function getExamStatsFromState(state: ExamState): ExamStats {
  const readingQuestions = getReadingTotalQuestions(state.reading.passages);
  const listeningQuestions = getListeningTotalQuestions(state.listening.parts);
  
  return {
    totalQuestions: readingQuestions + listeningQuestions,
    readingQuestions,
    listeningQuestions,
    readingPassages: state.reading.passages.length,
    listeningParts: state.listening.parts.length,
    hasWriting: state.config.sections.writing.enabled,
    hasSpeaking: state.config.sections.speaking.enabled
  };
}

/**
 * Calculate statistics from ExamVersion
 */
export function getExamStatsFromVersion(version: ExamVersion): ExamStats {
  return getExamStatsFromState(version.contentSnapshot);
}

/**
 * Calculate statistics from ExamEntity (uses current draft version if available)
 */
export async function getExamStatsFromEntity(
  entity: ExamEntity,
  getVersionById: (id: string) => Promise<ExamVersion | null>
): Promise<ExamStats> {
  if (entity.currentDraftVersionId) {
    const version = await getVersionById(entity.currentDraftVersionId);
    if (version) {
      return getExamStatsFromVersion(version);
    }
  }
  
  // Fallback to published version if no draft
  if (entity.currentPublishedVersionId) {
    const version = await getVersionById(entity.currentPublishedVersionId);
    if (version) {
      return getExamStatsFromVersion(version);
    }
  }
  
  // Return empty stats if no version available
  const emptyStats: ExamStats = {
    totalQuestions: 0,
    readingQuestions: 0,
    listeningQuestions: 0,
    readingPassages: 0,
    listeningParts: 0,
    hasWriting: false,
    hasSpeaking: false
  };
  return emptyStats;
}

/**
 * Format statistics for display
 */
export function formatExamStats(stats: ExamStats): string {
  const parts: string[] = [];
  
  if (stats.readingQuestions > 0) {
    parts.push(`${stats.readingQuestions} Reading`);
  }
  if (stats.listeningQuestions > 0) {
    parts.push(`${stats.listeningQuestions} Listening`);
  }
  if (stats.hasWriting) {
    parts.push('Writing');
  }
  if (stats.hasSpeaking) {
    parts.push('Speaking');
  }
  
  return parts.length > 0 ? parts.join(', ') : 'No content';
}

/**
 * Get a compact stats string for list/grid views
 */
export function getCompactStatsString(stats: ExamStats): string {
  const total = stats.totalQuestions;
  if (total === 0) return '0 questions';
  return `${total} question${total === 1 ? '' : 's'}`;
}

/**
 * Filter and sort options for exam library
 */
export interface ExamFilterOptions {
  search: string;
  status: string[];
  type: string[];
  creator: string[];
  dateRange?: {
    start?: string | undefined;
    end?: string | undefined;
  } | undefined;
  questionCount?: {
    min?: number | undefined;
    max?: number | undefined;
  } | undefined;
}

export interface ExamSortOptions {
  field: 'title' | 'modified' | 'published' | 'created' | 'questionCount';
  direction: 'asc' | 'desc';
}

/**
 * Default filter options
 */
export const DEFAULT_FILTERS: ExamFilterOptions = {
  search: '',
  status: [],
  type: [],
  creator: []
};

/**
 * Default sort options
 */
export const DEFAULT_SORT: ExamSortOptions = {
  field: 'modified',
  direction: 'desc'
};

/**
 * Check if filters are active
 */
export function hasActiveFilters(filters: ExamFilterOptions): boolean {
  const hasSearch: boolean = filters.search.trim().length > 0;
  const hasStatus: boolean = filters.status.length > 0;
  const hasType: boolean = filters.type.length > 0;
  const hasCreator: boolean = filters.creator.length > 0;
  const hasDateRange: boolean = !!(filters.dateRange && (filters.dateRange.start || filters.dateRange.end));
  const hasQuestionCount: boolean = !!(filters.questionCount && (filters.questionCount.min !== undefined || filters.questionCount.max !== undefined));
  
  return hasSearch || hasStatus || hasType || hasCreator || hasDateRange || hasQuestionCount;
}

/**
 * Serialize filters to URL query string
 */
export function serializeFilters(filters: ExamFilterOptions, sort: ExamSortOptions): string {
  const params = new URLSearchParams();
  
  if (filters.search) params.set('q', filters.search);
  if (filters.status.length > 0) params.set('status', filters.status.join(','));
  if (filters.type.length > 0) params.set('type', filters.type.join(','));
  if (filters.creator.length > 0) params.set('creator', filters.creator.join(','));
  if (filters.dateRange?.start) params.set('dateStart', filters.dateRange.start);
  if (filters.dateRange?.end) params.set('dateEnd', filters.dateRange.end);
  if (filters.questionCount?.min !== undefined) params.set('qMin', filters.questionCount.min.toString());
  if (filters.questionCount?.max !== undefined) params.set('qMax', filters.questionCount.max.toString());
  
  params.set('sort', sort.field);
  params.set('order', sort.direction);
  
  return params.toString();
}

/**
 * Deserialize filters from URL query string
 */
export function deserializeFilters(queryString: string): { filters: ExamFilterOptions; sort: ExamSortOptions } {
  const params = new URLSearchParams(queryString);
  
  return {
    filters: {
      search: params.get('q') || '',
      status: params.get('status')?.split(',').filter(Boolean) || [],
      type: params.get('type')?.split(',').filter(Boolean) || [],
      creator: params.get('creator')?.split(',').filter(Boolean) || [],
      dateRange: {
        start: params.get('dateStart') || undefined,
        end: params.get('dateEnd') || undefined
      },
      questionCount: {
        min: params.get('qMin') ? parseInt(params.get('qMin')!) : undefined,
        max: params.get('qMax') ? parseInt(params.get('qMax')!) : undefined
      }
    },
    sort: {
      field: (params.get('sort') as ExamSortOptions['field']) || DEFAULT_SORT.field,
      direction: (params.get('order') as ExamSortOptions['direction']) || DEFAULT_SORT.direction
    }
  };
}
